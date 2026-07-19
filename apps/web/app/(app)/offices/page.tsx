import { Buildings } from "@phosphor-icons/react/dist/ssr";
import { Placeholder } from "@/components/shell/Placeholder";

export default function OfficesPage() {
  return (
    <Placeholder
      Icon={Buildings}
      eyebrow="Offices"
      title="Standing work that runs on a schedule."
      lede="An Office is a Flow with a clock and a memory: it wakes on its schedule, checkpoints its STATE between runs, and works within the caps you set. Branch any conversation into one."
      points={[
        "Scheduled runs with STATE checkpointing",
        "Per-user autonomy caps and an autonomy preamble",
        "Run history with a checkpoint view",
      ]}
    />
  );
}
