import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";

const AUTHENTICATED_TRANSLATION_GRANT_WINDOW_MS = 2 * 60 * 1000;
const AUTHENTICATED_POCKET_TRANSCRIBE_GRANT_WINDOW_MS = 2 * 60 * 1000;
const AUTHENTICATED_POCKET_TTS_GRANT_WINDOW_MS = 2 * 60 * 1000;
const AUTHENTICATED_POCKET_TTS_GRANT_HASH_FIELD = "pendingAuthenticatedPocketTtsGrantHash";

const getMeterRef = (uid: string) => getAdminDb().doc(`users/${uid}/translation/meter`);

const toMillis = (value: unknown) => {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (value as { toMillis: () => number }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
};

const normalizeCounter = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

const isRecent = (timestampMs: number, windowMs: number) =>
  timestampMs > 0 && Date.now() - timestampMs <= windowMs;

type SlotGrantConfig = {
  pendingField: string;
  issuedAtField: string;
  consumedAtField: string;
  windowMs: number;
};

const buildSingleSlotGrantFields = ({
  pendingField,
  issuedAtField,
}: Pick<SlotGrantConfig, "pendingField" | "issuedAtField">) =>
  ({
    [pendingField]: 1,
    [issuedAtField]: FieldValue.serverTimestamp(),
  }) satisfies Record<string, number | ReturnType<typeof FieldValue.serverTimestamp>>;

const consumeSingleSlotGrant = async (uid: string, config: SlotGrantConfig) => {
  const db = getAdminDb();
  const meterRef = getMeterRef(uid);
  return db.runTransaction(async (tx) => {
    const meterSnap = await tx.get(meterRef);
    const meterData = (meterSnap.data() ?? {}) as Record<string, unknown>;
    const pendingGrant = normalizeCounter(meterData[config.pendingField]);
    const lastIssuedAtMs = toMillis(meterData[config.issuedAtField]);
    if (pendingGrant < 1 || !isRecent(lastIssuedAtMs, config.windowMs)) {
      return false;
    }
    tx.set(
      meterRef,
      {
        [config.pendingField]: 0,
        [config.consumedAtField]: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  });
};

const setSingleSlotGrant = async (
  uid: string,
  config: Pick<SlotGrantConfig, "pendingField" | "issuedAtField">
) => {
  await getMeterRef(uid).set(buildSingleSlotGrantFields(config), { merge: true });
};

const normalizeGrantText = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, 4000);

const hashGrantText = (value: string) =>
  createHash("sha256").update(normalizeGrantText(value), "utf8").digest("hex");

const AUTHENTICATED_POCKET_TRANSCRIBE_GRANT_CONFIG = {
  pendingField: "pendingAuthenticatedPocketTranscribeGrant",
  issuedAtField: "lastAuthenticatedPocketTranscribeGrantIssuedAt",
  consumedAtField: "lastAuthenticatedPocketTranscribeGrantConsumedAt",
  windowMs: AUTHENTICATED_POCKET_TRANSCRIBE_GRANT_WINDOW_MS,
} satisfies SlotGrantConfig;

const AUTHENTICATED_POCKET_TTS_GRANT_CONFIG = {
  pendingField: "pendingAuthenticatedPocketTtsGrant",
  issuedAtField: "lastAuthenticatedPocketTtsGrantIssuedAt",
  consumedAtField: "lastAuthenticatedPocketTtsGrantConsumedAt",
  windowMs: AUTHENTICATED_POCKET_TTS_GRANT_WINDOW_MS,
} satisfies SlotGrantConfig;

export const buildAuthenticatedTranslationGrantFields = () => ({
  pendingAuthenticatedTranslationGrants: 1,
  lastAuthenticatedTranslationGrantIssuedAt: FieldValue.serverTimestamp(),
});

export const buildAuthenticatedPocketTranscribeGrantFields = () =>
  buildSingleSlotGrantFields(AUTHENTICATED_POCKET_TRANSCRIBE_GRANT_CONFIG);

export const buildAuthenticatedPocketTtsGrantFields = (text: string) => ({
  ...buildSingleSlotGrantFields(AUTHENTICATED_POCKET_TTS_GRANT_CONFIG),
  [AUTHENTICATED_POCKET_TTS_GRANT_HASH_FIELD]: hashGrantText(text),
});

export const consumeAuthenticatedTranslationGrant = async (uid: string) => {
  const db = getAdminDb();
  const meterRef = getMeterRef(uid);
  return db.runTransaction(async (tx) => {
    const meterSnap = await tx.get(meterRef);
    const meterData = (meterSnap.data() ?? {}) as Record<string, unknown>;
    const pendingGrants = normalizeCounter(meterData.pendingAuthenticatedTranslationGrants);
    const lastConsumedAtMs = toMillis(meterData.lastConsumedAt);
    if (
      pendingGrants < 1 ||
      !isRecent(lastConsumedAtMs, AUTHENTICATED_TRANSLATION_GRANT_WINDOW_MS)
    ) {
      return false;
    }
    tx.set(
      meterRef,
      {
        lastAuthenticatedTranslationGrantConsumedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  });
};

export const restoreAuthenticatedTranslationGrant = async (uid: string) => {
  await getMeterRef(uid).set(buildAuthenticatedTranslationGrantFields(), { merge: true });
};

export const consumeAuthenticatedPocketTranscribeGrant = async (uid: string) =>
  consumeSingleSlotGrant(uid, AUTHENTICATED_POCKET_TRANSCRIBE_GRANT_CONFIG);

export const restoreAuthenticatedPocketTranscribeGrant = async (uid: string) =>
  setSingleSlotGrant(uid, AUTHENTICATED_POCKET_TRANSCRIBE_GRANT_CONFIG);

export const issueAuthenticatedPocketTtsGrant = async (uid: string, text: string) => {
  await getMeterRef(uid).set(buildAuthenticatedPocketTtsGrantFields(text), { merge: true });
};

export const consumeAuthenticatedPocketTtsGrant = async (uid: string, text: string) => {
  const db = getAdminDb();
  const meterRef = getMeterRef(uid);
  const expectedHash = hashGrantText(text);
  return db.runTransaction(async (tx) => {
    const meterSnap = await tx.get(meterRef);
    const meterData = (meterSnap.data() ?? {}) as Record<string, unknown>;
    const pendingGrant = normalizeCounter(
      meterData[AUTHENTICATED_POCKET_TTS_GRANT_CONFIG.pendingField]
    );
    const lastIssuedAtMs = toMillis(
      meterData[AUTHENTICATED_POCKET_TTS_GRANT_CONFIG.issuedAtField]
    );
    const storedHash =
      typeof meterData[AUTHENTICATED_POCKET_TTS_GRANT_HASH_FIELD] === "string"
        ? meterData[AUTHENTICATED_POCKET_TTS_GRANT_HASH_FIELD]
        : "";
    if (
      pendingGrant < 1 ||
      !isRecent(lastIssuedAtMs, AUTHENTICATED_POCKET_TTS_GRANT_CONFIG.windowMs) ||
      storedHash !== expectedHash
    ) {
      return false;
    }
    tx.set(
      meterRef,
      {
        [AUTHENTICATED_POCKET_TTS_GRANT_CONFIG.pendingField]: 0,
        [AUTHENTICATED_POCKET_TTS_GRANT_CONFIG.consumedAtField]: FieldValue.serverTimestamp(),
        [AUTHENTICATED_POCKET_TTS_GRANT_HASH_FIELD]: FieldValue.delete(),
      },
      { merge: true }
    );
    return true;
  });
};

export const restoreAuthenticatedPocketTtsGrant = async (uid: string, text: string) => {
  await getMeterRef(uid).set(buildAuthenticatedPocketTtsGrantFields(text), { merge: true });
};

export const canUseAuthenticatedTts = async ({ uid }: { uid: string }) => {
  const meterSnap = await getMeterRef(uid).get();
  const meterData = (meterSnap.data() ?? {}) as Record<string, unknown>;
  const lastTranslationGrantIssuedAtMs = toMillis(
    meterData.lastAuthenticatedTranslationGrantIssuedAt
  );
  return isRecent(lastTranslationGrantIssuedAtMs, AUTHENTICATED_TRANSLATION_GRANT_WINDOW_MS);
};
