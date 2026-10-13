import { useEffect, useState, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const root = document.documentElement;
const read = (): Theme => (root.dataset.theme === "light" ? "light" : "dark");

function saved(): Theme | undefined {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : undefined;
  } catch {
    return undefined;
  }
}

// index.html applies the saved or system theme before first paint. Every component reads it from the <html>
// attribute, so a toggle anywhere updates all of them.
function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  // Follow the system setting until the viewer picks a theme themselves.
  const mq = matchMedia("(prefers-color-scheme: light)");
  const onSystem = () => {
    if (!saved()) root.dataset.theme = mq.matches ? "light" : "dark";
  };
  mq.addEventListener("change", onSystem);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", onSystem);
  };
}

export function toggleTheme() {
  const next: Theme = read() === "dark" ? "light" : "dark";
  root.classList.add("theme-switching");
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    // Private windows can refuse storage; the theme still applies for this visit.
  }
  window.setTimeout(() => root.classList.remove("theme-switching"), 450);
}

export function useTheme(): [Theme, () => void] {
  return [useSyncExternalStore(subscribe, read), toggleTheme];
}

/** True when the viewer asked the system for reduced motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
