// Typed gateway client. Chat + flows are live SSE against the Go gateway;
// everything the API surface marks "planned" is delegated to the mock adapter
// behind the same typed surface, so callers never branch on live-vs-mock.

import { apiUrl } from "./config";
import { readSSE } from "./sse";
import { mock } from "./mock";
import type { ChatRequest, ChatStreamHandlers } from "./types";

export class GatewayError extends Error {}

/**
 * POST /v1/chat — live SSE. Returns once the stream ends (done/error) or the
 * signal aborts. Stop = abort the signal; the gateway cancels upstream.
 */
export async function chatStream(
  req: ChatRequest,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/v1/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Only fields the gateway accepts (strict decode rejects unknowns).
        ...(req.conversation_id ? { conversation_id: req.conversation_id } : {}),
        message: req.message,
        ...(req.model ? { model: req.model } : {}),
        use_memory: !!req.use_memory,
      }),
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
      const body = (await res.json()) as { error?: string; detail?: string };
      if (body.error) msg = body.error;
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

// Planned routes — typed passthrough to the mock adapter (flip to live later).
export const api = {
  me: mock.me,
  listConversations: mock.listConversations,
  getConversation: mock.getConversation,
  createConversation: mock.createConversation,
  renameConversation: mock.renameConversation,
  deleteConversation: mock.deleteConversation,
  saveMessages: mock.saveMessages,
  branch: mock.branch,
};
