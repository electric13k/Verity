// Supabase configuration — read once from public env. The anon key is a
// publishable key and safe to ship to the browser; the service-role key MUST
// NEVER appear in the frontend. Both values are inlined at build time
// (NEXT_PUBLIC_*), so AUTH_ENABLED is a static constant.
//
// Env contract (apps/web/.env.local):
//   NEXT_PUBLIC_SUPABASE_URL       — your project URL, e.g. https://xyz.supabase.co
//   NEXT_PUBLIC_SUPABASE_ANON_KEY  — the public anon / publishable key
//
// When the URL is unset the app degrades: no auth wall, and every gateway call
// goes out unauthenticated (the gateway issues a dev-user). Auth gates the app
// ONLY when both values are present.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Auth is on only when the project is fully configured. A missing URL or key
// leaves the whole flow off, so a half-set env never strands a user at a wall
// they can't pass.
export const AUTH_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
