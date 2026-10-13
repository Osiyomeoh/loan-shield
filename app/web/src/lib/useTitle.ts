import { useEffect } from "react";

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title.includes("Loan Shield") ? title : `${title} · Loan Shield`;
  }, [title]);
}
