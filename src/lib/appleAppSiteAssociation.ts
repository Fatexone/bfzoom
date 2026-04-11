const DEFAULT_APPLE_TEAM_ID = "QR3KA9TZQE";
const DEFAULT_IOS_BUNDLE_ID = "com.smartideaagency.bfzoommobileapp";

const cleanValue = (value: string | undefined, fallback: string) => {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
};

export const getAppleAppSiteAssociationPayload = () => {
  const teamId = cleanValue(process.env.APPLE_TEAM_ID, DEFAULT_APPLE_TEAM_ID);
  const bundleId = cleanValue(
    process.env.APPLE_BUNDLE_ID || process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER,
    DEFAULT_IOS_BUNDLE_ID
  );
  const appID = `${teamId}.${bundleId}`;

  return {
    applinks: {
      apps: [] as string[],
      details: [
        {
          appID,
          paths: ["/videoconference", "/videoconference/*", "/join", "/join/*"],
        },
      ],
    },
  };
};
