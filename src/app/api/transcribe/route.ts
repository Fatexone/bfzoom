import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getVerifiedUser, isEmailAllowlisted } from "@/lib/serverAuth";
import { canUseRoomFeatures } from "@/lib/roomAccess";
import { hasRoomHostTranslationAccess } from "@/lib/livekitRoomRegistry";
import { verifyGuestTtsToken } from "@/lib/guestTtsToken";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export async function POST(req: Request) {
  const requestStartedAt = Date.now();
  let authCompletedAt = requestStartedAt;
  let formDataCompletedAt = requestStartedAt;
  let fileBytes = 0;
  let fileType = "";
  let normalizedLanguage = "";
  let authMode: "guest" | "user" | "unknown" = "unknown";
  const clientRecordingMs = (req.headers.get("x-bfzoom-client-recording-ms") || "").trim();
  const clientRecorderStopMs = (req.headers.get("x-bfzoom-client-recorder-stop-ms") || "").trim();
  const clientPostStopSettleMs = (req.headers.get("x-bfzoom-client-post-stop-settle-ms") || "").trim();
  const clientResolveUriMs = (req.headers.get("x-bfzoom-client-resolve-uri-ms") || "").trim();
  const clientStabilizeMs = (req.headers.get("x-bfzoom-client-stabilize-ms") || "").trim();
  const clientPreUploadMs = (req.headers.get("x-bfzoom-client-pre-upload-ms") || "").trim();
  try {
    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY manquante" }, { status: 500 });
    }
    const openai = new OpenAI({ apiKey });
    let rateKeyOwner = "";
    const guestToken = (req.headers.get("x-bfzoom-guest-tts-token") || "").trim();
    if (guestToken) {
      const guestVerification = verifyGuestTtsToken(guestToken);
      if (!guestVerification.ok) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const hostTranslationEnabled = await hasRoomHostTranslationAccess(
        guestVerification.claims.room
      );
      if (!hostTranslationEnabled) {
        return NextResponse.json(
          { error: "Host translation is unavailable for this room." },
          { status: 403 }
        );
      }
      authMode = "guest";
      rateKeyOwner = `guest:${guestVerification.claims.room}:${guestVerification.claims.identity}`;
    } else {
      const user = await getVerifiedUser(req);
      if (!user.ok) {
        return NextResponse.json({ error: user.error }, { status: user.status });
      }
      const allowlisted = await isEmailAllowlisted(user.email);
      const allowed = canUseRoomFeatures(allowlisted);
      if (!allowed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      authMode = "user";
      rateKeyOwner = user.uid;
    }
    authCompletedAt = Date.now();
    const ip = getClientIp(req);
    const rate = checkRateLimit(`${rateKeyOwner}:${ip}:transcribe`, 10, 60_000);
    if (!rate.ok) {
      return NextResponse.json(
        { error: "Rate limit" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }
    const formData = (await req.formData()) as unknown as {
      get: (name: string) => unknown;
    };
    formDataCompletedAt = Date.now();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Fichier audio manquant" }, { status: 400 });
    }
    fileBytes = file.size;
    fileType = file.type || "";
    const rawLanguage = formData.get("language");
    const language =
      typeof rawLanguage === "string"
        ? rawLanguage.trim().toLowerCase().split(/[-_]/)[0]
        : "";
    normalizedLanguage = language;

    const openAiStartedAt = Date.now();
    const response = await openai.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file,
      ...(language ? { language } : {}),
    });
    const openAiCompletedAt = Date.now();

    const totalMs = openAiCompletedAt - requestStartedAt;
    const authMs = authCompletedAt - requestStartedAt;
    const formDataMs = formDataCompletedAt - authCompletedAt;
    const openAiMs = openAiCompletedAt - openAiStartedAt;
    console.info(
      `[BFZoom][TRANSCRIBE] ok totalMs=${totalMs} authMs=${authMs} formDataMs=${formDataMs} openAiMs=${openAiMs} fileBytes=${fileBytes} fileType=${fileType || "unknown"} language=${normalizedLanguage || "auto"} authMode=${authMode} clientRecordingMs=${clientRecordingMs || "na"} clientRecorderStopMs=${clientRecorderStopMs || "na"} clientPostStopSettleMs=${clientPostStopSettleMs || "na"} clientResolveUriMs=${clientResolveUriMs || "na"} clientStabilizeMs=${clientStabilizeMs || "na"} clientPreUploadMs=${clientPreUploadMs || "na"}`
    );

    return NextResponse.json(
      { text: response.text || "" },
      {
        headers: {
          "x-bfzoom-transcribe-total-ms": String(totalMs),
          "x-bfzoom-transcribe-auth-ms": String(authMs),
          "x-bfzoom-transcribe-formdata-ms": String(formDataMs),
          "x-bfzoom-transcribe-openai-ms": String(openAiMs),
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur transcription";
    console.warn(
      `[BFZoom][TRANSCRIBE] error totalMs=${Date.now() - requestStartedAt} authMs=${authCompletedAt - requestStartedAt} formDataMs=${formDataCompletedAt - authCompletedAt} fileBytes=${fileBytes} fileType=${fileType || "unknown"} language=${normalizedLanguage || "auto"} authMode=${authMode} clientRecordingMs=${clientRecordingMs || "na"} clientRecorderStopMs=${clientRecorderStopMs || "na"} clientPostStopSettleMs=${clientPostStopSettleMs || "na"} clientResolveUriMs=${clientResolveUriMs || "na"} clientStabilizeMs=${clientStabilizeMs || "na"} clientPreUploadMs=${clientPreUploadMs || "na"} message=${message}`
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
