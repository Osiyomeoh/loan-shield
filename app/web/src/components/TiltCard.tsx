import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from "motion/react";
import type { PointerEvent, ReactNode } from "react";
import { useReducedMotion } from "../lib/theme";

/** A card that tilts in 3D toward the pointer, with a soft light that follows it. */
export function TiltCard({ children, className = "", max = 9 }: { children: ReactNode; className?: string; max?: number }) {
  const reduced = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const sx = useSpring(px, { stiffness: 180, damping: 18 });
  const sy = useSpring(py, { stiffness: 180, damping: 18 });
  const rotateX = useTransform(sy, [0, 1], [max, -max]);
  const rotateY = useTransform(sx, [0, 1], [-max, max]);
  const lx = useTransform(px, (v) => `${v * 100}%`);
  const ly = useTransform(py, (v) => `${v * 100}%`);
  const glare = useMotionTemplate`radial-gradient(420px circle at ${lx} ${ly}, var(--spot), transparent 60%)`;

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  };
  const onLeave = () => {
    px.set(0.5);
    py.set(0.5);
  };

  return (
    <div className="tilt-wrap">
      <motion.div
        className={`card tilt ${className}`}
        style={reduced ? undefined : { rotateX, rotateY, transformPerspective: 900 }}
        onPointerMove={reduced ? undefined : onMove}
        onPointerLeave={reduced ? undefined : onLeave}
      >
        <motion.div className="tilt-glare" style={{ background: glare }} aria-hidden="true" />
        <div className="tilt-body">{children}</div>
      </motion.div>
    </div>
  );
}
