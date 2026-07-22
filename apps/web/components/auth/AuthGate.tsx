"use client";

import { useAuth } from "@/lib/auth";
import { AuthScreen } from "./AuthScreen";

// The route gate. Three outcomes, in order:
//   auth off      → render the app (dev degrade — no wall, echo flow intact)
//   hydrating     → a calm, wordmark-only hold (no spinner slop)
//   off / no user → the auth screen
//   signed in     → the app
// The public transcript route lives outside this group, so a share never gates.

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { enabled, loading, session } = useAuth();

  if (!enabled) return <>{children}</>;

  if (loading) {
    return (
      <div className="auth-hold" aria-busy="true" aria-label="Loading Verity">
        <span className="auth-hold__mark font-display">Verity</span>
        <span className="think-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
    );
  }

  if (!session) return <AuthScreen />;

  return <>{children}</>;
}
