"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TranscriptView } from "@/components/transcript/TranscriptView";

// Public share route, outside the (app) group so it never loads the workspace.
// The share id rides in the query (`/t?s=<share_id>`) rather than the path, so a
// single static shell serves ANY tokenized id under `output: export` (a dynamic
// path segment can't be statically exported for ids unknown at build time). The
// transcript body is fetched client-side by id; an unknown id resolves to a
// graceful not-found inside TranscriptView.

function TranscriptFromQuery() {
  const params = useSearchParams();
  const shareId = params.get("s") ?? "";
  return <TranscriptView shareId={shareId} />;
}

export default function TranscriptPage() {
  return (
    <Suspense fallback={null}>
      <TranscriptFromQuery />
    </Suspense>
  );
}
