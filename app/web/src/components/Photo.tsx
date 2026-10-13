import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { photoSrc, photoSrcSet, type Photo as P } from "../lib/photos";
import { useReducedMotion } from "../lib/theme";

/** A credited Unsplash photo with a gentle parallax as it scrolls past. */
export function Photo({ photo, sizes = "(max-width: 760px) 100vw, 50vw", className = "", ratio = "4 / 5", eager = false }: { photo: P; sizes?: string; className?: string; ratio?: string; eager?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["-6%", "6%"]);
  return (
    <figure ref={ref} className={`photo ${className}`} style={{ aspectRatio: ratio }}>
      <motion.img
        src={photoSrc(photo, 1200)}
        srcSet={photoSrcSet(photo)}
        sizes={sizes}
        alt={photo.alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        style={reduced ? undefined : { y, scale: 1.14 }}
      />
      <figcaption>
        Photo: <a href={photo.page} target="_blank" rel="noopener noreferrer">{photo.by}</a> / Unsplash
      </figcaption>
    </figure>
  );
}
