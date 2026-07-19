import { TranscriptView } from "@/components/transcript/TranscriptView";
import { mock } from "@/lib/api/mock";

// Public share route, outside the (app) group so it never loads the workspace.
// Static export pre-renders the known share ids; the transcript body is fetched
// client-side (mock today, GET /v1/transcripts/:share_id when it lands).
export function generateStaticParams() {
  return mock.transcriptShareIds().map((shareId) => ({ shareId }));
}

export const dynamicParams = false;

export default async function TranscriptPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  return <TranscriptView shareId={shareId} />;
}
