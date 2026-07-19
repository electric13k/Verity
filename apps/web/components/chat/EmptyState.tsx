"use client";

import { ArrowUpRight } from "@phosphor-icons/react";
import { useApp } from "@/lib/store";

// The empty chat is a first impression, not a void. Editorial hero: an eyebrow
// that names the moment, a Fraunces line set off-center, and three concrete
// openers that seed the stream. Copy is specific, never "How can I help?".

const OPENERS = [
  "Draft a launch checklist for a small hardware product.",
  "Explain retrieval-augmented generation to a skeptical exec.",
  "Turn these rough notes into a one-page brief.",
];

export function EmptyState() {
  const { send } = useApp();
  return (
    <div className="empty">
      <div className="empty__inner v-rise">
        <span className="eyebrow">Verity · New session</span>
        <h1 className="font-display empty__title">
          A calm place to think with a model that shows its work.
        </h1>
        <p className="empty__sub">
          Ask anything. Every answer carries a confidence read, and any reply can branch
          into a Flow or an Office when a single response isn&apos;t enough.
        </p>
        <div className="empty__openers">
          {OPENERS.map((o) => (
            <button key={o} type="button" className="opener" onClick={() => void send(o)}>
              <span>{o}</span>
              <ArrowUpRight size={15} weight="bold" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
