import { clsx } from "clsx";

// The loading placeholder for lazily-loaded surfaces. A quiet glass-tinted block
// with a slow sheen (stilled under reduced motion) — the calm stand-in while a
// deferred chunk arrives, never a spinner. Give it width/height via style or the
// `lines` shorthand for a stack of text bars.

export function Skeleton({
  className,
  style,
  lines,
  "aria-label": ariaLabel = "Loading",
}: {
  className?: string;
  style?: React.CSSProperties;
  lines?: number;
  "aria-label"?: string;
}) {
  if (lines && lines > 0) {
    return (
      <div className={clsx("v-skeleton-stack", className)} role="status" aria-label={ariaLabel} style={style}>
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className="v-skeleton"
            style={{ height: "0.8rem", width: i === lines - 1 ? "62%" : "100%" }}
          />
        ))}
      </div>
    );
  }
  return <span className={clsx("v-skeleton", className)} role="status" aria-label={ariaLabel} style={style} />;
}
