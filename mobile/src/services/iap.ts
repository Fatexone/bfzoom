import { Platform } from "react-native";

const IAP_RESPONSE_CODES = {
  ok: 0,
  userCanceled: 1,
  error: 2,
  deferred: 3,
} as const;

type CatalogPack = {
  productId: string;
  minutes: number;
  seconds: number;
};

type NativeStoreProduct = {
  productId?: string;
  title?: string;
  description?: string;
  price?: string;
  localizedPrice?: string;
};

type NativePurchaseRecord = {
  productId?: string;
  transactionId?: string;
  transactionIdentifier?: string;
  originalTransactionIdentifierIOS?: string;
  transactionReceipt?: string;
  originalJson?: string;
  orderId?: string;
  originalOrderId?: string;
  purchaseTime?: number;
  originalPurchaseTime?: number | string;
  acknowledged?: boolean;
};

type ExpoIapModule = {
  IAPResponseCode?: Record<string, number>;
  connectAsync?: () => Promise<void>;
  disconnectAsync?: () => Promise<void>;
  getProductsAsync?: (
    productIds: string[]
  ) => Promise<{
    responseCode?: number;
    results?: NativeStoreProduct[];
    errorCode?: string;
  }>;
  purchaseItemAsync?: (productId: string) => Promise<unknown>;
  getPurchaseHistoryAsync?: () => Promise<{
    responseCode?: number;
    results?: NativePurchaseRecord[];
    errorCode?: string | number;
  }>;
  setPurchaseListener?: (
    listener: (event: { responseCode?: number; results?: NativePurchaseRecord[]; errorCode?: string }) => void
  ) => void;
  finishTransactionAsync?: (
    purchase: NativePurchaseRecord,
    consumeItem?: boolean
  ) => Promise<void>;
};

const lastKnownNativeProductIds = new Set<string>();

export type IosIapCatalogPack = {
  productId: string;
  minutes: number;
  seconds: number;
  title: string;
  description: string;
  price: string;
  hasNativeProduct: boolean;
};

export type IosIapCatalogResult = {
  packs: IosIapCatalogPack[];
  nativeReady: boolean;
};

export type IosIapPurchaseResult = {
  alreadyProcessed: boolean;
  minutesAdded: number;
  totalSecondsRemaining: number;
};

const logIap = (event: string, details?: Record<string, unknown>) => {
  const suffix = details
    ? ` ${Object.entries(details)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")}`
    : "";
  console.log(`[BFZoom][IAP] ${event}${suffix}`);
};

const trimSlash = (value: string) => value.replace(/\/+$/, "");

const getFallbackPackCopy = (minutes: number) => {
  switch (minutes) {
    case 60:
      return {
        title: "60 translation minutes",
        description: "60 BFZoom call translation minutes",
        price: "App Store price",
      };
    case 180:
      return {
        title: "180 translation minutes",
        description: "180 BFZoom call translation minutes",
        price: "App Store price",
      };
    case 600:
      return {
        title: "600 translation minutes",
        description: "600 BFZoom call translation minutes",
        price: "App Store price",
      };
    default:
      return {
        title: `${minutes} translation minutes`,
        description: `${minutes} BFZoom call translation minutes`,
        price: "App Store price",
      };
  }
};

const resolveResponseCode = (iap: ExpoIapModule, fallback: number) => {
  const codes = iap.IAPResponseCode || {};
  return {
    ok: typeof codes.OK === "number" ? codes.OK : fallback,
    userCanceled:
      typeof codes.USER_CANCELED === "number" ? codes.USER_CANCELED : IAP_RESPONSE_CODES.userCanceled,
    error: typeof codes.ERROR === "number" ? codes.ERROR : IAP_RESPONSE_CODES.error,
    deferred:
      typeof codes.DEFERRED === "number" ? codes.DEFERRED : IAP_RESPONSE_CODES.deferred,
  };
};

const loadExpoIapModule = (): ExpoIapModule | null => {
  if (Platform.OS !== "ios") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-in-app-purchases") as ExpoIapModule;
    return mod || null;
  } catch {
    return null;
  }
};

