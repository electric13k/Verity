// Where the gateway lives.
//
// Dev: "/gw" is rewritten to the local Go gateway by next.config.ts, so the
// browser talks to it same-origin (no CORS; the gateway is not ours to edit).
// Prod (static export): set NEXT_PUBLIC_GATEWAY_URL to the deployed origin.
export const GATEWAY_BASE =
  process.env.NEXT_PUBLIC_GATEWAY_URL?.replace(/\/$/, "") ?? "/gw";

export const apiUrl = (path: string) =>
  `${GATEWAY_BASE}${path.startsWith("/") ? path : `/${path}`}`;

// --- auth token injection --------------------------------------------------
// The gateway verifies a Supabase JWT from `Authorization: Bearer <token>`
// (auth provider selected server-side). The Supabase auth layer (lib/auth.tsx)
// pushes the current access token here on every session change; supabase-js
// owns refresh, so this holder always reflects the live token. When auth is
// unconfigured the token stays null and no header is sent — the gateway keeps
// its dev posture (dev-user), so local dev and the echo flow work with no wall.
let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

// Merge onto any request headers. Empty when there is no token, so callers can
// spread it unconditionally without forcing an Authorization header in dev.
export function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

// Adapter selection happens ONCE here. Default is live (the gateway); set
// NEXT_PUBLIC_VERITY_MOCK=1 to fall back to the in-memory mock for offline UI
// dev. `NEXT_PUBLIC_*` is inlined at build time, so this is a static constant.
export const IS_MOCK = process.env.NEXT_PUBLIC_VERITY_MOCK === "1";

// The note shown on views whose data comes from the platform surface, so the
// UI never claims "mock" when it is really talking to the gateway.
export const PLATFORM_NOTICE = IS_MOCK
  ? "Persistence, offices, keys, and transcripts are served by an in-memory mock (NEXT_PUBLIC_VERITY_MOCK=1). Chat and flows stream live."
  : "Persistence, offices, keys, and transcripts are live against the Verity gateway.";
