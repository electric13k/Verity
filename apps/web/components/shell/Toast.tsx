"use client";

import { AnimatePresence, motion } from "motion/react";
import { Warning, Info, X } from "@phosphor-icons/react";
import { useApp } from "@/lib/store";

// The app's one quiet notice. It carries optimistic-rollback messages: a write
// failed, the UI was put back, here's what happened — no modal, no red wall.
// It slides up once (a state change), sits briefly, and leaves. Reduced motion
// zeroes the transition globally, so it simply appears and disappears.

export function Toast() {
  const { toast, dismissToast } = useApp();
  const isError = toast?.tone !== "info";

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          className="v-toast glass glass-raised"
          role="status"
          aria-live="polite"
          data-tone={toast.tone}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
        >
          <span className="v-toast__icon" aria-hidden="true">
            {isError ? <Warning size={15} weight="fill" /> : <Info size={15} />}
          </span>
          <span className="v-toast__msg">{toast.message}</span>
          <button
            type="button"
            className="v-toast__x"
            aria-label="Dismiss"
            onClick={dismissToast}
          >
            <X size={13} weight="bold" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
