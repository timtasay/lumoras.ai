import type { ReactNode } from "react";
import "@/app/pages.css";
import { PageBackdrop } from "./PageBackdrop";

/** Wrapper for every inner page: calm static backdrop + content column. */
export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <>
      <PageBackdrop />
      <div className={className ? `pg ${className}` : "pg"}>{children}</div>
    </>
  );
}
