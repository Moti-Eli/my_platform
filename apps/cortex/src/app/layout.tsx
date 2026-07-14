import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { tokenStylesheet, palette } from "@/design-system";
import { AppShell } from "@/components/shell/AppShell";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cortex",
  description: "Cortex — סופר-אפליקציה לניהול העסק שלך.",
  applicationName: "Cortex",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Cortex",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/icon.svg" }],
  },
};

export const viewport: Viewport = {
  themeColor: palette.indigo,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-dvh antialiased">
        {/* Design-system tokens as :root CSS variables (see @/design-system). */}
        <style dangerouslySetInnerHTML={{ __html: tokenStylesheet() }} />
        <ServiceWorkerRegister />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
