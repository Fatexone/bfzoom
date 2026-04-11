const DEFAULT_PRODUCT_IDS = {
  60: "bfzoom_credits_60_v2",
  180: "bfzoom_credits_180_v2",
  600: "bfzoom_credits_600_v3",
} as const;

const normalize = (value: string) => value.trim();

export type IosIapPackConfig = {
  minutes: number;
  seconds: number;
  productId: string;
};

export const getIosIapPackConfigs = (): IosIapPackConfig[] => {
  const pack60 = normalize(
    process.env.IOS_IAP_PRODUCT_ID_60 || DEFAULT_PRODUCT_IDS[60]
  );
  const pack180 = normalize(
    process.env.IOS_IAP_PRODUCT_ID_180 || DEFAULT_PRODUCT_IDS[180]
  );
  const pack600 = normalize(
    process.env.IOS_IAP_PRODUCT_ID_600 || DEFAULT_PRODUCT_IDS[600]
  );

  return [
    { minutes: 60, seconds: 60 * 60, productId: pack60 },
    { minutes: 180, seconds: 180 * 60, productId: pack180 },
    { minutes: 600, seconds: 600 * 60, productId: pack600 },
  ].filter((pack) => Boolean(pack.productId));
};

export const findIosIapPackByProductId = (productId: string) => {
  const normalized = normalize(productId);
  if (!normalized) return null;
  return (
    getIosIapPackConfigs().find((pack) => pack.productId === normalized) || null
  );
};
