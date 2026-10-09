import type { ReactNode } from "react";
import { BrandMark } from "@/components/Icons";
import { FieldBackdrop } from "@/components/FieldBackdrop";
import { PRODUCT_NAME } from "@/components/shell/nav";

/**
 * The Spectrum particle field behind a glass panel: sign-in, invitations and
 * the first onboarding step. "page" fills the viewport; "inline" is the
 * bordered demo on /design. An optional aside sits over the field on wide
 * screens.
 */
export function AuthStage({ children, aside, variant = "page", form = 0, wide = false }: { children: ReactNode; aside?: ReactNode; variant?: "page" | "inline"; form?: number; wide?: boolean }) {
  return (
    <div className={`stage stage-${variant}`}>
      <FieldBackdrop form={form} />
      <div className={wide ? "stage-glass glass wide" : "stage-glass glass"}>
        <div className="stage-brand">
          <BrandMark size={32} />
          <span>{PRODUCT_NAME}</span>
        </div>
        {children}
      </div>
      {aside ? <div className="stage-aside">{aside}</div> : null}
    </div>
  );
}
