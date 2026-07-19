// ┌──────────────────────────────────────────────────────────────────────┐
// │  MOCK ADAPTER — in-memory, session-only.                               │
// │                                                                        │
// │  Serves the routes docs/API_SURFACE.md marks "planned" (conversation   │
// │  persistence, /v1/me, branching) so the UI is complete now and flips   │
// │  to live when the gateway lands them. Nothing here is persisted; a      │
// │  reload reseeds. Live routes (chat, flows) never come through here.     │
// └──────────────────────────────────────────────────────────────────────┘

import type {
  BranchKind,
  BranchResult,
  Conversation,
  ConversationDetail,
  Me,
  Message,
  ModelOption,
} from "./types";

export const MOCK_NOTICE =
  "Conversation history, provider list, and branching are served by an in-memory mock (API_SURFACE: planned). Chat streaming is live.";

// Model catalog — labels for the picker. /me decides which are usable.
export const MODEL_CATALOG: ModelOption[] = [
  { selector: "echo:echo", provider: "verity", label: "Echo · dev stream" },
  { selector: "verity:qwythos", provider: "verity", label: "Verity 9B · house" },
  { selector: "anthropic:claude-sonnet-5", provider: "anthropic", label: "Claude Sonnet 5" },
  { selector: "anthropic:claude-opus-5", provider: "anthropic", label: "Claude Opus 5" },
  { selector: "openai:gpt-5", provider: "openai", label: "GPT-5" },
  { selector: "ollama:llama3.3", provider: "ollama", label: "Llama 3.3 · local" },
];

let idc = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}${(idc++).toString(36)}`;

interface Store {
  conversations: Map<string, ConversationDetail>;
  order: string[]; // most-recent first
}

function seed(): Store {
  const now = Date.now();
  const conv = (
    id: string,
    title: string,
    ageMin: number,
    msgs: Array<[Message["role"], string, number?]>,
  ): ConversationDetail => ({
    id,
    title,
    updated_at: new Date(now - ageMin * 60_000).toISOString(),
    messages: msgs.map(([role, content, score], i) => ({
      id: `${id}_m${i}`,
      role,
      content,
      created_at: new Date(now - ageMin * 60_000 - (msgs.length - i) * 20_000).toISOString(),
      ...(score != null
        ? { confidence: { score, band: score >= 78 ? "assured" : score >= 55 ? "measured" : "tentative" } }
        : {}),
    })),
  });

  const conversations = new Map<string, ConversationDetail>();
  const c1 = conv("seed_welcome", "Welcome to Verity", 4, [
    ["user", "What makes Verity different from a normal chat app?", undefined],
    [
      "assistant",
      "Verity treats a conversation as one move in a larger workspace. Any message can **branch into a Flow** (a team of roles working a task) or an **Office** (a scheduled, checkpointed run). Every answer carries a **confidence** read, and memory is yours to toggle per exchange.",
      82,
    ],
  ]);
  const c2 = conv("seed_flow", "Draft launch checklist", 52, [
    ["user", "Give me a launch checklist for a small hardware product.", undefined],
    [
      "assistant",
      "Here is a lean pass:\n\n1. **Certification** — the long pole; start early.\n2. **Firmware freeze** — tag the release, no silent patches.\n3. **Support runbook** — one page, plain verbs.\n\nBranch this into a Flow and I'll expand each into owned steps.",
      67,
    ],
  ]);
  conversations.set(c1.id, c1);
  conversations.set(c2.id, c2);
  return { conversations, order: [c1.id, c2.id] };
}

const store: Store = seed();

const stripped = (c: ConversationDetail): Conversation => ({
  id: c.id,
  title: c.title,
  updated_at: c.updated_at,
});

// Simulate a little latency so loading states are real, not instant.
const tick = <T,>(v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), 60));

export const mock = {
  notice: MOCK_NOTICE,

  me(): Promise<Me> {
    // Dev posture: echo + house available; keyed providers show unconfigured
    // until the vault lands (they surface a real error if selected — good UX).
    return tick({
      user_id: "dev_user",
      providers: [
        { id: "verity", configured: true, house: true },
        { id: "anthropic", configured: false, house: false },
        { id: "openai", configured: false, house: false },
        { id: "ollama", configured: false, house: false },
      ],
    });
  },

  listConversations(): Promise<Conversation[]> {
    return tick(store.order.map((id) => stripped(store.conversations.get(id)!)));
  },

  getConversation(id: string): Promise<ConversationDetail | null> {
    return tick(store.conversations.get(id) ?? null);
  },

  createConversation(title = "New conversation"): Promise<ConversationDetail> {
    const id = uid("conv");
    const c: ConversationDetail = {
      id,
      title,
      updated_at: new Date().toISOString(),
      messages: [],
    };
    store.conversations.set(id, c);
    store.order.unshift(id);
    return tick(c);
  },

  renameConversation(id: string, title: string): Promise<void> {
    const c = store.conversations.get(id);
    if (c) {
      c.title = title;
      c.updated_at = new Date().toISOString();
    }
    return tick(undefined);
  },

  deleteConversation(id: string): Promise<void> {
    store.conversations.delete(id);
    store.order = store.order.filter((x) => x !== id);
    return tick(undefined);
  },

  // Persist the working set of messages for a conversation and bump ordering.
  saveMessages(id: string, messages: Message[], title?: string): Promise<void> {
    const c = store.conversations.get(id);
    if (c) {
      c.messages = messages;
      if (title) c.title = title;
      c.updated_at = new Date().toISOString();
      store.order = [id, ...store.order.filter((x) => x !== id)];
    }
    return tick(undefined);
  },

  branch(messageId: string, kind: BranchKind): Promise<BranchResult> {
    return tick({ run_id: uid("run"), kind });
  },

  newId: uid,
};
