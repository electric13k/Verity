// The app image convention.
//
// There are no raster images in the product today (only the PWA/app icons, which
// the browser loads from the manifest, never through the DOM). This component
// exists so the first one that lands is optimized by default:
//
//   • width + height are REQUIRED — reserving the box up front means an image
//     loading in can never shift the layout around it (no CLS).
//   • raster images decode off the main thread (`decoding="async"`) and defer
//     until near the viewport (`loading="lazy"`) unless marked `priority` — use
//     priority only for something above the fold.
//   • it renders a plain <img>, so it costs nothing at import and works cleanly
//     under `output: "export"` (where next/image runs unoptimized anyway).
//
// Serve assets already sized and compressed for their display box (2× for hi-dpi
// at most); this component enforces the layout contract, not the encoding.

import type { ImgHTMLAttributes } from "react";

type ImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "loading" | "width" | "height"> & {
  src: string;
  alt: string;
  width: number;
  height: number;
  /** Above-the-fold image: decode eagerly instead of lazily. */
  priority?: boolean;
};

export function Img({ src, alt, width, height, priority, ...rest }: ImgProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- intentional: static
    // export + a pre-sized asset convention, no optimization server to defer to.
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      decoding="async"
      loading={priority ? "eager" : "lazy"}
      {...(priority ? { fetchPriority: "high" as const } : {})}
      {...rest}
    />
  );
}
