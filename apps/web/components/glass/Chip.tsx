import { clsx } from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

// Chip — small stateful pill (a toggle, a filter, a selection). Renders as a
// button when interactive. `on` marks the engaged state.
interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  on?: boolean;
  dot?: string; // css color for a leading status dot
  children?: ReactNode;
}

export function Chip({ on, dot, className, children, ...rest }: ChipProps) {
  return (
    <button type="button" className={clsx("gchip", on && "gchip--on", className)} {...rest}>
      {dot && <span className="gchip__dot" style={{ background: dot }} />}
      {children}
    </button>
  );
}

// Badge — static label, non-interactive. Same pill, no hover.
interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  dot?: string;
  children?: ReactNode;
}

export function Badge({ dot, className, children, ...rest }: BadgeProps) {
  return (
    <span className={clsx("gchip", className)} {...rest}>
      {dot && <span className="gchip__dot" style={{ background: dot }} />}
      {children}
    </span>
  );
}
