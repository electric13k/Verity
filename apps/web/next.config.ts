import type { NextConfig } from "next";

// Static-export capable (Cloudflare Pages at Stage B). Dynamic routes that
// genuinely need a server (share/transcript pages) get revisited then.
const nextConfig: NextConfig = {
  output: "export",
};

export default nextConfig;
