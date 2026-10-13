import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion, useTheme } from "../lib/theme";

const HeroScene = lazy(() => import("../three/HeroScene"));

/** Shown while three.js loads, and instead of it if WebGL isn't available. */
function StaticShield() {
  return (
    <div className="static-shield" aria-hidden="true">
      <svg viewBox="0 0 200 220">
        <defs>
          <linearGradient id="ssg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.9" />
            <stop offset="1" stopColor="var(--accent-2)" stopOpacity="0.7" />
          </linearGradient>
        </defs>
        <path d="M100 10 30 36v52c0 44 30 80 70 94 40-14 70-50 70-94V36L100 10z" fill="url(#ssg)" opacity="0.35" stroke="var(--accent)" strokeWidth="3" />
        <circle cx="100" cy="100" r="38" fill="#f7931a" />
        <text x="100" y="101" textAnchor="middle" dominantBaseline="middle" fontSize="44" fontWeight="700" fill="#fff">₿</text>
      </svg>
    </div>
  );
}

class WebGLBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <StaticShield /> : this.props.children;
  }
}

/** The 3D shield, loaded after the page so the first paint stays fast, and paused while it is off screen. */
export function HeroVisual() {
  const [theme] = useTheme();
  const still = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setActive(!!e?.isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="hero-visual">
      <div className="hero-halo" aria-hidden="true" />
      <WebGLBoundary>
        <Suspense fallback={<StaticShield />}>
          <HeroScene theme={theme} active={active} still={still} />
        </Suspense>
      </WebGLBoundary>
    </div>
  );
}
