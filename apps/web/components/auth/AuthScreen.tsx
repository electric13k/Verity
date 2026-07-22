"use client";

import { useState } from "react";
import { motion } from "motion/react";
import {
  GithubLogo,
  Eye,
  EyeSlash,
  ArrowRight,
  CheckCircle,
  Warning,
} from "@phosphor-icons/react";
import { Input } from "@/components/glass/Field";
import { useAuth } from "@/lib/auth";

// The gate's face. An editorial split — the atelier line on the left, the glass
// auth card on the right (the one glowing surface in the view). Sign in and
// create an account share the card; a segmented tab switches between them.
// Email/password plus one OAuth provider (GitHub), a forgot-password path, and
// calm inline status. No wall of options, no emoji — the same register as the
// rest of the workspace.

type Mode = "signin" | "signup";

const emailValid = (v: string) => /.+@.+\..+/.test(v.trim());

export function AuthScreen() {
  const { signIn, signUp, signInWithOAuth, resetPassword } = useAuth();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canSubmit = emailValid(email) && password.length >= 6 && !busy;

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    if (mode === "signin") {
      const { error } = await signIn(email.trim(), password);
      if (error) setError(error);
      // On success, the auth listener swaps this screen for the app.
    } else {
      const { error, needsConfirmation } = await signUp(email.trim(), password);
      if (error) setError(error);
      else if (needsConfirmation)
        setNotice(`Check ${email.trim()} for a link to confirm your account.`);
    }
    setBusy(false);
  };

  const onOAuth = async () => {
    setBusy(true);
    setError(null);
    const { error } = await signInWithOAuth("github");
    if (error) {
      setError(error);
      setBusy(false);
    }
    // On success the browser leaves for GitHub; no need to reset busy.
  };

  const onForgot = async () => {
    if (!emailValid(email)) {
      setError("Enter your email above, then request a reset link.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error } = await resetPassword(email.trim());
    if (error) setError(error);
    else setNotice(`Sent a reset link to ${email.trim()}.`);
    setBusy(false);
  };

  const submitLabel = mode === "signin" ? "Sign in" : "Create account";

  return (
    <div className="auth">
      <div className="auth__stage">
        <aside className="auth__aside">
          <span className="eyebrow">Verity · Atelier</span>
          <h1 className="auth__wordmark font-display">Verity</h1>
          <p className="auth__lede">
            Calm, precise orchestration — chat, flows, and standing offices in one
            workspace.
          </p>
          <ul className="auth__points">
            <li>Branch any message into a company of roles.</li>
            <li>Stand up an office that works on a schedule.</li>
            <li>Every answer carries a confidence read.</li>
          </ul>
        </aside>

        <motion.section
          className="glass glass-raised glow-focus auth__card"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
          aria-label={mode === "signin" ? "Sign in" : "Create an account"}
        >
          <div className="auth__tabs" role="tablist" aria-label="Sign in or create an account">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signin"}
              className={`auth__tab${mode === "signin" ? " auth__tab--on" : ""}`}
              onClick={() => switchMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              className={`auth__tab${mode === "signup" ? " auth__tab--on" : ""}`}
              onClick={() => switchMode("signup")}
            >
              Create account
            </button>
          </div>

          <h2 className="auth__title font-display">
            {mode === "signin" ? "Welcome back." : "Make an account."}
          </h2>

          <form className="auth__form" onSubmit={submit} noValidate>
            <label className="field-row">
              <span className="eyebrow">Email</span>
              <Input
                type="email"
                value={email}
                autoComplete="email"
                autoFocus
                placeholder="you@studio.com"
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Email"
              />
            </label>

            <label className="field-row">
              <span className="eyebrow">Password</span>
              <div className="auth__password">
                <Input
                  type={reveal ? "text" : "password"}
                  value={password}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  placeholder={mode === "signin" ? "Your password" : "At least 6 characters"}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-label="Password"
                />
                <button
                  type="button"
                  className="auth__reveal"
                  aria-label={reveal ? "Hide password" : "Show password"}
                  onClick={() => setReveal((v) => !v)}
                >
                  {reveal ? <EyeSlash size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {mode === "signin" && (
                <button type="button" className="auth__forgot" onClick={onForgot}>
                  Forgot your password?
                </button>
              )}
            </label>

            {error && (
              <p className="auth__error" role="alert">
                <Warning size={14} weight="fill" />
                {error}
              </p>
            )}
            {notice && (
              <p className="auth__notice" role="status">
                <CheckCircle size={14} weight="fill" />
                {notice}
              </p>
            )}

            <button
              type="submit"
              className="gbtn gbtn--primary auth__submit"
              disabled={!canSubmit}
            >
              {busy ? "Working…" : submitLabel}
              {!busy && <ArrowRight size={15} />}
            </button>
          </form>

          <div className="auth__or">
            <span className="hairline" />
            <span className="auth__or-label">or</span>
            <span className="hairline" />
          </div>

          <button
            type="button"
            className="gbtn gbtn--quiet auth__oauth"
            onClick={onOAuth}
            disabled={busy}
          >
            <GithubLogo size={17} weight="fill" />
            Continue with GitHub
          </button>

          <p className="auth__switch">
            {mode === "signin" ? (
              <>
                New to Verity?{" "}
                <button type="button" onClick={() => switchMode("signup")}>
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button type="button" onClick={() => switchMode("signin")}>
                  Sign in
                </button>
              </>
            )}
          </p>
        </motion.section>
      </div>
    </div>
  );
}