const readHttpError = async (response: Response) => {
  const raw = await response.text().catch(() => "");
  if (!raw) return `${response.status} ${response.statusText}`.trim();
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    return parsed.error || raw;
  } catch {
    return raw;
  }
};

const requestWithAuth = async ({
  method,
  url,
  bearerToken,
  body,
}: {
  method: "GET" | "POST";
  url: string;
  bearerToken: string;
  body?: unknown;
}) => {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${bearerToken.trim()}`,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  if (!response.ok) {
    throw new Error(await readHttpError(response));
  }
  return (await response.json()) as Record<string, unknown>;
};

const getCatalogFromApi = async ({
  apiBaseUrl,
  bearerToken,
}: {
  apiBaseUrl: string;
  bearerToken: string;
}) => {
  const payload = await requestWithAuth({
    method: "GET",
    url: `${trimSlash(apiBaseUrl)}/api/iap/ios/products`,
    bearerToken,
  });
  const packsRaw = Array.isArray(payload.packs) ? payload.packs : [];
  const packs = packsRaw
    .map((pack) => {
      const productId =
        typeof pack?.productId === "string" ? pack.productId.trim() : "";
      const minutes =
        typeof pack?.minutes === "number" && Number.isFinite(pack.minutes)
          ? Math.max(0, Math.floor(pack.minutes))
          : 0;
      const seconds =
        typeof pack?.seconds === "number" && Number.isFinite(pack.seconds)
          ? Math.max(0, Math.floor(pack.seconds))
          : minutes * 60;
      if (!productId || minutes <= 0 || seconds <= 0) return null;
      return { productId, minutes, seconds } satisfies CatalogPack;
    })
    .filter((pack): pack is CatalogPack => Boolean(pack));
  logIap("catalog_api_ok", {
    count: packs.length,
    productIds: packs.map((pack) => pack.productId).join(","),
  });
  return packs;
};

const normalizeNativeProductMap = (products: NativeStoreProduct[]) => {
  const map = new Map<string, NativeStoreProduct>();
  for (const product of products) {
    const productId = (product.productId || "").trim();
    if (!productId) continue;
    map.set(productId, product);
  }
  return map;
};

const extractPurchaseFromEvent = (
  event: { responseCode?: number; results?: NativePurchaseRecord[]; errorCode?: string }
): NativePurchaseRecord | null => {
  if (!event || typeof event !== "object") return null;
  const pools = Array.isArray(event.results) ? event.results : [];
  for (const item of pools) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as NativePurchaseRecord;
    if ((candidate.productId || "").trim()) {
      return candidate;
    }
  }
  return null;
};

const getPurchaseTransactionId = (purchase: NativePurchaseRecord) =>
  (
    purchase.transactionId ||
    purchase.transactionIdentifier ||
    purchase.orderId ||
    ""
  ).trim();

const getPurchaseOriginalTransactionId = (purchase: NativePurchaseRecord) =>
  (
    purchase.originalTransactionIdentifierIOS ||
    purchase.originalOrderId ||
    ""
  ).trim();

const getPurchaseReceipt = (purchase: NativePurchaseRecord) =>
  (purchase.transactionReceipt || purchase.originalJson || "").trim();

const getPurchaseTime = (purchase: NativePurchaseRecord) => {
  const originalPurchaseTime =
    typeof purchase.originalPurchaseTime === "number"
      ? purchase.originalPurchaseTime
      : Number(purchase.originalPurchaseTime || 0);
  if (Number.isFinite(originalPurchaseTime) && originalPurchaseTime > 0) {
    return originalPurchaseTime;
  }
  if (typeof purchase.purchaseTime === "number" && Number.isFinite(purchase.purchaseTime)) {
    return purchase.purchaseTime;
  }
  return 0;
};

const recoverPurchaseFromHistory = async ({
  iap,
  expectedProductId,
  startedAtMs,
}: {
  iap: ExpoIapModule;
  expectedProductId: string;
  startedAtMs: number;
}) => {
  if (!iap.getPurchaseHistoryAsync) {
    return null;
  }
  try {
    const response = await iap.getPurchaseHistoryAsync();
    const responseCodes = resolveResponseCode(iap, IAP_RESPONSE_CODES.ok);
    const responseCode =
      typeof response?.responseCode === "number" ? response.responseCode : responseCodes.error;
    const history = Array.isArray(response?.results) ? response.results : [];
    logIap("purchase_history_probe", {
      productId: expectedProductId,
      responseCode,
      historyCount: history.length,
    });
    if (responseCode !== responseCodes.ok) {
      return null;
    }

    const candidate = history
      .filter((purchase) => (purchase.productId || "").trim() === expectedProductId)
      .filter((purchase) => Boolean(getPurchaseTransactionId(purchase) && getPurchaseReceipt(purchase)))
      .filter((purchase) => getPurchaseTime(purchase) >= startedAtMs - 60_000)
      .sort((a, b) => getPurchaseTime(b) - getPurchaseTime(a))[0];

    if (!candidate) {
      return null;
    }

    logIap("purchase_history_recovered", {
      productId: expectedProductId,
      transactionId: getPurchaseTransactionId(candidate) || "missing",
      acknowledged: Boolean(candidate.acknowledged),
      purchaseTime: getPurchaseTime(candidate),
    });
    return candidate;
  } catch (error) {
    logIap("purchase_history_recovery_error", {
      productId: expectedProductId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
};

const createPurchaseEventWaiter = ({
  iap,
  expectedProductId,
  timeoutMs = 90_000,
}: {
  iap: ExpoIapModule;
  expectedProductId: string;
  timeoutMs?: number;
}) => {
  const setPurchaseListener = iap.setPurchaseListener;
  if (!setPurchaseListener) {
    throw new Error("IAP purchase listener unavailable on this build.");
  }
  const responseCodes = resolveResponseCode(iap, IAP_RESPONSE_CODES.ok);
  let settled = false;
  let resolvePromise: (value: NativePurchaseRecord | null) => void = () => {};
  let rejectPromise: (reason?: unknown) => void = () => {};
  const cleanup = () => {
    try {
      setPurchaseListener(() => {});
    } catch {}
  };
  const done = (fn: () => void) => {
    if (settled) return;
    settled = true;
    cleanup();
    fn();
  };

  const promise = new Promise<NativePurchaseRecord | null>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const timer = setTimeout(() => {
    done(() => rejectPromise(new Error("Purchase timeout. Please retry.")));
  }, timeoutMs);

  setPurchaseListener((event) => {
    const responseCode = typeof event?.responseCode === "number" ? event.responseCode : responseCodes.error;
    if (responseCode === responseCodes.userCanceled) {
      clearTimeout(timer);
      done(() => rejectPromise(new Error("Purchase canceled.")));
      return;
    }
    if (responseCode === responseCodes.deferred) {
      clearTimeout(timer);
      done(() => rejectPromise(new Error("Purchase pending approval.")));
      return;
    }
    if (responseCode === responseCodes.error) {
      clearTimeout(timer);
      done(() => rejectPromise(new Error(event?.errorCode || "StoreKit purchase failed.")));
      return;
    }
    const purchase = extractPurchaseFromEvent(event);
    if (!purchase) return;
    if ((purchase.productId || "").trim() !== expectedProductId) return;
    clearTimeout(timer);
    done(() => resolvePromise(purchase));
  });

  return {
    promise,
    cancel: () => {
      clearTimeout(timer);
      done(() => resolvePromise(null));
    },
  };
};

export const fetchIosIapCatalog = async ({
  apiBaseUrl,
  bearerToken,
}: {
  apiBaseUrl: string;
  bearerToken: string;
}): Promise<IosIapCatalogResult> => {
  const apiPacks = await getCatalogFromApi({ apiBaseUrl, bearerToken });
  const iap = loadExpoIapModule();
  const nativeReady = Boolean(
    iap?.connectAsync && iap.getProductsAsync && iap.purchaseItemAsync && iap.setPurchaseListener
  );

  logIap("catalog_native_check", {
    platform: Platform.OS,
    nativeReady,
    hasConnect: Boolean(iap?.connectAsync),
    hasGetProducts: Boolean(iap?.getProductsAsync),
    hasPurchase: Boolean(iap?.purchaseItemAsync),
    hasListener: Boolean(iap?.setPurchaseListener),
  });

  if (!nativeReady || !iap) {
    return {
      nativeReady: false,
      packs: apiPacks.map((pack) => ({
        ...pack,
        ...getFallbackPackCopy(pack.minutes),
        hasNativeProduct: false,
      })),
    };
  }

  await iap.connectAsync?.();
  try {
    let nativeMap = new Map<string, NativeStoreProduct>();

    try {
      const response = await iap.getProductsAsync?.(apiPacks.map((pack) => pack.productId));
      const responseCodes = resolveResponseCode(iap, IAP_RESPONSE_CODES.ok);
      const responseCode =
        typeof response?.responseCode === "number" ? response.responseCode : responseCodes.error;
      const nativeProducts = Array.isArray(response?.results) ? response.results : [];

      logIap("catalog_storekit_response", {
        responseCode,
        nativeCount: nativeProducts.length,
        nativeProductIds: nativeProducts
          .map((product) => (product.productId || "").trim())
          .filter(Boolean)
          .join(","),
        nativePrices: nativeProducts
          .map((product) => (product.localizedPrice || product.price || "").trim())
          .filter(Boolean)
          .join(" | "),
      });

      if (responseCode === responseCodes.ok) {
        nativeMap = normalizeNativeProductMap(nativeProducts);
        lastKnownNativeProductIds.clear();
        for (const productId of nativeMap.keys()) {
          lastKnownNativeProductIds.add(productId);
        }
      }
    } catch (error) {
      logIap("catalog_storekit_error", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }

    const packs = apiPacks.map((pack) => {
      const native = nativeMap.get(pack.productId);
      const fallback = getFallbackPackCopy(pack.minutes);
      return {
        ...pack,
        title: (native?.title || "").trim() || fallback.title,
        description:
          (native?.description || "").trim() || fallback.description,
        price: (native?.localizedPrice || native?.price || "").trim() || fallback.price,
        hasNativeProduct: Boolean(native),
      };
    });

    logIap("catalog_ready", {
      nativeReady: true,
      totalPacks: packs.length,
      nativePacks: packs.filter((pack) => pack.hasNativeProduct).length,
    });

    return {
      nativeReady: true,
      packs,
    };
  } finally {
    await iap.disconnectAsync?.().catch(() => {});
  }
};

export const purchaseIosIapPack = async ({
  apiBaseUrl,
  bearerToken,
  productId,
}: {
  apiBaseUrl: string;
  bearerToken: string;
  productId: string;
}): Promise<IosIapPurchaseResult> => {
  const normalizedProductId = productId.trim();
  if (!normalizedProductId) {
    throw new Error("Missing iOS IAP product ID.");
  }

  logIap("purchase_start", {
    productId: normalizedProductId,
  });

  const iap = loadExpoIapModule();
  if (!iap?.connectAsync || !iap.purchaseItemAsync || !iap.getProductsAsync || !iap.setPurchaseListener) {
    logIap("purchase_native_unavailable", {
      hasConnect: Boolean(iap?.connectAsync),
      hasGetProducts: Boolean(iap?.getProductsAsync),
      hasListener: Boolean(iap?.setPurchaseListener),
      hasPurchase: Boolean(iap?.purchaseItemAsync),
    });
    throw new Error(
      "IAP iOS natif indisponible sur ce build. Ajoute expo-in-app-purchases puis rebuild iOS."
    );
  }

  await iap.connectAsync();
  try {
    const purchaseStartedAtMs = Date.now();
    try {
      const response = await iap.getProductsAsync([normalizedProductId]);
      const responseCodes = resolveResponseCode(iap, IAP_RESPONSE_CODES.ok);
      const responseCode =
        typeof response?.responseCode === "number"
          ? response.responseCode
          : responseCodes.error;
      const nativeProducts = Array.isArray(response?.results) ? response.results : [];
      const nativeMap = normalizeNativeProductMap(nativeProducts);
      const prefetchedProductAvailable = nativeMap.has(normalizedProductId);
      logIap("purchase_storekit_prefetch", {
        productId: normalizedProductId,
        responseCode,
        nativeCount: nativeProducts.length,
        hasRequestedProduct: prefetchedProductAvailable,
        cachedProduct: lastKnownNativeProductIds.has(normalizedProductId),
      });
      if (responseCode === responseCodes.ok && prefetchedProductAvailable) {
        lastKnownNativeProductIds.add(normalizedProductId);
      }
      if (responseCode !== responseCodes.ok || !prefetchedProductAvailable) {
        logIap("purchase_storekit_prefetch_soft_miss", {
          productId: normalizedProductId,
        });
        throw new Error("This translation pack is not available for the current App Store account.");
      }
    } catch (error) {
      logIap("purchase_storekit_prefetch_error", {
        productId: normalizedProductId,
        message: error instanceof Error ? error.message : "unknown",
      });
      throw error instanceof Error
        ? error
        : new Error("This translation pack is not available for the current App Store account.");
    }

    const purchaseWaiter = createPurchaseEventWaiter({
      iap,
      expectedProductId: normalizedProductId,
    });
    try {
      await iap.purchaseItemAsync(normalizedProductId);
    } catch (error) {
      purchaseWaiter.cancel();
      throw new Error(
        error instanceof Error
          ? error.message
          : "Unable to open the App Store purchase sheet."
      );
    }
    let purchase: NativePurchaseRecord | null = null;
    try {
      purchase = await purchaseWaiter.promise;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Purchase failed.";
      if (/purchase timeout/i.test(message)) {
        purchase = await recoverPurchaseFromHistory({
          iap,
          expectedProductId: normalizedProductId,
          startedAtMs: purchaseStartedAtMs,
        });
      }
      if (!purchase) {
        throw error;
      }
    }
    if (!purchase) {
      throw new Error("Purchase did not start. Please retry.");
    }

    logIap("purchase_storekit_event", {
      productId: normalizedProductId,
      transactionId: getPurchaseTransactionId(purchase) || "missing",
      hasReceipt: Boolean(getPurchaseReceipt(purchase)),
    });

    const transactionId = getPurchaseTransactionId(purchase);
    const originalTransactionId = getPurchaseOriginalTransactionId(purchase);
    const receiptData = getPurchaseReceipt(purchase);

    if (!transactionId || !receiptData) {
      throw new Error("Purchase completed but transaction payload is incomplete.");
    }

    const payload = await requestWithAuth({
      method: "POST",
      url: `${trimSlash(apiBaseUrl)}/api/iap/ios/confirm`,
      bearerToken,
      body: {
        productId: normalizedProductId,
        transactionId,
        originalTransactionId,
        receiptData,
      },
    });

    await iap.finishTransactionAsync?.(purchase, true).catch(() => {});

    logIap("purchase_confirmed", {
      productId: normalizedProductId,
      alreadyProcessed: Boolean(payload.alreadyProcessed),
      minutesAdded:
        typeof payload.minutesAdded === "number" && Number.isFinite(payload.minutesAdded)
          ? Math.max(0, Math.floor(payload.minutesAdded))
          : 0,
    });

    return {
      alreadyProcessed: Boolean(payload.alreadyProcessed),
      minutesAdded:
        typeof payload.minutesAdded === "number" && Number.isFinite(payload.minutesAdded)
          ? Math.max(0, Math.floor(payload.minutesAdded))
          : 0,
      totalSecondsRemaining:
        typeof payload.totalSecondsRemaining === "number" &&
        Number.isFinite(payload.totalSecondsRemaining)
          ? Math.max(0, Math.floor(payload.totalSecondsRemaining))
          : 0,
    };
  } finally {
    await iap.disconnectAsync?.().catch(() => {});
  }
};

export const isIosIapNativeAvailable = () => {
  const iap = loadExpoIapModule();
  return Boolean(iap?.connectAsync && iap.getProductsAsync && iap.purchaseItemAsync && iap.setPurchaseListener);
};
