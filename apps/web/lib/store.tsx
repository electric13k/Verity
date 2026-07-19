"use client";

// App store: conversations + the chat engine. One context so the sidebar,
// composer, and message list stay in sync. Streaming is live against the
// gateway; persistence/history is the mock adapter (see lib/api).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, chatStream } from "./api/client";
import { MODEL_CATALOG, MOCK_NOTICE } from "./api/mock";
import {
  bandForScore,
  type BranchKind,
  type Conversation,
  type Me,
  type Message,
  type ModelOption,
} from "./api/types";

const DEFAULT_SELECTOR = "echo:echo";
const now = () => new Date().toISOString();

function autoTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const words = clean.split(" ").slice(0, 7).join(" ");
  return words.length < clean.length ? `${words}…` : words || "New conversation";
}

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

  send: (text: string) => Promise<void>;
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

  useEffect(() => {
    api.me().then(setMe);
    api.listConversations().then(setConversations);
  }, []);

  const refreshList = useCallback(() => {
    api.listConversations().then(setConversations);
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  // Runs a live chat stream that appends into the assistant message `asstId`.
  const runStream = useCallback(
    async (text: string, asstId: string) => {
      setStreaming(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let acc = "";
      let pendingConf: { score: number; rationale?: string } | null = null;

      await chatStream(
        { message: text, model: selector, use_memory: useMemory },
        {
          onDelta: (t) => {
            acc += t;
            patchMessage(asstId, { content: acc });
          },
          onConfidence: (c) => {
            pendingConf = c;
          },
          onError: (msg) => patchMessage(asstId, { error: msg }),
          onDone: () => {},
        },
        ctrl.signal,
      );

      // `pendingConf` is only ever assigned inside the stream callback above;
      // TS can't see that across the closure, so read it through a typed local
      // (otherwise it narrows to `never` here).
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

      // Persist the settled thread (and auto-name a fresh conversation).
      const cid = currentIdRef.current;
      if (cid) {
        const settled = messagesRef.current;
        const conv = conversations.find((c) => c.id === cid);
        const firstUser = settled.find((m) => m.role === "user");
        const title =
          conv && (conv.title === "New conversation" || !conv.title) && firstUser
            ? autoTitle(firstUser.content)
            : undefined;
        await api.saveMessages(cid, settled, title);
        refreshList();
      }
    },
    [selector, useMemory, patchMessage, conversations, refreshList],
  );

  // currentId inside async closures.
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = currentId;

  const ensureConversation = useCallback(async (): Promise<string> => {
    if (currentIdRef.current) return currentIdRef.current;
    const conv = await api.createConversation();
    currentIdRef.current = conv.id;
    setCurrentId(conv.id);
    setConversations((prev) => [{ id: conv.id, title: conv.title, updated_at: conv.updated_at }, ...prev]);
    return conv.id;
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      await ensureConversation();
      const userMsg: Message = { id: `m_${Date.now()}u`, role: "user", content: trimmed, created_at: now() };
      const asstMsg: Message = {
        id: `m_${Date.now()}a`,
        role: "assistant",
        content: "",
        created_at: now(),
        streaming: true,
      };
      setMessages((prev) => [...prev, userMsg, asstMsg]);
      await runStream(trimmed, asstMsg.id);
    },
    [streaming, ensureConversation, runStream],
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
      if (idx < 1) return;
      const prompt = [...cur.slice(0, idx)].reverse().find((m) => m.role === "user");
      if (!prompt) return;
      const fresh: Message = {
        id: `m_${Date.now()}a`,
        role: "assistant",
        content: "",
        created_at: now(),
        streaming: true,
      };
      setMessages([...cur.slice(0, idx), fresh]);
      await runStream(prompt.content, fresh.id);
    },
    [streaming, runStream],
  );

  const editUserMessage = useCallback(
    async (id: string, content: string) => {
      if (streaming) return;
      const cur = messagesRef.current;
      const idx = cur.findIndex((m) => m.id === id);
      if (idx < 0) return;
      const edited: Message = { ...cur[idx], content: content.trim(), created_at: now() };
      const asst: Message = {
        id: `m_${Date.now()}a`,
        role: "assistant",
        content: "",
        created_at: now(),
        streaming: true,
      };
      setMessages([...cur.slice(0, idx), edited, asst]);
      await runStream(edited.content, asst.id);
    },
    [streaming, runStream],
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
      refreshList();
    },
    [refreshList],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      await api.deleteConversation(id);
      if (currentIdRef.current === id) newConversation();
      refreshList();
    },
    [refreshList, newConversation],
  );

  const branch = useCallback(async (messageId: string, kind: BranchKind) => {
    const { run_id } = await api.branch(messageId, kind);
    return run_id;
  }, []);

  const value = useMemo<AppStore>(
    () => ({
      mockNotice: MOCK_NOTICE,
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
