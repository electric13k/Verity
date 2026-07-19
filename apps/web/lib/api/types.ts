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
