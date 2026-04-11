import { Platform, useWindowDimensions } from "react-native";

export const detectTabletLayout = (width: number, height: number) => {
  const shortestSide = Math.min(width, height);
  if (Platform.OS === "ios" && Boolean(Platform.isPad)) {
    return true;
  }
  return shortestSide >= 768;
};

export const useAdaptiveLayout = () => {
  const { width, height } = useWindowDimensions();
  const isTabletLayout = detectTabletLayout(width, height);
  const isLandscape = width > height;
  const isLargeTabletLayout = isTabletLayout && Math.max(width, height) >= 1100;

  return {
    viewportWidth: width,
    viewportHeight: height,
    isTabletLayout,
    isLandscape,
    isLargeTabletLayout,
  };
};
