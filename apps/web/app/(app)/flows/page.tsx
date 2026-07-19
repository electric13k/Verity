import { FlowArrow } from "@phosphor-icons/react/dist/ssr";
import { Placeholder } from "@/components/shell/Placeholder";

export default function FlowsPage() {
  return (
    <Placeholder
      Icon={FlowArrow}
      eyebrow="Flows"
      title="A team of roles, working one task."
      lede="A conductor plans, workers execute in parallel, an inspector checks the result — converging or diverging as the task demands. Any chat message already branches into one."
      points={[
        "Conductor / worker / inspector roles over the live gateway",
        "Auto or manual flow selection",
        "Streamed, role-tagged output with the same confidence read as chat",
      ]}
    />
  );
}
