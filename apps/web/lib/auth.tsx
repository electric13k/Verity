"use client";

// Auth context — the single source of truth for who is signed in. Wraps the
// whole tree (app/layout.tsx). When Supabase is unconfigured it reports
// `enabled: false` and the app renders with no wall (dev degrade). When it is
// configured it hydrates the persisted session on load, subscribes to auth
// changes, and forwards the access token to the gateway API layer so every
// `/v1/*` call carries `Authorization: Bearer <token>`. supabase-js owns
// refresh; we just mirror its current token into the API holder.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase } from "./supabase/client";
import { AUTH_ENABLED } from "./supabase/config";
import { setAuthToken } from "./api/config";

// Where an OAuth round-trip returns to: the signed-in app at /app (the public
// landing now owns the origin). Static-export safe (read at call time).
const oauthRedirect = () =>
  typeof window !== "undefined" ? `${window.location.origin}/app` : undefined;

export type OAuthProvider = "github";

interface AuthResult {
  error: string | null;
}

interface AuthContext {
  /** whether Supabase auth is configured at all (false = dev, no wall) */
  enabled: boolean;
  /** true until the initial session hydration settles */
  loading: boolean;
  session: Session | null;
  user: User | null;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult & { needsConfirmation: boolean }>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<AuthResult>;
  resetPassword: (email: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthContext | null>(null);

// Normalize a Supabase error into one calm, user-facing line.
function messageOf(err: unknown): string {
  const m = (err as { message?: string })?.message;
  return m && m.trim() ? m : "Something went wrong. Try again.";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(AUTH_ENABLED);
  const [session, setSession] = useState<Session | null>(null);

  // Keep the gateway API layer's token in lockstep with the live session.
  useEffect(() => {
    setAuthToken(session?.access_token ?? null);
  }, [session]);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const supabase = getSupabase();
    if (!supabase) return { error: null };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? messageOf(error) : null };
  }, []);

  const signUp = useCallback(
    async (email: string, password: string) => {
      const supabase = getSupabase();
      if (!supabase) return { error: null, needsConfirmation: false };
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: oauthRedirect() },
      });
      if (error) return { error: messageOf(error), needsConfirmation: false };
      // No session back means the project requires email confirmation first.
      return { error: null, needsConfirmation: !data.session };
    },
    [],
  );

  const signInWithOAuth = useCallback(async (provider: OAuthProvider): Promise<AuthResult> => {
    const supabase = getSupabase();
    if (!supabase) return { error: null };
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: oauthRedirect() },
    });
    return { error: error ? messageOf(error) : null };
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<AuthResult> => {
    const supabase = getSupabase();
    if (!supabase) return { error: null };
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: oauthRedirect(),
    });
    return { error: error ? messageOf(error) : null };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  const value = useMemo<AuthContext>(
    () => ({
      enabled: AUTH_ENABLED,
      loading,
      session,
      user: session?.user ?? null,
      signIn,
      signUp,
      signInWithOAuth,
      resetPassword,
      signOut,
    }),
    [loading, session, signIn, signUp, signInWithOAuth, resetPassword, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
