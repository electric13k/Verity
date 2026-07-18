import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Verity",
  description: "Calm, precise, trustworthy AI orchestration.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
