"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeCtx {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (m: ThemeMode) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const KEY = "verity-theme";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  const apply = useCallback((m: ThemeMode) => {
    const root = document.documentElement;
    if (m === "system") {
      root.removeAttribute("data-theme");
      setResolved(systemPrefersDark() ? "dark" : "light");
    } else {
      root.setAttribute("data-theme", m);
      setResolved(m);
    }
  }, []);

  useEffect(() => {
    let stored: ThemeMode = "system";
    try {
      const s = localStorage.getItem(KEY);
      if (s === "light" || s === "dark") stored = s;
    } catch {
      /* ignore */
    }
    setModeState(stored);
    apply(stored);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (localStorage.getItem(KEY) == null) setResolved(mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [apply]);

  const setMode = useCallback(
    (m: ThemeMode) => {
      setModeState(m);
      try {
        if (m === "system") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, m);
      } catch {
        /* ignore */
      }
      apply(m);
    },
    [apply],
  );

  return <Ctx.Provider value={{ mode, resolved, setMode }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme must be used within ThemeProvider");
  return v;
}
