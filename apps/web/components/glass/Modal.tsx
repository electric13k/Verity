"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { clsx } from "clsx";
import { Button } from "./Button";

// Overlay dialog on glass. `variant="sheet"` slides in from the left edge
// (used for nav on narrow viewports); default is a centered modal. Both trap
// Escape, dim the ground, and animate only on open/close — a state change,
// per motion rule 2. Reduced-motion collapses the durations globally.

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  variant?: "modal" | "sheet";
  /** render children edge-to-edge with no header/padding (e.g. the nav drawer) */
  bare?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, variant = "modal", bare = false, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  const isSheet = variant === "sheet";

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex"
          style={{
            alignItems: isSheet ? "stretch" : "center",
            justifyContent: isSheet ? "flex-start" : "center",
            padding: isSheet ? 0 : "var(--v-space-4)",
            background: "color-mix(in oklab, var(--v-porcelain) 55%, transparent)",
            backdropFilter: "blur(3px)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
          role="presentation"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={clsx("glass glass-raised scroll-quiet", className)}
            style={
              isSheet
                ? { width: "min(320px, 84vw)", height: "100%", borderRadius: 0, overflowY: "auto" }
                : { width: "min(480px, 100%)", maxHeight: "84vh", overflowY: "auto" }
            }
            initial={isSheet ? { x: -24, opacity: 0 } : { y: 12, opacity: 0, scale: 0.98 }}
            animate={isSheet ? { x: 0, opacity: 1 } : { y: 0, opacity: 1, scale: 1 }}
            exit={isSheet ? { x: -24, opacity: 0 } : { y: 8, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
          >
            {bare ? (
              children
            ) : (
              <>
                <header className="flex items-center justify-between gap-3" style={{ padding: "var(--v-space-4) var(--v-space-4) var(--v-space-3)" }}>
                  {title && <h2 className="font-display" style={{ fontSize: "1.125rem" }}>{title}</h2>}
                  <Button icon size="sm" variant="quiet" aria-label="Close" onClick={onClose} className="ml-auto">
                    <X size={16} weight="bold" />
                  </Button>
                </header>
                <div style={{ padding: "0 var(--v-space-4) var(--v-space-4)" }}>{children}</div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
