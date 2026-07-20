"use client";

// App store: conversations + the chat engine. One context so the sidebar,
// composer, and message list stay in sync. Chat / regenerate / edit stream live
// against the gateway; persistence/history is the platform adapter (lib/api),
// live by default. New conversations surface their real id + auto-name from the
// stream's `meta` frame with no reload; after each turn settles we reconcile
// with server truth so real message ids back edit / regenerate / branch.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  api,
  chatStream,
  editMessageStream,
  regenerateStream,
} from "./api/client";
import { PLATFORM_NOTICE } from "./api/config";
import { MODEL_CATALOG } from "./api/mock";
import {
  bandForScore,
  type BranchKind,
  type ChatStreamHandlers,
  type Conversation,
  type Me,
  type Message,
  type ModelOption,
} from "./api/types";

const DEFAULT_SELECTOR = "echo:echo";
const now = () => new Date().toISOString();

interface AppStore {
  mockNotice: string;
  me: Me | null;
  models: ModelOption[];
  selector: string;
  setSelector: (s: string) => void;
  useMemory: boolean;
  setUseMemory: (v: boolean) => void;

  conversations: Conversation[];
  currentId: string | null;
  messages: Message[];
  streaming: boolean;

  newConversation: () => void;
  selectConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;

  send: (text: string, fileIds?: string[]) => Promise<void>;
  stop: () => void;
  regenerate: (assistantId: string) => Promise<void>;
  editUserMessage: (id: string, content: string) => Promise<void>;
  branch: (messageId: string, kind: BranchKind) => Promise<string>;
}

