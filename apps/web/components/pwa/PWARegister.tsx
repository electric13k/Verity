"use client";

import { useEffect } from "react";

// Registers the service worker (public/sw.js) once the app has mounted and the
// page is idle, so precaching never competes with first paint. Production only:
// in `next dev` the SW would cache stale bundles between edits. No UI.

export function PWARegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration is best-effort; the app works without it */
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
