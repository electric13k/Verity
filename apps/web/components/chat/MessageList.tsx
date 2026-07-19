"use client";

import { useEffect, useRef } from "react";
import { useApp } from "@/lib/store";
import { MessageBubble } from "./MessageBubble";

// Scroll region for the thread. Auto-sticks to the bottom while new content
// arrives, but only if the reader is already near the bottom — scrolling up to
// re-read is never yanked back down.

export function MessageList() {
  const { messages, currentId } = useApp();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // Jump to the newest content on stream/append when stuck to the bottom.
  const last = messages[messages.length - 1];
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, last?.content]);

  // New conversation opened → reset to top.
  useEffect(() => {
    stick.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [currentId]);

  return (
    <div ref={scrollRef} onScroll={onScroll} className="msg-list scroll-quiet">
      <div className="msg-list__inner">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>
    </div>
  );
}
