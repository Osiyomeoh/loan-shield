import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { REPO } from "../config";
import { Brand } from "./Brand";
import { IconClose, IconGithub, IconMenu } from "./Icons";
import { LiveChip } from "./LiveChip";
import { ThemeToggle } from "./ThemeToggle";

export const NAV = [
  { to: "/app", label: "Dashboard" },
  { to: "/how-it-works", label: "How it works" },
  { to: "/compare", label: "Compare" },
  { to: "/market", label: "Market" },
  { to: "/developers", label: "Developers" },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);

  return (
    <header className={`nav ${scrolled ? "scrolled" : ""}`}>
      <div className="nav-in">
        <Brand />
        <nav className="nav-links" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              {({ isActive }) => (
                <>
                  {n.label}
                  {isActive && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="nav-right">
          <span className="hide-sm"><LiveChip compact /></span>
          <ThemeToggle />
          <a className="icon-btn hide-xs" href={REPO} target="_blank" rel="noopener noreferrer" aria-label="Source on GitHub" title="Source on GitHub">
            <IconGithub width={18} height={18} />
          </a>
          <button type="button" className="icon-btn show-md" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <IconClose /> : <IconMenu />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div className="sheet" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.22 }}>
            <nav aria-label="Mobile">
              {[{ to: "/", label: "Home" }, ...NAV].map((n, i) => (
                <motion.div key={n.to} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }}>
                  <NavLink to={n.to} end className={({ isActive }) => `sheet-link ${isActive ? "active" : ""}`}>
                    {n.label}
                  </NavLink>
                </motion.div>
              ))}
            </nav>
            <div className="sheet-foot">
              <LiveChip />
              <a href={REPO} target="_blank" rel="noopener noreferrer" className="btn ghost sm">
                <IconGithub width={16} height={16} /> GitHub
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
