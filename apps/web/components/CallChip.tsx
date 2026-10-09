import { Icon } from "./Icons";
import { DEMO_LINE, DEMO_LINE_TEL } from "@/lib/site";

/** "Call the live demo · 941-430-4049" with the number as selectable text. */
export function CallChip({ className }: { className?: string }) {
  return (
    <div className={className ? `callchip ${className}` : "callchip"}>
      <a href={DEMO_LINE_TEL}>
        <Icon name="phone" />
        Call the live demo
      </a>
      <span className="sep" aria-hidden="true">·</span>
      <span className="num">{DEMO_LINE}</span>
    </div>
  );
}
