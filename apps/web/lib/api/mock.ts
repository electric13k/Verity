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
  ComputeStats,
  Conversation,
  ConversationDetail,
  Me,
  Message,
  ModelOption,
  Office,
  OfficeInput,
  OfficeRun,
  ProviderKeyInfo,
  Transcript,
  UploadResult,
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

// ── Offices ───────────────────────────────────────────────────────────────
// Scheduled flows with a STATE.md checkpoint timeline. Runs are synthesized
// (the office runner is brain-side) so the run-detail view has real phase
// content to render until POST /v1/offices/:id/run lands live.

const offices = new Map<string, Office>();
const officeRuns = new Map<string, OfficeRun>();

function seedOffices() {
  const now = Date.now();
  const seedOne = (
    id: string,
    name: string,
    schedule: string,
    brief: string,
    status: Office["status"],
    ageMin: number,
  ): Office => ({
    id,
    name,
    schedule,
    brief,
    flow_kind: "",
    workers: 2,
    status,
    updated_at: new Date(now - ageMin * 60_000).toISOString(),
  });
  const o1 = seedOne(
    "office_briefing",
    "Morning market briefing",
    "0 7 * * 1-5",
    "Scan overnight movements in the semiconductor sector and write a one-page briefing: what moved, the likely cause, and what to watch today.",
    "scheduled",
    38,
  );
  const o2 = seedOne(
    "office_digest",
    "Weekly research digest",
    "0 9 * * 1",
    "Summarize the week's saved papers into a digest grouped by theme, with a two-line takeaway per paper and open questions.",
    "done",
    2 * 24 * 60,
  );
  // Give the "done" office a checkpoint history to open into.
  const run = synthRun(o2, "run_digest_seed", now - 2 * 24 * 60 * 60_000);
  o2.last_run_id = run.id;
  officeRuns.set(run.id, run);
  offices.set(o1.id, o1);
  offices.set(o2.id, o2);
}

// Build a STATE.md checkpoint document for a completed run — same shape the
// brain's OfficeRunner writes (services/brain/app/offices/runner.py) so the run
// view renders identically to a live run.
function synthStateMd(name: string, task: string, startMs: number): string {
  return [
    `# ${name} — STATE`,
    "",
    "status: done",
    `updated: ${new Date(startMs + 54_000).toISOString()}`,
    "",
    "## Autonomy",
    "This task runs unattended. Make reasonable decisions without asking; record every decision and its rationale in your output. Stop only for destructive or irreversible actions.",
    "",
    "## Task",
    task,
    "",
    "## Phases",
    "### plan (conductor)",
    "1. Gather the source set for this run.\n2. Extract the key movements and their drivers.\n3. Draft to the standing format.",
    "",
    "### work (worker-1)",
    "Source set assembled: 6 items in scope, 2 de-duplicated. Coverage looks complete against the brief.",
    "",
    "### work (worker-2)",
    "Drivers identified. Two items dominate the movement; the rest are follow-on effects. Confidence noted inline.",
    "",
    "### verify (inspector)",
    "APPROVED — consistent with the sources and the standing format. One figure was rounded; flagged in the notes.",
    "",
    "### converge (flow)",
    "Briefing composed to the one-page format. Decisions and their rationale recorded for the audit trail; nothing required a stop for irreversible action.",
    "",
  ].join("\n");
}

function synthRun(office: Office, id: string, startMs: number): OfficeRun {
  return {
    id,
    office_id: office.id,
    office_name: office.name,
    status: "done",
    started_at: new Date(startMs).toISOString(),
    finished_at: new Date(startMs + 54_000).toISOString(),
    state_md: synthStateMd(office.name, office.brief, startMs),
  };
}

seedOffices();

// ── Provider keys ──────────────────────────────────────────────────────────
// Vault-backed at the gateway (AES-256-GCM). The mock never stores or returns
// key material — only the configured flag flips. House providers ("provided
// by Verity") carry no user key row.

const PROVIDER_LABELS: Record<string, string> = {
  verity: "Verity (house)",
  anthropic: "Anthropic",
  openai: "OpenAI",
  ollama: "Ollama",
};
const keyConfigured = new Set<string>(); // providers the user has entered a key for

