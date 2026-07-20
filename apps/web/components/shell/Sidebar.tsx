"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import {
  ChatTeardropText,
  FlowArrow,
  Buildings,
  Cpu,
  NotePencil,
  PencilSimple,
  TrashSimple,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import { useApp } from "@/lib/store";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "Chat", Icon: ChatTeardropText },
  { href: "/flows", label: "Flows", Icon: FlowArrow },
  { href: "/offices", label: "Offices", Icon: Buildings },
  { href: "/compute", label: "Compute", Icon: Cpu },
  { href: "/settings", label: "Settings", Icon: SlidersHorizontal },
];

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    conversations,
    currentId,
    newConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
  } = useApp();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const beginRename = (id: string, title: string) => {
    setEditingId(id);
    setDraft(title);
  };
  const commitRename = () => {
    const id = editingId;
    const title = draft.trim();
    setEditingId(null);
    if (id && title) void renameConversation(id, title);
  };

  const goToConversation = (id: string) => {
    selectConversation(id);
    if (pathname !== "/") router.push("/");
    onNavigate?.();
  };

  const startNew = () => {
    newConversation();
    if (pathname !== "/") router.push("/");
    onNavigate?.();
  };

  return (
    <div className="flex h-full flex-col" style={{ padding: "var(--v-space-4)" }}>
      {/* Wordmark — the editorial anchor. */}
      <div className="flex items-baseline gap-2" style={{ paddingLeft: "var(--v-space-2)" }}>
        <span className="font-display" style={{ fontSize: "1.5rem", fontWeight: 500 }}>
          Verity
        </span>
        <span className="eyebrow" style={{ fontSize: "0.5625rem" }}>
          Atelier
        </span>
      </div>

      <div style={{ height: "var(--v-space-5)" }} />

      <button type="button" className="gbtn gbtn--primary" onClick={startNew} style={{ width: "100%" }}>
        <NotePencil size={16} />
        New conversation
      </button>

      <div style={{ height: "var(--v-space-4)" }} />

      {/* Primary navigation. */}
      <nav className="flex flex-col gap-1" aria-label="Primary">
        {NAV.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={clsx("nav-item", active && "nav-item--active")}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={18} weight={active ? "fill" : "regular"} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div style={{ height: "var(--v-space-4)" }} />
      <div className="eyebrow" style={{ paddingLeft: "var(--v-space-3)", marginBottom: "var(--v-space-2)" }}>
        History
      </div>

      {/* Conversation list from the typed client. */}
      <div className="scroll-quiet flex-1 overflow-y-auto" style={{ margin: "0 calc(-1 * var(--v-space-1))", paddingRight: "var(--v-space-1)" }}>
        {conversations.length === 0 ? (
          <p className="px-3 text-sm" style={{ color: "color-mix(in oklab, var(--v-ink) 45%, transparent)" }}>
            No conversations yet.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={clsx("conv-row", c.id === currentId && pathname === "/" && "conv-row--active")}
                role="button"
                tabIndex={0}
                onClick={() => editingId !== c.id && goToConversation(c.id)}
                onKeyDown={(e) =>
                  editingId !== c.id &&
                  (e.key === "Enter" || e.key === " ") &&
                  (e.preventDefault(), goToConversation(c.id))
                }
              >
                {editingId === c.id ? (
                  <input
                    className="conv-row__title"
                    value={draft}
                    autoFocus
                    aria-label="Conversation title"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      font: "inherit",
                      color: "inherit",
                      background: "transparent",
                      border: "1px solid color-mix(in oklab, var(--v-ink) 30%, transparent)",
                      borderRadius: 6,
                      padding: "1px 5px",
                      outline: "none",
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === "Escape") {
                        setEditingId(null);
                      }
                    }}
                  />
                ) : (
                  <>
                    <span className="conv-row__title">{c.title}</span>
                    <span className="eyebrow" style={{ fontSize: "0.5625rem", flex: "none" }}>{timeAgo(c.updated_at)}</span>
                    <button
                      type="button"
                      className="conv-row__del"
                      aria-label={`Rename ${c.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        beginRename(c.id, c.title);
                      }}
                    >
                      <PencilSimple size={14} />
                    </button>
                    <button
                      type="button"
                      className="conv-row__del"
                      aria-label={`Delete ${c.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConversation(c.id);
                      }}
                    >
                      <TrashSimple size={14} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="hairline" style={{ margin: "var(--v-space-3) 0" }} />

      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow" style={{ fontSize: "0.5625rem" }}>Theme</span>
        <ThemeToggle />
      </div>
    </div>
  );
}
