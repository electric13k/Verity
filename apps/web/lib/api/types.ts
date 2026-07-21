// Typed contract for the Verity gateway (docs/API_SURFACE.md).
//
// Routes marked "planned" there are served here by an in-memory mock adapter
// (lib/api/mock.ts) and flip to live by pointing the client at the gateway.
// Live today: POST /v1/chat, POST /v1/flows, GET /healthz.

export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  content: string;
  created_at: string;
  confidence?: Confidence;
  /** local-only: assistant message is mid-stream */
  streaming?: boolean;
  /** local-only: an error surfaced while producing this message */
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
  /** tokenized public share id (GET /v1/conversations/:id returns it) */
  share_id?: string;
}

// GET /v1/conversations is cursor-paginated: a page of items plus the cursor for
// the next page (null when the list is exhausted). See docs/API_SURFACE.md.
export interface ConversationPage {
  items: Conversation[];
  next_cursor: string | null;
}

// Gateway emits confidence as { score, rationale }. The band is derived
// client-side (the doc's {score, band} shape) so the chip stays declarative.
export type ConfidenceBand = "assured" | "measured" | "tentative";

export interface Confidence {
  score: number; // 0..100
  band: ConfidenceBand;
  rationale?: string;
}

export function bandForScore(score: number): ConfidenceBand {
  if (score >= 78) return "assured";
  if (score >= 55) return "measured";
  return "tentative";
}

// ---- providers / models (GET /v1/me shape) --------------------------------

export interface MeProvider {
  id: string;
  configured: boolean;
  house: boolean;
}

export interface Me {
  user_id: string;
  providers: MeProvider[];
}

// The gateway takes a single `model` selector "provider:model". The catalog
// gives the picker human labels; /me tells it which providers are live.
export interface ModelOption {
  selector: string; // e.g. "anthropic:claude-sonnet-5" | "echo:echo"
  provider: string; // "anthropic"
  label: string; // "Claude Sonnet 5"
}

// ---- chat streaming --------------------------------------------------------

