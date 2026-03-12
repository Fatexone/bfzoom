// app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthSessionBridge from "@/components/auth/AuthSessionBridge";
import { UiLocaleProvider } from "@/components/ui/UiLocaleProvider";

export const metadata: Metadata = {
  title: "BFZoom",
  description: "Visioconference, coaching et collaboration en temps reel.",
  applicationName: "BFZoom",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "BFZoom",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/pwa-192.png",
    apple: "/apple-touch-icon.png",
  },
};

// ✅ Viewport optimisé iOS (évite les bandes, gère la dynamic viewport height)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0ea5e9",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="h-full">
      <body
        className="antialiased bg-neutral-950 text-white"
      >
        <AuthSessionBridge />
        {/* ✅ Wrapper plein écran avec scroll vertical autorisé */}
        <UiLocaleProvider>
          <div className="min-h-dvh w-full overflow-x-hidden">
            {children}
          </div>
        </UiLocaleProvider>
      </body>
    </html>
  );
}