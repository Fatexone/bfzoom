"use client";

import { useEffect, useState } from "react";

export type AiPracticeViewportKind =
  | "phone"
  | "tablet-portrait"
  | "tablet-landscape"
  | "desktop";

export type AiPracticeViewportProfile = {
  kind: AiPracticeViewportKind;
  width: number;
  height: number;
  shortestSide: number;
  longestSide: number;
  isPortrait: boolean;
  isPhone: boolean;
  isTablet: boolean;
  isTabletPortrait: boolean;
  isTabletLandscape: boolean;
  isDesktop: boolean;
  isAppleTouch: boolean;
  isApplePhone: boolean;
};

const DEFAULT_PROFILE: AiPracticeViewportProfile = {
  kind: "desktop",
  width: 1280,
  height: 800,
  shortestSide: 800,
  longestSide: 1280,
  isPortrait: false,
  isPhone: false,
  isTablet: false,
  isTabletPortrait: false,
  isTabletLandscape: false,
  isDesktop: true,
  isAppleTouch: false,
  isApplePhone: false,
};

export const isAppleTouchPlatform = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  const maybeNavigator = navigator as Navigator & { maxTouchPoints?: number };
  return navigator.platform === "MacIntel" && (maybeNavigator.maxTouchPoints || 0) > 1;
};

export const isApplePhonePlatform = () => {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPod/i.test(navigator.userAgent || "");
};

const isTouchCapableViewport = () => {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const maybeNavigator = navigator as Navigator & { maxTouchPoints?: number };
  return (
    (maybeNavigator.maxTouchPoints || 0) > 0 ||
    window.matchMedia("(pointer: coarse)").matches
  );
};

export const getAiPracticeViewportProfile = (): AiPracticeViewportProfile => {
  if (typeof window === "undefined") return DEFAULT_PROFILE;

  const width = Math.max(
    1,
    Math.round(window.innerWidth || document.documentElement.clientWidth || DEFAULT_PROFILE.width)
  );
  const height = Math.max(
    1,
    Math.round(window.innerHeight || document.documentElement.clientHeight || DEFAULT_PROFILE.height)
  );
  const shortestSide = Math.min(width, height);
  const longestSide = Math.max(width, height);
  const isPortrait = height >= width;
  const isAppleTouch = isAppleTouchPlatform();
  const isApplePhone = isApplePhonePlatform();
  const isTouchCapable = isTouchCapableViewport();

  const isPhone =
    isApplePhone ||
    shortestSide <= 767 ||
    (isTouchCapable && shortestSide <= 820 && longestSide <= 932);
  const isTabletCandidate =
    !isPhone &&
    (isAppleTouch || (isTouchCapable && shortestSide >= 768 && shortestSide <= 1100 && longestSide <= 1400));

  const kind: AiPracticeViewportKind = isPhone
    ? "phone"
    : isTabletCandidate
    ? isPortrait
      ? "tablet-portrait"
      : "tablet-landscape"
    : "desktop";

  return {
    kind,
    width,
    height,
    shortestSide,
    longestSide,
    isPortrait,
    isPhone,
    isTablet: kind === "tablet-portrait" || kind === "tablet-landscape",
    isTabletPortrait: kind === "tablet-portrait",
    isTabletLandscape: kind === "tablet-landscape",
    isDesktop: kind === "desktop",
    isAppleTouch,
    isApplePhone,
  };
};

export function useAiPracticeViewportProfile() {
  const [profile, setProfile] = useState<AiPracticeViewportProfile>(DEFAULT_PROFILE);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const apply = () => setProfile(getAiPracticeViewportProfile());
    apply();

    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.visualViewport?.addEventListener("resize", apply);

    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.visualViewport?.removeEventListener("resize", apply);
    };
  }, []);

  return profile;
}
