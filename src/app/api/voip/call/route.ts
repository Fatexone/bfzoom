import { createSign, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { canUseRoomFeatures } from "@/lib/roomAccess";
import { getVerifiedUser, isEmailAllowlisted } from "@/lib/serverAuth";
import { getAdminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const VOIP_TOKEN_COLLECTION = "voip_tokens";
const ROOM_ID_MAX_LEN = 96;
const CALLER_NAME_MAX_LEN = 80;
const IDENTITY_MAX_LEN = 120;
const DISPLAY_NAME_MAX_LEN = 120;

type StartVoipCallBody = {
  targetUid?: string;
  roomId?: string;
  callerName?: string;
  role?: "host" | "guest";
  callMode?: "audio" | "video";
  callUUID?: string;
  apiBaseUrl?: string;
  livekitUrl?: string;
  identity?: string;
  displayName?: string;
};

type VoipTokenLookupResult = {
  docId: string;
  tokens: string[];
};

const base64Url = (value: string | Buffer) =>
  Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const buildApnsJwt = (teamId: string, keyId: string, privateKey: string) => {
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64Url(
    JSON.stringify({
      iss: teamId,
      iat: Math.floor(Date.now() / 1_000),
    })
  );
  const unsigned = `${header}.${claims}`;
  const signer = createSign("SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign({
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${unsigned}.${base64Url(signature)}`;
};

const cleanUrl = (value: string) => value.trim().replace(/\/+$/, "");
const trimBounded = (value: string | undefined, maxLen: number) =>
  (value || "").trim().slice(0, maxLen);

const INVALID_TOKEN_REASONS = new Set([
  "BadDeviceToken",
  "Unregistered",
  "DeviceTokenNotForTopic",
  "TopicDisallowed",
]);

const parseApnsReason = (raw: string) => {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { reason?: string };
    return (parsed.reason || "").trim();
  } catch {
    return "";
  }
};

const sanitizeTokenList = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
        .filter(Boolean)
    : [];

const resolveTargetVoipTokens = async (
  db: ReturnType<typeof getAdminDb>,
  targetUid: string
): Promise<VoipTokenLookupResult | null> => {
  const directDoc = await db.collection(VOIP_TOKEN_COLLECTION).doc(targetUid).get();
  const directTokens = sanitizeTokenList(directDoc.data()?.tokens);
  if (directTokens.length > 0) {
    return {
      docId: targetUid,
      tokens: directTokens,
    };
  }

  const targetUserSnap = await db.collection("users").doc(targetUid).get();
  if (!targetUserSnap.exists) return null;
  const targetUser = (targetUserSnap.data() ?? {}) as Record<string, unknown>;
  const targetEmail =
    (typeof targetUser.emailLower === "string" ? targetUser.emailLower : "") ||
    (typeof targetUser.email === "string" ? targetUser.email.toLowerCase() : "");
  const normalizedEmail = targetEmail.trim();
  if (!normalizedEmail) return null;

  const byEmailSnap = await db
    .collection(VOIP_TOKEN_COLLECTION)
    .where("email", "==", normalizedEmail)
    .limit(1)
    .get();
  if (byEmailSnap.empty) return null;

  const tokenDoc = byEmailSnap.docs[0];
  const tokens = sanitizeTokenList(tokenDoc.data()?.tokens);
  if (!tokens.length) return null;
  return {
    docId: tokenDoc.id,
    tokens,
  };
};

export async function POST(req: Request) {
  const user = await getVerifiedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }

  const ip = getClientIp(req);
  const throttle = checkRateLimit(`voip-call:${user.uid}:${ip}`, 20, 60_000);
  if (!throttle.ok) {
    const response = NextResponse.json(
      { error: "Too many call attempts. Retry later." },
      { status: 429 }
    );
    response.headers.set("Retry-After", String(throttle.retryAfter));
    return response;
  }

  let body: StartVoipCallBody;
  try {
    body = (await req.json()) as StartVoipCallBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const requestedRole = body.role === "host" ? "host" : "guest";
  if (requestedRole === "host") {
    const allowlisted = await isEmailAllowlisted(user.email);
    const allowed = canUseRoomFeatures(allowlisted);
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden", detail: "Host account is not authorized for room creation." },
        { status: 403 }
      );
    }
  }

  const targetUid = (body.targetUid || "").trim();
  const roomId = trimBounded(body.roomId, ROOM_ID_MAX_LEN);
  if (!targetUid || !roomId) {
    return NextResponse.json({ error: "Missing targetUid or roomId" }, { status: 400 });
  }
  if (targetUid === user.uid) {
    return NextResponse.json({ error: "targetUid cannot be the caller." }, { status: 400 });
  }

  const apnsTeamId = (process.env.APNS_TEAM_ID || "").trim();
  const apnsKeyId = (process.env.APNS_KEY_ID || "").trim();
  const apnsPrivateKey = (process.env.APNS_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  const bundleId = (process.env.APPLE_BUNDLE_ID || "com.smartideaagency.bfzoommobileapp").trim();
  const topic = (process.env.APNS_VOIP_TOPIC || `${bundleId}.voip`).trim();
  const host = cleanUrl(process.env.APNS_HOST || "https://api.push.apple.com");

  if (!apnsTeamId || !apnsKeyId || !apnsPrivateKey) {
    return NextResponse.json(
      { error: "Missing APNS_TEAM_ID/APNS_KEY_ID/APNS_PRIVATE_KEY" },
      { status: 500 }
    );
  }

  const db = getAdminDb();
  const targetTokenLookup = await resolveTargetVoipTokens(db, targetUid);
  const tokens = targetTokenLookup?.tokens || [];
  if (!targetTokenLookup || !tokens.length) {
    return NextResponse.json(
      {
        ok: true,
        sent: 0,
        total: 0,
        reason: "target_has_no_voip_token",
        message:
          "No VoIP token registered for target user. Falling back to in-app call state only.",
      },
      { status: 200 }
    );
  }
  const targetTokenDocId = targetTokenLookup.docId;

  const callerName = trimBounded(body.callerName || user.email || "BFZoom", CALLER_NAME_MAX_LEN);
  const callUUID = (body.callUUID || randomUUID()).trim().toLowerCase();
  const role = requestedRole;
  const callMode = body.callMode === "video" ? "video" : "audio";
  const jwt = buildApnsJwt(apnsTeamId, apnsKeyId, apnsPrivateKey);
  const apiBaseFromEnv = trimBounded(process.env.NEXT_PUBLIC_APP_URL || "", 260);
  const livekitFromEnv = trimBounded(process.env.NEXT_PUBLIC_LIVEKIT_URL || "", 260);

  const payload = {
    aps: {
      "content-available": 1,
    },
    callUUID,
    roomId,
    callerName,
    role,
    callMode,
    apiBaseUrl: apiBaseFromEnv || trimBounded(body.apiBaseUrl, 260),
    livekitUrl: livekitFromEnv || trimBounded(body.livekitUrl, 260),
    identity: trimBounded(body.identity, IDENTITY_MAX_LEN),
    displayName: trimBounded(body.displayName, DISPLAY_NAME_MAX_LEN),
  };

  const responses = await Promise.all(
    tokens.map(async (token) => {
      const response = await fetch(`${host}/3/device/${token}`, {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": topic,
          "apns-push-type": "voip",
          "apns-priority": "10",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const raw = await response.text().catch(() => "");
      return {
        token,
        status: response.status,
        ok: response.ok,
        body: raw,
        reason: parseApnsReason(raw),
      };
    })
  );

  const invalidTokens = responses
    .filter(
      (item) =>
        item.status === 410 ||
        INVALID_TOKEN_REASONS.has(item.reason)
    )
    .map((item) => item.token);

  if (invalidTokens.length) {
    try {
      await db.collection(VOIP_TOKEN_COLLECTION).doc(targetTokenDocId).set(
        {
          updatedAt: FieldValue.serverTimestamp(),
          tokens: FieldValue.arrayRemove(...invalidTokens),
        },
        { merge: true }
      );
    } catch {}
  }

  const successCount = responses.filter((item) => item.ok).length;
  if (!successCount) {
    return NextResponse.json(
      {
        error: "APNS rejected all VoIP push requests.",
        responses,
        removedInvalidTokens: invalidTokens.length,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    callUUID,
    roomId,
    sent: successCount,
    total: responses.length,
    removedInvalidTokens: invalidTokens.length,
    responses,
  });
}
