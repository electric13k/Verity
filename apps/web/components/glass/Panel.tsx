import { clsx } from "clsx";
import type { ElementType, ComponentPropsWithoutRef, ReactNode } from "react";

// The single glass surface. Every raised plane in the app is a Panel — the
// refraction material (fill, blur, tinted edge, prism fringe) lives once in
// globals.css `.glass`; nothing restyles it ad hoc.
//
//   raised  — denser fill for content that sits above other glass
//   active  — brass hairline: the plane is the current working surface
//   glow    — hierarchy signal ONLY, at most one per view (design rule 4)

type PanelProps<T extends ElementType> = {
  as?: T;
  raised?: boolean;
  active?: boolean;
  glow?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

export function Panel<T extends ElementType = "div">({
  as,
  raised,
  active,
  glow,
  className,
  children,
  ...rest
}: PanelProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag
      className={clsx(
        "glass",
        raised && "glass-raised",
        active && "glass-active",
        glow && "glow-focus",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
