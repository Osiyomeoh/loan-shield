import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "../lib/theme";
import { IconMoon, IconSun } from "./Icons";

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
          transition={{ duration: 0.25 }}
          style={{ display: "grid" }}
        >
          {theme === "dark" ? <IconMoon /> : <IconSun />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
