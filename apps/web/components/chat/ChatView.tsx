"use client";

import { Info } from "@phosphor-icons/react";
import { useApp } from "@/lib/store";
import { EmptyState } from "./EmptyState";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";

// The chat surface: a slim header (conversation title + dev-mock note), the
// thread or the empty hero, and the composer pinned at the foot. The column is
// width-capped and centered so long lines stay readable on wide displays.

export function ChatView() {
  const { messages, conversations, currentId, mockNotice } = useApp();
  const conv = conversations.find((c) => c.id === currentId);
  const hasThread = messages.length > 0;

  return (
    <div className="chat">
      <header className="chat__header">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">Chat</span>
          <h1 className="chat__title font-display">
            {conv?.title ?? "New conversation"}
          </h1>
        </div>
        <span className="chat__note" title={mockNotice}>
          <Info size={13} />
          Dev mode
        </span>
      </header>

      <div className="chat__body">
        {hasThread ? <MessageList /> : <EmptyState />}
      </div>

      <div className="chat__foot">
        <div className="chat__foot-inner">
          <Composer />
        </div>
      </div>
    </div>
  );
}
