// ┌──────────────────────────────────────────────────────────────────────┐
// │  LIVE ADAPTER — the planned platform routes, live against the gateway. │
// │                                                                        │
// │  Implements PlatformApi against services/gateway (platform.go). Shapes │
// │  follow the GATEWAY CODE, not the older docs/API_SURFACE.md, wherever  │
// │  the two drifted (confidence is {score, rationale}; conversation detail │
// │  carries share_id; office status is enabled/disabled; a run returns a   │
// │  STATE.md markdown document, not a phase array; provider-keys lists     │
// │  only keyed providers). client.ts chooses this OR the mock exactly once.│
// └──────────────────────────────────────────────────────────────────────┘

import { apiUrl } from "./config";
import {
  bandForScore,
  type BranchKind,
  type BranchResult,
  type ComputeStats,
  type Conversation,
  type ConversationDetail,
  type ConversationPage,
  type Me,
  type Message,
  type Office,
  type OfficeInput,
  type OfficeRun,
  type OfficeStatus,
  type PlatformApi,
  type ProviderKeyInfo,
  type Transcript,
  type UploadResult,
} from "./types";

// A gateway error surfaces the user-safe {error} message and its status. When
// DATABASE_URL is absent the brain maps persistence to UNAVAILABLE (503) — the
// GETs below swallow that into a safe default so a view never blank-screens.
class GatewayError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function gwError(res: Response): Promise<GatewayError> {
  let msg = `Gateway returned ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) msg = body.error;
  } catch {
    /* keep the status message */
  }
  return new GatewayError(msg, res.status);
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { headers: { Accept: "application/json" } });
  if (!res.ok) throw await gwError(res);
  return (await res.json()) as T;
}

async function sendJSON<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await gwError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// Resolve to a fallback on failure so loading states end and the view shows its
// empty affordance instead of hanging or crashing (degrade, never blank).
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

// --- shape mappers ---------------------------------------------------------

interface WireMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
  confidence?: number; // present only when the brain scored it (HasConfidence)
}

function toMessage(m: WireMessage): Message {
  const msg: Message = {
    id: String(m.id),
    role: m.role === "assistant" ? "assistant" : "user",
    content: typeof m.content === "string" ? m.content : "",
    created_at: String(m.created_at ?? ""),
  };
  // Gateway confidence is a bare score; the band is derived client-side.
  if (typeof m.confidence === "number" && m.confidence > 0) {
    msg.confidence = { score: m.confidence, band: bandForScore(m.confidence) };
  }
  return msg;
}

const PROVIDER_LABELS: Record<string, string> = {
  verity: "Verity (house)",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

// Office `status` on the wire is enabled|disabled (whether the schedule is
// armed), not a run state. Map it into the UI vocabulary the status chip knows.
function officeStatus(raw: string, schedule: string): OfficeStatus {
  if (raw === "disabled") return "idle";
  return schedule.trim() ? "scheduled" : "idle";
}

interface WireOffice {
  id: string;
  name: string;
  schedule: string;
  brief: string;
  status: string;
}

function toOffice(o: WireOffice): Office {
  const schedule = typeof o.schedule === "string" ? o.schedule : "";
  return {
    id: String(o.id),
    name: String(o.name ?? ""),
    schedule,
    brief: String(o.brief ?? ""),
    flow_kind: "",
    workers: 2,
    status: officeStatus(String(o.status ?? ""), schedule),
    updated_at: new Date().toISOString(),
  };
}

interface WireOfficeRun {
  run_id: string;
  office_id: string;
  status: string;
  state_md: string;
  started_at: string;
  finished_at: string;
}

function toOfficeRun(r: WireOfficeRun): OfficeRun {
  const status = (["running", "done", "failed"].includes(r.status) ? r.status : "running") as OfficeStatus;
  return {
    id: String(r.run_id ?? ""),
    office_id: String(r.office_id ?? ""),
    office_name: "",
    status,
    started_at: String(r.started_at ?? ""),
    finished_at: r.finished_at ? String(r.finished_at) : undefined,
    state_md: typeof r.state_md === "string" ? r.state_md : "",
  };
}

// --- the adapter -----------------------------------------------------------

export const live: PlatformApi = {
  async me(): Promise<Me> {
    return safe(
      getJSON<{ user_id: string; providers: { id: string; configured: boolean; house: boolean }[] }>(
        "/v1/me",
      ).then((r) => ({
        user_id: r.user_id ?? "",
        providers: (r.providers ?? []).map((p) => ({
          id: p.id,
          configured: !!p.configured,
          house: !!p.house,
        })),
      })),
      { user_id: "", providers: [] },
    );
  },

  async listConversations(cursor?: string): Promise<ConversationPage> {
    const path = cursor
      ? `/v1/conversations?cursor=${encodeURIComponent(cursor)}`
      : "/v1/conversations";
    return safe(
      getJSON<{
        items: { id: string; title: string; updated_at: string }[];
        next_cursor?: string | null;
      }>(path).then((r) => ({
        items: (r.items ?? []).map((it) => ({
          id: String(it.id),
          title: it.title || "New conversation",
          updated_at: String(it.updated_at ?? ""),
        })),
        next_cursor: r.next_cursor ?? null,
      })),
      { items: [], next_cursor: null },
    );
  },

  async getConversation(id: string): Promise<ConversationDetail | null> {
    try {
      const r = await getJSON<{
        id: string;
        title: string;
        share_id?: string;
        messages: WireMessage[];
      }>(`/v1/conversations/${encodeURIComponent(id)}`);
      return {
        id: String(r.id),
        title: r.title || "New conversation",
        updated_at: new Date().toISOString(),
        share_id: r.share_id,
        messages: (r.messages ?? []).map(toMessage),
      };
    } catch {
      return null;
    }
  },

  async createConversation(title?: string): Promise<ConversationDetail> {
    const r = await sendJSON<{ id: string }>("POST", "/v1/conversations", title ? { title } : {});
    return {
      id: String(r.id),
      title: title || "New conversation",
      updated_at: new Date().toISOString(),
      messages: [],
    };
  },

  async renameConversation(id: string, title: string): Promise<void> {
    await sendJSON<void>("PATCH", `/v1/conversations/${encodeURIComponent(id)}`, { title });
  },

  async deleteConversation(id: string): Promise<void> {
    await sendJSON<void>("DELETE", `/v1/conversations/${encodeURIComponent(id)}`);
  },

  async branch(messageId: string, kind: BranchKind): Promise<BranchResult> {
    const r = await sendJSON<{ run_id: string; kind: string }>("POST", "/v1/branches", {
      message_id: messageId,
      kind,
    });
    return { run_id: String(r.run_id ?? ""), kind };
  },

  async listOffices(): Promise<Office[]> {
    return safe(
      getJSON<{ items: WireOffice[] }>("/v1/offices").then((r) => (r.items ?? []).map(toOffice)),
      [],
    );
  },

  async createOffice(input: OfficeInput): Promise<Office> {
    const body: Record<string, unknown> = {
      name: input.name.trim(),
      brief: input.brief.trim(),
    };
    if (input.schedule.trim()) body.schedule = input.schedule.trim();
    if (input.flow_kind) body.flow_kind = input.flow_kind;
    if (input.workers) body.workers = input.workers;
    const o = await sendJSON<WireOffice>("POST", "/v1/offices", body);
    return { ...toOffice(o), flow_kind: input.flow_kind, workers: input.workers };
  },

  async deleteOffice(): Promise<void> {
    // No DELETE /v1/offices/:id route exists in the gateway (platform.go). The
    // offices view drops it from its local list optimistically; a reload
    // re-lists it. Documented as a gap, not wired here.
    return;
  },

  async runOffice(id: string): Promise<{ run_id: string }> {
    const r = await sendJSON<{ run_id: string }>("POST", `/v1/offices/${encodeURIComponent(id)}/run`);
    return { run_id: String(r.run_id ?? "") };
  },

  async getOfficeRun(officeId: string, runId: string): Promise<OfficeRun | null> {
    try {
      const r = await getJSON<WireOfficeRun>(
        `/v1/offices/${encodeURIComponent(officeId)}/runs/${encodeURIComponent(runId)}`,
      );
      return toOfficeRun(r);
    } catch {
      return null;
    }
  },

  async getProviderKeys(): Promise<ProviderKeyInfo[]> {
    // provider-keys lists ONLY keyed (bring-your-own) providers; the house
    // provider lives in /me. Merge so settings shows both, house first.
    const [keys, me] = await Promise.all([
      safe(getJSON<{ providers: { provider: string; configured: boolean }[] }>("/v1/provider-keys"), {
        providers: [],
      }),
      safe(getJSON<{ providers: { id: string; configured: boolean; house: boolean }[] }>("/v1/me"), {
        providers: [],
      }),
    ]);
    const list: ProviderKeyInfo[] = [];
    for (const p of me.providers ?? []) {
      if (p.house) {
        list.push({ id: p.id, label: PROVIDER_LABELS[p.id] ?? p.id, configured: !!p.configured, house: true });
      }
    }
    for (const p of keys.providers ?? []) {
      list.push({
        id: p.provider,
        label: PROVIDER_LABELS[p.provider] ?? p.provider,
        configured: !!p.configured,
        house: false,
      });
    }
    return list;
  },

  async putProviderKey(provider: string, key: string): Promise<void> {
    await sendJSON<void>("PUT", `/v1/provider-keys/${encodeURIComponent(provider)}`, { key });
  },

  async deleteProviderKey(provider: string): Promise<void> {
    await sendJSON<void>("DELETE", `/v1/provider-keys/${encodeURIComponent(provider)}`);
  },

  async upload(file: File): Promise<UploadResult> {
    const form = new FormData();
    form.append("file", file, file.name);
    const res = await fetch(apiUrl("/v1/upload"), { method: "POST", body: form });
    if (!res.ok) throw await gwError(res);
    const r = (await res.json()) as { file_id: string; name: string; markdown_bytes: number };
    return {
      file_id: String(r.file_id ?? ""),
      name: r.name ?? file.name,
      markdown_bytes: Number(r.markdown_bytes ?? 0),
    };
  },

  async getTranscript(shareId: string): Promise<Transcript | null> {
    try {
      const r = await getJSON<{ title: string; created_at: string; messages: WireMessage[] }>(
        `/v1/transcripts/${encodeURIComponent(shareId)}`,
      );
      return {
        share_id: shareId,
        title: r.title ?? "",
        created_at: String(r.created_at ?? ""),
        messages: (r.messages ?? []).map(toMessage),
      };
    } catch {
      return null;
    }
  },

  // No pre-known share ids in live: the transcript route client-fetches by id,
  // so the static export needs no build-time param list.
  transcriptShareIds(): string[] {
    return [];
  },

  // The compute ledger is not exposed yet (API_SURFACE), so network stats stay
  // static here too — job submission itself is live (lib/api/compute.ts).
  async computeStats(): Promise<ComputeStats> {
    return { credits: 1240, nodes_online: 6, redundancy: 2, jobs_verified: 318 };
  },
};
