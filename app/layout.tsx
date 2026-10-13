import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Pool Dooks",
  description: "Play Pool Dooks with friends across any device",
  manifest: "/manifest.json",
  // Served from /icons, which the auth proxy lets through for logged-out visitors.
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-96.png", sizes: "96x96", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Pool Dooks",
  },
};

export const viewport: Viewport = {
  themeColor: "#e5e059",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.className} antialiased bg-background min-h-screen`}>
        {children}
        <Toaster richColors position="top-center" />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
