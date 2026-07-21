import type { NextConfig } from "next";

// Static-export capable (Cloudflare Pages at Stage B). Dynamic routes that
// genuinely need a server (share/transcript pages) get revisited then.
//
// Dev-only convenience: in `next dev` we proxy `/gw/*` to the local Go gateway
// so the browser talks to it same-origin (no CORS, and the gateway is not ours
// to edit). This rewrite is omitted for production builds, where the frontend
// points at NEXT_PUBLIC_GATEWAY_URL directly — so `output: "export"` stays clean.
const isDev = process.env.NODE_ENV !== "production";
const gatewayOrigin = process.env.GATEWAY_ORIGIN ?? "http://127.0.0.1:8080";

const nextConfig: NextConfig = {
  output: "export",
  // `output: "export"` has no image optimization server, so next/image must be
  // told not to expect one — without this, any <Image> fails the static export.
  // Assets ship pre-sized (see components/media/Img.tsx for the app convention).
  images: { unoptimized: true },
  ...(isDev
    ? {
        async rewrites() {
          return [{ source: "/gw/:path*", destination: `${gatewayOrigin}/:path*` }];
        },
      }
    : {}),
};

export default nextConfig;
