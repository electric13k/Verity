import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "@fontsource-variable/fraunces";
import "./globals.css";

import { ThemeProvider } from "@/components/shell/ThemeProvider";
import { AmbientMesh } from "@/components/background/AmbientMesh";
import { PWARegister } from "@/components/pwa/PWARegister";

export const metadata: Metadata = {
  title: "Verity",
  description: "Calm, precise, trustworthy AI orchestration.",
  applicationName: "Verity",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Verity", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F4EE" },
    { media: "(prefers-color-scheme: dark)", color: "#101210" },
  ],
};

// Runs before paint: apply the saved theme so there is no light/dark flash.
const themeInit = `(function(){try{var t=localStorage.getItem('verity-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <ThemeProvider>
          <AmbientMesh />
          {children}
          <PWARegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