const Ctx = createContext<AppStore | null>(null);

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [selector, setSelector] = useState(DEFAULT_SELECTOR);
  const [useMemory, setUseMemory] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  // currentId inside async closures.
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = currentId;

  useEffect(() => {
    // Both degrade to safe defaults if the gateway/DB is down (never blank).
    api.me().then(setMe);
    api.listConversations().then(setConversations);
  }, []);

  const refreshList = useCallback(() => {
    api.listConversations().then(setConversations);
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  // Shared streaming tail for chat / regenerate / edit. `runFn` performs the
  // live SSE call; the assistant reply accumulates into `asstId`. The `meta`
  // frame surfaces a new conversation's id + auto-name and the real assistant
  // message id; on completion we reconcile the thread with server truth.
  const consumeStream = useCallback(
    async (
      runFn: (handlers: ChatStreamHandlers, signal: AbortSignal) => Promise<void>,
      asstId: string,
    ) => {
      setStreaming(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let acc = "";
      let pendingConf: { score: number; rationale?: string } | null = null;

      await runFn(
        {
          onMeta: (m) => {
            if (m.conversation_id) {
              if (!currentIdRef.current) {
                // New conversation: adopt its real id + auto-name, no reload.
                currentIdRef.current = m.conversation_id;
                setCurrentId(m.conversation_id);
                setConversations((prev) => [
                  { id: m.conversation_id, title: m.title || "New conversation", updated_at: now() },
                  ...prev.filter((c) => c.id !== m.conversation_id),
                ]);
              } else if (m.title) {
                const title = m.title;
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === currentIdRef.current ? { ...c, title, updated_at: now() } : c,
                  ),
                );
              }
            }
            // Adopt the real assistant id now. `meta` precedes every delta, so
            // the bubble is still empty and re-keying is invisible — and it
            // means the refetch on done won't remount this message.
            if (m.message_id) {
              const realId = m.message_id;
              setMessages((prev) => prev.map((x) => (x.id === asstId ? { ...x, id: realId } : x)));
              asstId = realId;
            }
          },
          onDelta: (t) => {
            acc += t;
            patchMessage(asstId, { content: acc });
          },
          onConfidence: (c) => {
            pendingConf = c;
          },
          onError: (msg) => patchMessage(asstId, { error: msg, streaming: false }),
          onDone: () => {},
        },
        ctrl.signal,
      );

      // `pendingConf` is only assigned inside the stream callback; read it
      // through a typed local so TS doesn't narrow it to `never` here.
      const conf = pendingConf as { score: number; rationale?: string } | null;
      patchMessage(asstId, {
        streaming: false,
        ...(conf
          ? {
              confidence: {
                score: conf.score,
                band: bandForScore(conf.score),
                rationale: conf.rationale,
              },
            }
          : {}),
      });
      setStreaming(false);
      abortRef.current = null;

      // Reconcile with server truth: real ids (so edit/branch/regenerate work)
      // and persisted confidence. Only the newest user bubble re-keys; prior
      // messages keep their ids, so there is no thread-wide re-animation.
      const cid = currentIdRef.current;
      if (cid) {
        const detail = await api.getConversation(cid).catch(() => null);
        if (detail && detail.messages.length) setMessages(detail.messages);
        refreshList();
      }
    },
    [patchMessage, refreshList],
  );

  const send = useCallback(
    async (text: string, fileIds?: string[]) => {
      const trimmed = text.trim();
      const hasFiles = !!(fileIds && fileIds.length);
      if ((!trimmed && !hasFiles) || streaming) return;
      const message = trimmed || "Please review the attached file.";
      const userMsg: Message = {
        id: `m_${Date.now()}u`,
        role: "user",
        content: message,
        created_at: now(),
      };
      const asstMsg: Message = {
        id: `m_${Date.now()}a`,
        role: "assistant",
        content: "",
        created_at: now(),
        streaming: true,
      };
      setMessages((prev) => [...prev, userMsg, asstMsg]);
      await consumeStream(
        (handlers, signal) =>
          chatStream(
            {
              ...(currentIdRef.current ? { conversation_id: currentIdRef.current } : {}),
              message,
              model: selector,
              use_memory: useMemory,
              ...(hasFiles ? { files: fileIds } : {}),
            },
            handlers,
            signal,
          ),
        asstMsg.id,
      );
    },
    [streaming, consumeStream, selector, useMemory],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
  }, []);

  const regenerate = useCallback(
    async (assistantId: string) => {
      if (streaming) return;
      const cur = messagesRef.current;
      const idx = cur.findIndex((m) => m.id === assistantId);
      if (idx < 0) return;
      const fresh: Message = {
        id: `m_${Date.now()}a`,
        role: "assistant",
        content: "",
        created_at: now(),
        streaming: true,
      };
      setMessages([...cur.slice(0, idx), fresh]);
      await consumeStream(
        (handlers, signal) =>
          regenerateStream(assistantId, { model: selector, memory: useMemory }, handlers, signal),
        fresh.id,
      );
    },
    [streaming, consumeStream, selector, useMemory],
  );

  const editUserMessage = useCallback(
    async (id: string, content: string) => {
      if (streaming) return;
      const cur = messagesRef.current;
      const idx = cur.findIndex((m) => m.id === id);
      if (idx < 0) return;
      const trimmed = content.trim();
      if (!trimmed) return;
      const edited: Message = { ...cur[idx], content: trimmed, created_at: now() };
      const asst: Message = {
        id: `m_${Date.now()}a`,
        role: "assistant",
        content: "",
        created_at: now(),
        streaming: true,
      };
      setMessages([...cur.slice(0, idx), edited, asst]);
      await consumeStream(
        (handlers, signal) =>
          editMessageStream(id, trimmed, { model: selector, memory: useMemory }, handlers, signal),
        asst.id,
      );
    },
    [streaming, consumeStream, selector, useMemory],
  );

  const newConversation = useCallback(() => {
    if (streaming) stop();
    currentIdRef.current = null;
    setCurrentId(null);
    setMessages([]);
  }, [streaming, stop]);

  const selectConversation = useCallback(
    async (id: string) => {
      if (streaming) stop();
      const detail = await api.getConversation(id);
      currentIdRef.current = id;
      setCurrentId(id);
      setMessages(detail?.messages ?? []);
    },
    [streaming, stop],
  );

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      await api.renameConversation(id, title);
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
      refreshList();
    },
    [refreshList],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      await api.deleteConversation(id);
      if (currentIdRef.current === id) newConversation();
      setConversations((prev) => prev.filter((c) => c.id !== id));
      refreshList();
    },
    [refreshList, newConversation],
  );

  const branch = useCallback(async (messageId: string, kind: BranchKind) => {
    // The run id is a convenience for the chip; a failure (e.g. a not-yet-
    // persisted message) must not block the handoff/navigation.
    try {
      const { run_id } = await api.branch(messageId, kind);
      return run_id;
    } catch {
      return "";
    }
  }, []);

  const value = useMemo<AppStore>(
    () => ({
      mockNotice: PLATFORM_NOTICE,
      me,
      models: MODEL_CATALOG,
      selector,
      setSelector,
      useMemory,
      setUseMemory,
      conversations,
      currentId,
      messages,
      streaming,
      newConversation,
      selectConversation,
      renameConversation,
      deleteConversation,
      send,
      stop,
      regenerate,
      editUserMessage,
      branch,
    }),
    [
      me, selector, useMemory, conversations, currentId, messages, streaming,
      newConversation, selectConversation, renameConversation, deleteConversation,
      send, stop, regenerate, editUserMessage, branch,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within AppProviders");
  return v;
}
