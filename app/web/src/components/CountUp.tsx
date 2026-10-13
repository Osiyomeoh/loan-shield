import { animate, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";

/** A number that counts up to `value` when it first comes into view, and eases to each new value after that. */
export function CountUp({ value, format, duration = 1.4, className }: { value: number; format: (n: number) => string; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const shown = useRef(0);
  const [text, setText] = useState(() => format(0));

  useEffect(() => {
    if (!inView || !Number.isFinite(value)) {
      if (!Number.isFinite(value)) setText(format(value));
      return;
    }
    const controls = animate(shown.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (n) => {
        shown.current = n;
        setText(format(n));
      },
    });
    return () => controls.stop();
  }, [value, inView, duration, format]);

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}
