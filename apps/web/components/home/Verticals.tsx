import type { ReactNode } from "react";
import { ProductMark, brandFor } from "@/components/ProductMark";
import { VertHighlight } from "./VertHighlight";

const VI: Record<string, ReactNode> = {
  scissors: (<><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" /></>),
  fork: <path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 21V3c-2 1.5-3 4.5-3 8h3" />,
  bag: (<><path d="M6 7h12l1 14H5L6 7z" /><path d="M9 7V6a3 3 0 0 1 6 0v1" /></>),
  med: (<><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M12 8v8M8 12h8" /></>),
  drop: (<><path d="M12 3c3.5 4.5 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2.5-6.5 6-11z" /><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5" /></>),
  wrench: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.5-3.5a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.5 3.5z" />,
  house: (<><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10M10 20v-6h4v6" /></>),
  dumbbell: <path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" />,
  bed: (<><path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6" /><circle cx="7" cy="11.5" r="1.8" /></>),
  paw: (<><circle cx="6.5" cy="10" r="1.7" /><circle cx="10" cy="6.5" r="1.7" /><circle cx="14" cy="6.5" r="1.7" /><circle cx="17.5" cy="10" r="1.7" /><path d="M8 16.5c0-2.6 1.8-4.5 4-4.5s4 1.9 4 4.5c0 1.6-1.2 2.5-2.6 2.5-.6 0-1-.3-1.4-.3s-.8.3-1.4.3C9.2 19 8 18.1 8 16.5z" /></>),
  case: (<><rect x="3" y="7.5" width="18" height="12" rx="2" /><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5M3 13h18" /></>),
  building: (<><path d="M5 21V4h10v17M15 9h4v12M3 21h18" /><path d="M8 8h1M11 8h1M8 12h1M11 12h1M8 16h1M11 16h1" /></>),
};

type Vert = { name: string; icon: keyof typeof VI; col: string; ex: string; badge: string; href?: string };

/** The twelve AI voice verticals. Card order = particle constellation cluster order. */
export const VERTS: Vert[] = [
  { name: "Salons & spas", icon: "scissors", col: "var(--v-salon)", ex: "Books a 90-minute balayage with Maya on Thursday and takes the $25 deposit.", badge: "Sonorch", href: "https://sonorch.ai" },
  { name: "Restaurants", icon: "fork", col: "var(--v-restaurant)", ex: "Takes a pickup order for two birria tacos and an horchata, ready at 6:40.", badge: "SeasonX", href: "https://seasonx.ai" },
  { name: "Retail & e-commerce", icon: "bag", col: "var(--v-retail)", ex: "Finds order 20814, confirms it is out for delivery by 8 pm and texts the tracking link.", badge: "Lumoras Voice", href: "#retail" },
  { name: "Medical & dental clinics", icon: "med", col: "var(--v-dental)", ex: "Moves a cleaning to next Tuesday and sends the new-patient forms.", badge: "Lumoras Voice" },
  { name: "Med spas", icon: "drop", col: "var(--v-salon)", ex: "Screens a first-time injectables caller, books the consult and holds it with a deposit.", badge: "Sonorch", href: "https://sonorch.ai" },
  { name: "Auto service", icon: "wrench", col: "var(--v-auto)", ex: "Quotes the 60,000-mile service and holds the 8:00 drop-off bay.", badge: "Lumoras Voice" },
  { name: "Home services", icon: "house", col: "var(--v-home)", ex: "Triages a no-heat call, books the after-hours tech, texts the ETA.", badge: "Lumoras Voice" },
  { name: "Fitness & wellness", icon: "dumbbell", col: "var(--v-salon)", ex: "Fills the last spot in the 6 am reformer class from the waitlist and confirms by text.", badge: "Lumoras Voice" },
  { name: "Hotels & hospitality", icon: "bed", col: "var(--v-dental)", ex: "Confirms a late check-in, books a Saturday spa slot and notes the anniversary.", badge: "Lumoras Voice" },
  { name: "Veterinary & pet grooming", icon: "paw", col: "var(--v-home)", ex: "Books a full groom for a 70-pound doodle and flags the rabies record that is due.", badge: "Lumoras Voice" },
  { name: "Professional services", icon: "case", col: "var(--v-auto)", ex: "Qualifies a new estate-planning inquiry and books a 30-minute intake with the right partner.", badge: "Lumoras Voice" },
  { name: "Property management", icon: "building", col: "var(--v-restaurant)", ex: "Logs a leaking water heater in 4B, dispatches the on-call plumber and updates the resident.", badge: "Lumoras Voice" },
];

/** Vertical cards with icon hover morphs. Hover/focus lights the matching particle cluster behind the card. */
export function Verticals() {
  return (
    <>
      <div className="vgrid" id="vgrid">
        {VERTS.map((v, k) => (
          <article key={v.name} className="vcard rv" data-k={k} style={{ ["--vcol" as string]: v.col }}>
            <div className="vic" aria-hidden="true">
              <span className="tile" />
              <svg className="g" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                {VI[v.icon]}
              </svg>
              <svg className="w" viewBox="0 0 22 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M3 10a8 8 0 0 1 0 12" />
                <path d="M9 5a14 14 0 0 1 0 22" />
              </svg>
            </div>
            <h3>{v.name}</h3>
            <p>{v.ex}</p>
            {v.href ? (
              <a className="badge" href={v.href}>
                {brandFor(v.badge) ? <ProductMark brand={brandFor(v.badge)!} /> : <i aria-hidden="true" />}
                {v.badge}
              </a>
            ) : (
              <span className="badge">
                <i aria-hidden="true" />
                {v.badge}
              </span>
            )}
          </article>
        ))}
      </div>
      <VertHighlight />
    </>
  );
}
