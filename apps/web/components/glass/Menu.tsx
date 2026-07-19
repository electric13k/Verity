"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { clsx } from "clsx";

// Anchored popover menu on glass. Used by the model picker and the
// branch-into menu. Opens on trigger click, closes on outside-click / Escape.
// Animation fires only on open/close (a state change), not idly.

interface MenuProps {
  trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  side?: "top" | "bottom";
  className?: string;
}

export function Menu({ trigger, children, align = "start", side = "bottom", className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v), id })}
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            role="menu"
            className={clsx("glass glass-raised scroll-quiet", className)}
            style={{
              position: "absolute",
              zIndex: 40,
              minWidth: "12rem",
              maxHeight: "min(60vh, 22rem)",
              overflowY: "auto",
              padding: "var(--v-space-1)",
              [side === "bottom" ? "top" : "bottom"]: "calc(100% + 6px)",
              [align === "start" ? "left" : "right"]: 0,
            }}
            initial={{ opacity: 0, y: side === "bottom" ? -6 : 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: side === "bottom" ? -4 : 4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// A single row inside a Menu.
interface MenuItemProps {
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}

export function MenuItem({ onClick, active, disabled, icon, hint, children }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={clsx("menu-item", active && "menu-item--active")}
    >
      {icon && <span className="menu-item__icon">{icon}</span>}
      <span className="menu-item__label">{children}</span>
      {hint && <span className="menu-item__hint">{hint}</span>}
    </button>
  );
}
