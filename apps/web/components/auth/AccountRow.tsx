"use client";

import { SignOut } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";

// The signed-in identity in the shell: initials (not an avatar image, never an
// emoji) drawn from the email, the address itself, and a quiet sign-out. Renders
// nothing when auth is off (dev) or no one is signed in — the shell stays clean.

function initialsFor(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[.\-_+]/).filter(Boolean);
  const letters =
    parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return (letters || email.slice(0, 2)).toUpperCase();
}

export function AccountRow() {
  const { enabled, user, signOut } = useAuth();
  if (!enabled || !user) return null;

  const email = user.email ?? "Signed in";

  return (
    <div className="account-row">
      <span className="account-row__avatar" aria-hidden="true">
        {initialsFor(email)}
      </span>
      <span className="account-row__email" title={email}>
        {email}
      </span>
      <button
        type="button"
        className="account-row__out"
        aria-label="Sign out"
        title="Sign out"
        onClick={() => void signOut()}
      >
        <SignOut size={15} />
      </button>
    </div>
  );
}