export interface ChatRequest {
  conversation_id?: string;
  message: string;
  model?: string;
  use_memory?: boolean;
  files?: string[]; // uploaded file ids to fold into context
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

// The chat SSE stream opens with a `meta` frame carrying the conversation id
// (a new conversation surfaces its real id + auto-name here), the assistant
// message id, and — for a freshly-named conversation — its title.
export interface ChatMeta {
  conversation_id: string;
  message_id: string;
  title?: string;
}

export interface ChatStreamHandlers {
  onMeta?: (meta: ChatMeta) => void;
  onDelta?: (text: string) => void;
  onUsage?: (usage: Usage) => void;
  onConfidence?: (c: { score: number; rationale?: string }) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

// ---- branching -------------------------------------------------------------

export type BranchKind = "flow" | "office";
export interface BranchResult {
  run_id: string;
  kind: BranchKind;
}

// ---- flows (POST /v1/flows — live SSE) -------------------------------------

// The brain runs one of two topologies. "converge" splits the task into
// independent subtasks; "diverge_converge" runs the same task from different
// angles then merges (CAAI). Empty = the engine auto-picks from the task.
export type FlowKind = "converge" | "diverge_converge";

// Phases arrive in order: plan (conductor) → work (workers, parallel) →
// verify (inspector) → converge (final synthesis) → done. `error` can arrive
// on any lane.
export type FlowPhase = "plan" | "work" | "verify" | "converge" | "done" | "error";

export interface FlowRequest {
  task: string;
  flow_kind?: FlowKind; // omit → auto-pick
  model?: string;
  workers?: number; // 1..4
}

// role: "conductor" | "worker-1"… | "inspector" | "flow". content is
// BOP-sanitized by the brain before it ever reaches us.
export interface FlowEvent {
  role: string;
  phase: FlowPhase;
  content: string;
}

export interface FlowStreamHandlers {
  onEvent?: (e: FlowEvent) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

// ---- compute (POST /v1/compute/jobs — live) --------------------------------

export interface ComputeJobRequest {
  model: string;
  prompt: string;
}
export interface ComputeJobResult {
  job_id: string;
  work_unit_id: string;
}

// Network stats surfaced by the compute view (mock until the ledger lands).
export interface ComputeStats {
  credits: number;
  nodes_online: number;
  redundancy: number; // consensus copies per work unit
  jobs_verified: number;
}

// ---- offices (mock-backed CRUD, API_SURFACE: planned) ----------------------

export type OfficeStatus = "idle" | "scheduled" | "running" | "done" | "failed";

export interface Office {
  id: string;
  name: string;
  schedule: string; // cron expression; "" = manual only
  brief: string; // the standing task
  flow_kind: "" | FlowKind; // "" = auto
  workers: number; // 1..4
  status: OfficeStatus;
  updated_at: string;
  last_run_id?: string;
}

// A run's detail (GET /v1/offices/:id/runs/:run_id). The backend checkpoints
// each phase into a STATE.md document and returns it verbatim as `state_md`;
// the run view renders that markdown as the checkpoint timeline. `office_name`
// is not on the wire — the caller fills it from the office it opened.
export interface OfficeRun {
  id: string;
  office_id: string;
  office_name: string;
  status: OfficeStatus; // running | done | failed
  started_at: string;
  finished_at?: string;
  state_md: string; // the STATE.md checkpoint document
}

export interface OfficeInput {
  name: string;
  schedule: string;
  brief: string;
  flow_kind: "" | FlowKind;
  workers: number;
}

// ---- provider keys (GET/PUT/DELETE /v1/provider-keys) ----------------------

export interface ProviderKeyInfo {
  id: string;
  label: string;
  configured: boolean;
  house: boolean; // "provided by Verity" — no user key row
}

// ---- upload (POST /v1/upload → markitdown) ---------------------------------

export interface UploadResult {
  file_id: string;
  name: string;
  markdown_bytes: number;
}

// A local file attachment as it moves through the upload lifecycle.
export interface Attachment {
  local_id: string;
  name: string;
  size: number;
  status: "uploading" | "parsed" | "error";
  markdown_bytes?: number;
  file_id?: string;
  error?: string;
}

// ---- transcripts (GET /v1/transcripts/:share_id — public, read-only) -------

export interface Transcript {
  share_id: string;
  title: string;
  created_at: string;
  messages: Message[];
}

// ---- platform adapter surface (planned routes) ----------------------------
//
// The one seam between live and mock. Both lib/api/live.ts (gateway) and
// lib/api/mock.ts (dev fallback) implement this; client.ts picks one ONCE so
// no caller ever branches on live-vs-mock. Streaming routes (chat, flows,
// compute, regenerate, edit) are always live and live outside this surface.
export interface PlatformApi {
  me(): Promise<Me>;
  listConversations(cursor?: string): Promise<ConversationPage>;
  getConversation(id: string): Promise<ConversationDetail | null>;
  createConversation(title?: string): Promise<ConversationDetail>;
  renameConversation(id: string, title: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  branch(messageId: string, kind: BranchKind): Promise<BranchResult>;
  listOffices(): Promise<Office[]>;
  createOffice(input: OfficeInput): Promise<Office>;
  deleteOffice(id: string): Promise<void>;
  runOffice(id: string): Promise<{ run_id: string }>;
  getOfficeRun(officeId: string, runId: string): Promise<OfficeRun | null>;
  getProviderKeys(): Promise<ProviderKeyInfo[]>;
  putProviderKey(provider: string, key: string): Promise<void>;
  deleteProviderKey(provider: string): Promise<void>;
  upload(file: File): Promise<UploadResult>;
  getTranscript(shareId: string): Promise<Transcript | null>;
  transcriptShareIds(): string[];
  computeStats(): Promise<ComputeStats>;
}