// ── Transcripts ────────────────────────────────────────────────────────────
// Public, read-only shares (tokenized id). Seeded from conversations so /t/…
// renders real content until GET /v1/transcripts/:share_id lands.

function seedTranscript(convId: string, shareId: string): Transcript | null {
  const c = store.conversations.get(convId);
  if (!c) return null;
  return {
    share_id: shareId,
    title: c.title,
    created_at: c.updated_at,
    messages: c.messages,
  };
}

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

  // ── Offices ──────────────────────────────────────────────────────────────
  listOffices(): Promise<Office[]> {
    return tick(
      [...offices.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    );
  },

  createOffice(input: OfficeInput): Promise<Office> {
    const id = uid("office");
    const o: Office = {
      id,
      name: input.name.trim() || "Untitled office",
      schedule: input.schedule.trim(),
      brief: input.brief.trim(),
      flow_kind: input.flow_kind,
      workers: Math.max(1, Math.min(4, input.workers || 2)),
      status: input.schedule.trim() ? "scheduled" : "idle",
      updated_at: new Date().toISOString(),
    };
    offices.set(id, o);
    return tick(o);
  },

  deleteOffice(id: string): Promise<void> {
    offices.delete(id);
    return tick(undefined);
  },

  // Run now — synthesizes a checkpointed run so the timeline view has content.
  runOffice(id: string): Promise<{ run_id: string }> {
    const office = offices.get(id);
    if (!office) return tick({ run_id: "" });
    const run = synthRun({ ...office }, uid("run"), Date.now());
    run.office_id = id;
    officeRuns.set(run.id, run);
    office.last_run_id = run.id;
    office.status = "done";
    office.updated_at = new Date().toISOString();
    return tick({ run_id: run.id });
  },

  getOfficeRun(_officeId: string, runId: string): Promise<OfficeRun | null> {
    return tick(officeRuns.get(runId) ?? null);
  },

  // ── Provider keys ────────────────────────────────────────────────────────
  getProviderKeys(): Promise<ProviderKeyInfo[]> {
    const order = ["verity", "anthropic", "openai", "ollama"];
    return tick(
      order.map((id) => ({
        id,
        label: PROVIDER_LABELS[id] ?? id,
        configured: id === "verity" ? true : keyConfigured.has(id),
        house: id === "verity",
      })),
    );
  },

  putProviderKey(provider: string, key: string): Promise<void> {
    // The mock never stores the material — only the fact that a key exists.
    if (key.trim()) keyConfigured.add(provider);
    return tick(undefined);
  },

  deleteProviderKey(provider: string): Promise<void> {
    keyConfigured.delete(provider);
    return tick(undefined);
  },

  // ── Upload ───────────────────────────────────────────────────────────────
  // Multipart → markitdown → markdown bytes. The mock derives a plausible
  // parsed size from the file so the chip lifecycle reads true.
  upload(file: File): Promise<UploadResult> {
    const bytes = Math.max(48, Math.round(file.size * 0.42));
    return new Promise((r) =>
      setTimeout(
        () => r({ file_id: uid("file"), name: file.name, markdown_bytes: bytes }),
        520,
      ),
    );
  },

  // ── Transcripts ──────────────────────────────────────────────────────────
  getTranscript(shareId: string): Promise<Transcript | null> {
    // Seed shares map onto seeded conversations; anything else is unknown.
    const map: Record<string, string> = {
      welcome: "seed_welcome",
      checklist: "seed_flow",
    };
    return tick(map[shareId] ? seedTranscript(map[shareId], shareId) : null);
  },

  // Share ids the static export should pre-render.
  transcriptShareIds(): string[] {
    return ["welcome", "checklist"];
  },

  // ── Compute network stats (mock until the ledger is exposed) ─────────────
  computeStats(): Promise<ComputeStats> {
    return tick({ credits: 1240, nodes_online: 6, redundancy: 2, jobs_verified: 318 });
  },

  newId: uid,
};
