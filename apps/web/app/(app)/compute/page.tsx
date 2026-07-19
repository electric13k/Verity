import { Cpu } from "@phosphor-icons/react/dist/ssr";
import { Placeholder } from "@/components/shell/Placeholder";

export default function ComputePage() {
  return (
    <Placeholder
      Icon={Cpu}
      eyebrow="Compute"
      title="A network that verifies its own work."
      lede="Scattered compute for house model calls: jobs fan out to independent nodes, results are agreed by redundancy-2 consensus before they count, and a credits ledger keeps it honest."
      points={[
        "Node registry, work units, and a credits ledger",
        "Redundancy-2 consensus on every result",
        "Internal routing for house scalar calls",
      ]}
    />
  );
}
