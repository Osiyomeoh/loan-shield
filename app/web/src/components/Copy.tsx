import { useState } from "react";
import { IconCheck, IconCopy } from "./Icons";

/** Copies `text` to the clipboard and says so for a moment. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      setDone(false);
    }
  };
  return (
    <button type="button" className={`copy-btn ${done ? "done" : ""}`} onClick={copy} aria-label={`${label}: ${text}`}>
      {done ? <IconCheck /> : <IconCopy />}
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </button>
  );
}

/** A dark code block with a title bar and a copy button. */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="code-wrap">
      <div className="code-bar">
        <span>
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {label}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="code" aria-label={label}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
