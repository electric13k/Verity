// Where the gateway lives.
//
// Dev: "/gw" is rewritten to the local Go gateway by next.config.ts, so the
// browser talks to it same-origin (no CORS; the gateway is not ours to edit).
// Prod (static export): set NEXT_PUBLIC_GATEWAY_URL to the deployed origin.
export const GATEWAY_BASE =
  process.env.NEXT_PUBLIC_GATEWAY_URL?.replace(/\/$/, "") ?? "/gw";

export const apiUrl = (path: string) =>
  `${GATEWAY_BASE}${path.startsWith("/") ? path : `/${path}`}`;
