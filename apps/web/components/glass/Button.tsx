import { clsx } from "clsx";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "quiet" | "destructive";
type Size = "md" | "sm";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** icon-only square button */
  icon?: boolean;
  children?: ReactNode;
}

// The three action registers, one glass material (styles in globals.css).
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "quiet", size = "md", icon = false, className, type = "button", children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        "gbtn",
        `gbtn--${variant}`,
        size === "sm" && "gbtn--sm",
        icon && "gbtn--icon",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
