"use client";

import { useState } from "react";
import { List } from "@phosphor-icons/react";
import { Sidebar } from "./Sidebar";
import { Modal } from "@/components/glass/Modal";

// Two-pane shell: a floating glass rail (the sidebar) over the ambient mesh,
// and the routed content. Below the lg breakpoint the rail collapses into a
// slide-in sheet reachable from a single glass button — the same Sidebar,
// one implementation.

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sheet, setSheet] = useState(false);

  return (
    <div className="app-shell">
      {/* Desktop rail. */}
      <aside className="app-shell__rail glass scroll-quiet">
        <Sidebar />
      </aside>

      {/* Mobile trigger. */}
      <button
        type="button"
        className="app-shell__menu gbtn gbtn--quiet gbtn--icon"
        aria-label="Open menu"
        onClick={() => setSheet(true)}
      >
        <List size={18} />
      </button>

      <Modal open={sheet} onClose={() => setSheet(false)} variant="sheet" bare>
        <Sidebar onNavigate={() => setSheet(false)} />
      </Modal>

      <main className="app-shell__main">{children}</main>
    </div>
  );
}
