// POST /v1/compute/jobs — live. Submits an inference job to the compute
// network; the coordinator owns redundancy-2 assignment and consensus. The
// gateway returns 202 with {job_id, work_unit_id}. Network stats (credits,
// nodes) are mock until the ledger is exposed.

import { apiUrl } from "./config";
import type { ComputeJobRequest, ComputeJobResult } from "./types";

export async function submitComputeJob(
  req: ComputeJobRequest,
  signal?: AbortSignal,
): Promise<ComputeJobResult> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/v1/compute/jobs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: req.model, prompt: req.prompt }),
      signal,
    });
  } catch {
    throw new Error("Can't reach the Verity gateway. Is it running?");
  }

  if (!res.ok) {
    let msg = `Gateway returned ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      if (body.error) msg = body.error;
    } catch {
      /* keep status */
    }
    throw new Error(msg);
  }

  const body = (await res.json()) as Partial<ComputeJobResult>;
  return {
    job_id: String(body.job_id ?? ""),
    work_unit_id: String(body.work_unit_id ?? ""),
  };
}
