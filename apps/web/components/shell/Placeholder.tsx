import type { Icon } from "@phosphor-icons/react";
import { Panel } from "@/components/glass/Panel";

// Wave-1 stand-in for the surfaces that land in wave 2 (Flows, Offices,
// Compute). Not a dead end — it states plainly what the surface will do and
// what already works, in the app's own editorial register.

interface PlaceholderProps {
  eyebrow: string;
  title: string;
  lede: string;
  Icon: Icon;
  points: string[];
}

export function Placeholder({ eyebrow, title, lede, Icon, points }: PlaceholderProps) {
  return (
    <div className="placeholder">
      <div className="placeholder__inner v-rise">
        <Panel raised className="placeholder__mark">
          <Icon size={26} weight="regular" />
        </Panel>
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="font-display placeholder__title">{title}</h1>
        <p className="placeholder__lede">{lede}</p>
        <ul className="placeholder__list">
          {points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <span className="gchip" style={{ marginTop: "var(--v-space-4)" }}>
          <span className="gchip__dot" style={{ background: "var(--v-chai)" }} />
          Arrives in wave 2
        </span>
      </div>
    </div>
  );
}
