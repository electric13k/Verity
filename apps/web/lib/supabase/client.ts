// The browser Supabase client — created once, lazily, only when the project is
// configured. supabase-js persists the session (localStorage) and refreshes the
// access token on its own; lib/auth.tsx subscribes to it and forwards the token
// to the gateway API layer. Returns null when auth is unconfigured, so callers
// degrade cleanly instead of constructing a client against an empty URL.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AUTH_ENABLED, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!AUTH_ENABLED || typeof window === "undefined") return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
