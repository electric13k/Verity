// Where the gateway lives.
//
// Dev: "/gw" is rewritten to the local Go gateway by next.config.ts, so the
// browser talks to it same-origin (no CORS; the gateway is not ours to edit).
// Prod (static export): set NEXT_PUBLIC_GATEWAY_URL to the deployed origin.
export const GATEWAY_BASE =
  process.env.NEXT_PUBLIC_GATEWAY_URL?.replace(/\/$/, "") ?? "/gw";

export const apiUrl = (path: string) =>
  `${GATEWAY_BASE}${path.startsWith("/") ? path : `/${path}`}`;

// Adapter selection happens ONCE here. Default is live (the gateway); set
// NEXT_PUBLIC_VERITY_MOCK=1 to fall back to the in-memory mock for offline UI
// dev. `NEXT_PUBLIC_*` is inlined at build time, so this is a static constant.
export const IS_MOCK = process.env.NEXT_PUBLIC_VERITY_MOCK === "1";

// The note shown on views whose data comes from the platform surface, so the
// UI never claims "mock" when it is really talking to the gateway.
export const PLATFORM_NOTICE = IS_MOCK
  ? "Persistence, offices, keys, and transcripts are served by an in-memory mock (NEXT_PUBLIC_VERITY_MOCK=1). Chat and flows stream live."
  : "Persistence, offices, keys, and transcripts are live against the Verity gateway.";
