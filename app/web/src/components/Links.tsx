import type { ReactNode } from "react";
import { explorerUrl } from "../config";
import { IconExternal } from "./Icons";

/** An external link that opens in a new tab. */
export function Ext({ href, children, className, icon = false }: { href: string; children: ReactNode; className?: string; icon?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      {icon && <IconExternal className="ext-ico" />}
    </a>
  );
}

/** An explorer.arc.io link, or plain text on a local fork, whose contracts and transactions aren't on the explorer. */
export function Explorer({ path, children, className }: { path: string; children: ReactNode; className?: string }) {
  const href = explorerUrl(path);
  if (!href) return <span className={className} title="exists only on the local fork">{children}</span>;
  return <Ext href={href} className={className}>{children}</Ext>;
}
