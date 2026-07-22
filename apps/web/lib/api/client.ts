// Typed gateway client. Chat / regenerate / edit / flows / compute are live SSE
// (or request/response) against the Go gateway. The routes docs/API_SURFACE.md
// marks "planned" are served through the PlatformApi seam (`api`), which points
// at the live gateway adapter by default and the in-memory mock only when
// NEXT_PUBLIC_VERITY_MOCK=1 — chosen ONCE here so callers never branch.

import { apiUrl, authHeaders, IS_MOCK } from "./config";
import { readSSE } from "./sse";
import { mock } from "./mock";
import { live } from "./live";
import type { ChatRequest, ChatStreamHandlers, PlatformApi } from "./types";

export class GatewayError extends Error {}

// --- shared SSE tail for chat / regenerate / edit --------------------------
// All three brain streams share one frame vocabulary: a leading `meta`
// {conversation_id, message_id, title?}, then delta / usage / confidence, then
// `done` (or `error`). One reader consumes them all.
async function runChatStream(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return;
    handlers.onError?.("Can't reach the Verity gateway. Is it running?");
    handlers.onDone?.();
    return;
  }

  if (!res.ok) {
    let msg = `Gateway returned ${res.status}`;
    try {
      const errBody = (await res.json()) as { error?: string; detail?: string };
      if (errBody.error) msg = errBody.error;
    } catch {
      /* keep status message */
    }
    handlers.onError?.(msg);
    handlers.onDone?.();
    return;
  }

  try {
    await readSSE(res, ({ event, data }) => {
      const d = (data ?? {}) as Record<string, unknown>;
      switch (event) {
        case "meta":
          handlers.onMeta?.({
            conversation_id: typeof d.conversation_id === "string" ? d.conversation_id : "",
            message_id: typeof d.message_id === "string" ? d.message_id : "",
            title: typeof d.title === "string" && d.title ? d.title : undefined,
          });
          break;
        case "delta":
          if (typeof d.text === "string") handlers.onDelta?.(d.text);
          break;
        case "usage":
          handlers.onUsage?.({
            input_tokens: Number(d.input_tokens ?? 0),
            output_tokens: Number(d.output_tokens ?? 0),
          });
          break;
        case "confidence":
          handlers.onConfidence?.({
            score: Number(d.score ?? 0),
            rationale: typeof d.rationale === "string" ? d.rationale : undefined,
          });
          break;
        case "error":
          handlers.onError?.(typeof d.error === "string" ? d.error : "stream error");
          break;
        case "done":
          handlers.onDone?.();
          break;
      }
    });
  } catch (e) {
    if ((e as Error)?.name !== "AbortError") {
      handlers.onError?.("Stream interrupted.");
      handlers.onDone?.();
    }
    return;
  }
  // Ensure onDone fires even if the server closed without a `done` frame.
  handlers.onDone?.();
}

/**
 * POST /v1/chat — live SSE. The first frame is `meta` (new conversations
 * surface their id + auto-name here); then deltas / usage / confidence; then
 * done. Stop = abort the signal; the gateway cancels upstream.
 */
export async function chatStream(
  req: ChatRequest,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  // Only fields the gateway accepts (strict decode rejects unknowns).
  const body: Record<string, unknown> = {
    ...(req.conversation_id ? { conversation_id: req.conversation_id } : {}),
    message: req.message,
    ...(req.model ? { model: req.model } : {}),
    use_memory: !!req.use_memory,
    ...(req.files && req.files.length ? { files: req.files } : {}),
  };
  return runChatStream("POST", "/v1/chat", body, handlers, signal);
}

/**
 * POST /v1/messages/:id/regenerate — live SSE. Drops the assistant turn (and
 * anything after) and streams a fresh one. Same events as chat.
 */
export async function regenerateStream(
  messageId: string,
  opts: { model?: string; memory?: boolean },
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const body: Record<string, unknown> = {
    ...(opts.model ? { model: opts.model } : {}),
    memory: !!opts.memory,
  };
  return runChatStream("POST", `/v1/messages/${encodeURIComponent(messageId)}/regenerate`, body, handlers, signal);
}

/**
 * PATCH /v1/messages/:id — live SSE. Edits a user message, truncates everything
 * below it, and restreams the assistant reply. Same events as chat.
 */
export async function editMessageStream(
  messageId: string,
  content: string,
  opts: { model?: string; memory?: boolean },
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const body: Record<string, unknown> = {
    content,
    ...(opts.model ? { model: opts.model } : {}),
    memory: !!opts.memory,
  };
  return runChatStream("PATCH", `/v1/messages/${encodeURIComponent(messageId)}`, body, handlers, signal);
}

// Planned routes — one adapter, chosen once. Live by default; mock is the
// explicit dev fallback (NEXT_PUBLIC_VERITY_MOCK=1). Callers never branch.
export const api: PlatformApi = IS_MOCK ? mock : live;

// Live routes exported at the top level (SSE / request-response, no adapter).
export { flowStream } from "./flows";
export { submitComputeJob } from "./compute";
