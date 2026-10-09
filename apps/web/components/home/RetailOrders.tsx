"use client";

import { useEffect, useRef, useState } from "react";
import { setHome } from "@/lib/home-bus";

const STEPS = ["Ordered", "Packed", "Shipped", "Out for delivery", "Delivered"] as const;

type Scenario = {
  label: string;
  sub: string;
  ring: string;
  order: string;
  item: string;
  total: string;
  /** index into STEPS the order has reached */
  step: number;
  /** what the call did to the order, shown on the timeline */
  outcome: string;
  caller: string;
  agent: string;
  action: string;
  detail: string;
};

/** Order matches the particle field's ring index (0 … 3). Orders, names and prices are illustrative. */
const SC: Scenario[] = [
  {
    label: "Where's my order?", sub: "Status · tracking", ring: "var(--v-dental)",
    order: "#20814", item: "Linen camp shirt · M · Sand", total: "$68.00", step: 3, outcome: "Arriving today by 8 pm",
    caller: "“I ordered a linen shirt last week. Has it shipped?”",
    agent: "“It shipped Tuesday and it's out for delivery today, by 8 pm. I've texted you the tracking link.”",
    action: "Tracking link texted", detail: "Caller verified · order number + zip",
  },
  {
    label: "Cancel", sub: "Before it ships", ring: "var(--v-restaurant)",
    order: "#20871", item: "Leather slide sandals · 8", total: "$54.00", step: 0, outcome: "Canceled before packing",
    caller: "“Can I cancel the sandals I ordered this morning?”",
    agent: "“Done. It hadn't been packed yet, so it's canceled, and $54.00 is going back to your card ending 4417.”",
    action: "Order canceled", detail: "Refund to original payment",
  },
  {
    label: "Change", sub: "Size · address", ring: "var(--v-salon)",
    order: "#20902", item: "Camp shirt · M → L · Sand", total: "$68.00", step: 1, outcome: "Updated · still ships today",
    caller: "“I ordered the camp shirt in a medium. Can I switch it to a large?”",
    agent: "“The large in sand is in stock. I've swapped it at the same price, and it still ships today.”",
    action: "Size changed M → L", detail: "Confirmation texted",
  },
  {
    label: "Return", sub: "Returns · exchanges", ring: "var(--ring-close)",
    order: "#20644", item: "Quilted jacket · L", total: "$128.00", step: 4, outcome: "Exchange started · size M",
    caller: "“The jacket doesn't fit. Can I exchange it for a medium?”",
    agent: "“It's inside your 30-day window. I've emailed a prepaid return label, and the medium ships when the carrier scans your return.”",
    action: "Return label emailed", detail: "Exchange held · medium reserved",
  },
];
export const DEFAULT_SCENARIO = 0;

/** Retail order calls: an order timeline, the call and what the agent did. The selected call drives the particle rings too. */
export function RetailOrders() {
  const [i, setI] = useState(DEFAULT_SCENARIO);
  const [shown, setShown] = useState(DEFAULT_SCENARIO); // text cross-fades 300ms behind the visuals
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const d = SC[i], t = SC[shown];
  const swapping = shown !== i;
  const canceled = d.label === "Cancel";

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const pick = (k: number) => {
    setI(k);
    setHome({ dp: k });
    if (timer.current) clearTimeout(timer.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setShown(k);
    else timer.current = setTimeout(() => setShown(k), 300);
  };

  return (
    <div className="retail-wrap" style={{ ["--ring" as string]: d.ring }}>
      <div className="order-panel rv">
        <div className="order-h">
          <span>Online order · <b>{t.order}</b></span>
          <span>{t.total}</span>
        </div>
        <p className={swapping ? "order-item swap" : "order-item"}>{t.item}</p>
        <ol className={canceled ? "otrack canceled" : "otrack"} style={{ ["--s" as string]: d.step }} aria-label={`Order ${t.order}: ${t.outcome}`}>
          {STEPS.map((s, k) => (
            <li key={s} className={k < d.step ? "done" : k === d.step ? "now" : undefined}>
              <i aria-hidden="true" />
              <span>{canceled && k === d.step ? "Canceled" : s}</span>
            </li>
          ))}
        </ol>
        <p className={swapping ? "order-out swap" : "order-out"}>
          <i aria-hidden="true" />
          {t.outcome}
        </p>
        <div className="rswitch" role="group" aria-label="Order call" style={{ ["--i" as string]: i }}>
          <span className="thumb" aria-hidden="true" />
          {SC.map((x, k) => (
            <button key={x.label} type="button" aria-pressed={k === i} onClick={() => pick(k)}>
              <b>{x.label}</b>
              <span>{x.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="call-panel rv" aria-live="polite">
        <div className="cline">
          <h3>Caller</h3>
          <p className={swapping ? "swap" : undefined}>{t.caller}</p>
        </div>
        <div className="cline agent">
          <h3>Lumoras Voice</h3>
          <p className={swapping ? "swap" : undefined}>{t.agent}</p>
        </div>
        <div className="ann">
          <span>
            <i aria-hidden="true" />
            {t.action}
          </span>
          <p className={swapping ? "swap" : undefined}>{t.detail}</p>
        </div>
        <p className="sync mono">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2" />
            <path d="M21 4v5h-5M3 20v-5h5" />
          </svg>
          Connected to your order and shipping systems
        </p>
      </div>
    </div>
  );
}
