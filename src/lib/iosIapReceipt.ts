import { createHash } from "node:crypto";

const APPLE_VERIFY_RECEIPT_PRODUCTION_URL = "https://buy.itunes.apple.com/verifyReceipt";
const APPLE_VERIFY_RECEIPT_SANDBOX_URL = "https://sandbox.itunes.apple.com/verifyReceipt";
const DEFAULT_BUNDLE_ID = "com.smartideaagency.bfzoommobileapp";
const DEBUG_BUNDLE_ID = "com.smartideaagency.bfzoommobileapp.debug.bricefaradji";

type AppleReceiptLine = {
  product_id?: string;
  transaction_id?: string;
  original_transaction_id?: string;
  purchase_date_ms?: string;
  cancellation_date?: string;
};

type AppleVerifyReceiptResponse = {
  status?: number;
  environment?: string;
  receipt?: {
    bundle_id?: string;
    in_app?: AppleReceiptLine[];
  };
  latest_receipt_info?: AppleReceiptLine[];
};

export type VerifiedIosIapReceipt = {
  environment: string;
  bundleId: string;
  productId: string;
  transactionId: string;
  originalTransactionId: string;
  purchaseDateMs: number;
  receiptDigest: string;
};

export type VerifyIosIapReceiptResult =
  | {
      ok: true;
      receipt: VerifiedIosIapReceipt;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

const normalizeString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const toSafeInteger = (value: unknown) => {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : Number(normalizeString(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
};

const normalizeReceiptLines = (response: AppleVerifyReceiptResponse) => {
  const pools = [
    ...(Array.isArray(response.receipt?.in_app) ? response.receipt.in_app : []),
    ...(Array.isArray(response.latest_receipt_info) ? response.latest_receipt_info : []),
  ];

  const lines = new Map<string, AppleReceiptLine>();
  for (const item of pools) {
    if (!item || typeof item !== "object") continue;
    const productId = normalizeString(item.product_id);
    const transactionId = normalizeString(item.transaction_id);
    if (!productId || !transactionId) continue;
    if (normalizeString(item.cancellation_date)) continue;
    lines.set(`${productId}:${transactionId}`, item);
  }
  return [...lines.values()];
};

const resolveAllowedBundleIds = () => {
  const values = new Set<string>();
  const rawLists = [
    process.env.IOS_IAP_ALLOWED_BUNDLE_IDS,
    process.env.APPLE_BUNDLE_IDS,
  ];

  for (const raw of rawLists) {
    for (const candidate of normalizeString(raw).split(",")) {
      const value = candidate.trim();
      if (value) values.add(value);
    }
  }

  const directCandidates = [
    process.env.APPLE_BUNDLE_ID,
    process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER,
    DEFAULT_BUNDLE_ID,
  ];
  for (const candidate of directCandidates) {
    const value = normalizeString(candidate);
    if (value) values.add(value);
  }

  if (process.env.NODE_ENV !== "production") {
    values.add(DEBUG_BUNDLE_ID);
  }

  return values;
};

const buildVerifyRequestBody = (receiptData: string) => {
  const body: Record<string, unknown> = {
    "receipt-data": receiptData,
    "exclude-old-transactions": false,
  };
  const sharedSecret = normalizeString(
    process.env.APPLE_SHARED_SECRET ||
      process.env.APP_STORE_SHARED_SECRET ||
      process.env.IOS_IAP_SHARED_SECRET
  );
  if (sharedSecret) {
    body.password = sharedSecret;
  }
  return body;
};

const postReceiptToApple = async (
  url: string,
  receiptData: string
): Promise<
  | {
      ok: true;
      response: AppleVerifyReceiptResponse;
    }
  | {
      ok: false;
      status: number;
      error: string;
    }
> => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildVerifyRequestBody(receiptData)),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      status: 502,
      error: "Unable to reach Apple receipt verification.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: 502,
      error: `Apple receipt verification is unavailable (${response.status}).`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      status: 502,
      error: "Apple receipt verification returned invalid JSON.",
    };
  }

  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      status: 502,
      error: "Apple receipt verification returned an invalid payload.",
    };
  }

  return {
    ok: true,
    response: payload as AppleVerifyReceiptResponse,
  };
};

export async function verifyIosIapReceipt({
  receiptData,
  productId,
  transactionId,
  originalTransactionId,
}: {
  receiptData: string;
  productId: string;
  transactionId: string;
  originalTransactionId?: string;
}): Promise<VerifyIosIapReceiptResult> {
  const normalizedReceiptData = normalizeString(receiptData);
  const normalizedProductId = normalizeString(productId);
  const normalizedTransactionId = normalizeString(transactionId);
  const normalizedOriginalTransactionId = normalizeString(originalTransactionId);

  if (!normalizedReceiptData || !normalizedProductId || !normalizedTransactionId) {
    return {
      ok: false,
      status: 400,
      error: "Missing iOS purchase confirmation payload.",
    };
  }

  const productionResult = await postReceiptToApple(
    APPLE_VERIFY_RECEIPT_PRODUCTION_URL,
    normalizedReceiptData
  );
  if (!productionResult.ok) {
    return productionResult;
  }

  let verifiedResponse = productionResult.response;
  const productionStatus =
    typeof verifiedResponse.status === "number" ? verifiedResponse.status : -1;

  if (productionStatus === 21007) {
    const sandboxResult = await postReceiptToApple(
      APPLE_VERIFY_RECEIPT_SANDBOX_URL,
      normalizedReceiptData
    );
    if (!sandboxResult.ok) {
      return sandboxResult;
    }
    verifiedResponse = sandboxResult.response;
  }

  const status = typeof verifiedResponse.status === "number" ? verifiedResponse.status : -1;
  if (status !== 0) {
    return {
      ok: false,
      status: 400,
      error: `Apple receipt verification failed (${status}).`,
    };
  }

  const bundleId = normalizeString(verifiedResponse.receipt?.bundle_id);
  const allowedBundleIds = resolveAllowedBundleIds();
  if (!bundleId || !allowedBundleIds.has(bundleId)) {
    return {
      ok: false,
      status: 400,
      error: "Apple receipt bundle ID mismatch.",
    };
  }

  const lines = normalizeReceiptLines(verifiedResponse);
  const verifiedLine =
    lines.find(
      (line) =>
        normalizeString(line.product_id) === normalizedProductId &&
        normalizeString(line.transaction_id) === normalizedTransactionId
    ) ||
    (normalizedOriginalTransactionId
      ? lines.find(
          (line) =>
            normalizeString(line.product_id) === normalizedProductId &&
            normalizeString(line.original_transaction_id) === normalizedOriginalTransactionId
        )
      : undefined);

  if (!verifiedLine) {
    return {
      ok: false,
      status: 400,
      error: "Verified Apple receipt does not contain the requested transaction.",
    };
  }

  const verifiedTransactionId = normalizeString(verifiedLine.transaction_id);
  const verifiedOriginalTransactionId =
    normalizeString(verifiedLine.original_transaction_id) || verifiedTransactionId;

  return {
    ok: true,
    receipt: {
      environment: normalizeString(verifiedResponse.environment) || "Production",
      bundleId,
      productId: normalizeString(verifiedLine.product_id),
      transactionId: verifiedTransactionId,
      originalTransactionId: verifiedOriginalTransactionId,
      purchaseDateMs: toSafeInteger(verifiedLine.purchase_date_ms),
      receiptDigest: createHash("sha256").update(normalizedReceiptData).digest("hex"),
    },
  };
}
