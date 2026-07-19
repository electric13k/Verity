"use client";

import { Sun, Moon, CircleHalf } from "@phosphor-icons/react";
import { clsx } from "clsx";
import { useTheme, type ThemeMode } from "./ThemeProvider";

// Three-state segmented control: light · system · dark. Explicit beats a
// mystery toggle — the person picks a mode and sees which one is engaged.
const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "system", label: "System", Icon: CircleHalf },
  { mode: "dark", label: "Dark", Icon: Moon },
];

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map(({ mode: m, label, Icon }) => (
        <button
          key={m}
          type="button"
          aria-label={label}
          aria-pressed={mode === m}
          title={label}
          onClick={() => setMode(m)}
          className={clsx("theme-toggle__btn", mode === m && "theme-toggle__btn--on")}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}
