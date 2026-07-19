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
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export interface ChatStreamHandlers {
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

export interface OfficeRunPhase {
  role: string;
  phase: FlowPhase;
  content: string;
  at: string;
}

export interface OfficeRun {
  id: string;
  office_id: string;
  office_name: string;
  status: OfficeStatus;
  started_at: string;
  phases: OfficeRunPhase[]; // the STATE.md checkpoint timeline
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
