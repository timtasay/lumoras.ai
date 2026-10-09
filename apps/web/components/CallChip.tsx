import { Icon } from "./Icons";
import { DEMO_LINE, DEMO_LINE_TEL } from "@/lib/site";

/** "Call the live demo" pill with the number as selectable text. */
export function CallChip({ className }: { className?: string }) {
  return (
    <div className={className ? `callchip ${className}` : "callchip"}>
      <a href={DEMO_LINE_TEL}>
        <Icon name="phone" />
        Call the live demo
      </a>
      <span className="num" title="Live demo line">{DEMO_LINE}</span>
    </div>
  );
}
