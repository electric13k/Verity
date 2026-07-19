// POST /v1/flows — live SSE against the Go gateway. The gateway forwards one
// `flow` frame per role/phase ({role, phase, content}, BOP-sanitized), then a
// `done` (or `error`). Stop = abort the signal; the gateway cancels upstream.
//
// The gateway strict-decodes the body, so we send only the four fields it
// accepts: task, flow_kind, model, workers.

import { apiUrl } from "./config";
import { readSSE } from "./sse";
import type { FlowPhase, FlowRequest, FlowStreamHandlers } from "./types";

const PHASES: ReadonlySet<string> = new Set([
  "plan", "work", "verify", "converge", "done", "error",
]);

export async function flowStream(
  req: FlowRequest,
  handlers: FlowStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/v1/flows"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: req.task,
        ...(req.flow_kind ? { flow_kind: req.flow_kind } : {}),
        ...(req.model ? { model: req.model } : {}),
        ...(req.workers ? { workers: req.workers } : {}),
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
      const body = (await res.json()) as { error?: string };
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
      if (event === "flow") {
        const phase = (typeof d.phase === "string" && PHASES.has(d.phase) ? d.phase : "work") as FlowPhase;
        handlers.onEvent?.({
          role: typeof d.role === "string" ? d.role : "flow",
          phase,
          content: typeof d.content === "string" ? d.content : "",
        });
      } else if (event === "error") {
        handlers.onError?.(typeof d.error === "string" ? d.error : "stream error");
      } else if (event === "done") {
        handlers.onDone?.();
      }
    });
  } catch (e) {
    if ((e as Error)?.name !== "AbortError") {
      handlers.onError?.("Stream interrupted.");
      handlers.onDone?.();
    }
    return;
  }
  handlers.onDone?.();
}
