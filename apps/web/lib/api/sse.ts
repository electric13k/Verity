// Minimal SSE reader for POST streams (EventSource is GET-only). Parses the
// gateway's `event: <name>\ndata: <json>\n\n` frames. Stop = abort the fetch;
// the gateway cancels the upstream gRPC stream when the connection drops.

export interface SSEFrame {
  event: string;
  data: unknown;
}

export async function readSSE(
  response: Response,
  onFrame: (frame: SSEFrame) => void,
): Promise<void> {
  if (!response.body) throw new Error("no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (raw: string) => {
    const lines = raw.split("\n");
    let event = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;
    const dataStr = dataLines.join("\n");
    let data: unknown = dataStr;
    try {
      data = JSON.parse(dataStr);
    } catch {
      /* leave as string */
    }
    onFrame({ event, data });
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    // Frames are separated by a blank line.
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (raw.trim()) flush(raw);
    }
  }
  if (buffer.trim()) flush(buffer);
}
