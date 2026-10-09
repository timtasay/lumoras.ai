"use client";

import { useState } from "react";
import { Icon, type IconName } from "../Icons";
import { setHome } from "@/lib/home-bus";

type Vertical = { icon: IconName; badge: string; name: string; ex: string };

export const VERTICALS: Vertical[] = [
  { icon: "scissors", badge: "Sonorch", name: "Salons, barbers & spas", ex: "Books a 90-minute balayage with Maya on Thursday and takes the $25 deposit." },
  { icon: "utensils", badge: "SeasonX", name: "Restaurants", ex: "Takes a pickup order for two birria tacos and an horchata, ready at 6:40." },
  { icon: "store", badge: "Lumoras Sound", name: "Retail stores", ex: "Plays the 4 pm energy set in Zone A and announces curbside pickup at the door." },
  { icon: "cross", badge: "POS + Voice", name: "Medical & dental clinics", ex: "Moves a cleaning to next Tuesday and sends the new-patient forms." },
  { icon: "spark", badge: "Sonorch", name: "Med spas", ex: "Books a consult with the injector and sends the intake form ahead of the visit." },
  { icon: "car", badge: "POS + Voice", name: "Auto service", ex: "Quotes the 60,000-mile service and holds the 8:00 drop-off bay." },
  { icon: "home", badge: "POS + Voice", name: "Home services", ex: "Triages a no-heat call, books the after-hours tech, texts the ETA." },
  { icon: "dumbbell", badge: "POS + Voice", name: "Fitness & wellness", ex: "Books a first reformer class for Saturday at 9 and texts what to bring." },
  { icon: "bed", badge: "Voice + Sound", name: "Hotels & hospitality", ex: "Confirms a late check-in, books the spa for Saturday and notes the extra pillows." },
  { icon: "paw", badge: "POS + Voice", name: "Veterinary & pet grooming", ex: "Books a full groom for a 60-pound doodle and flags the matting note for the groomer." },
  { icon: "brief", badge: "Voice", name: "Legal & accounting", ex: "Screens a new estate-planning inquiry, books the consult and sends the intake packet." },
  { icon: "building", badge: "Voice", name: "Property management", ex: "Logs a leaking dishwasher in unit 4B and schedules the vendor for tomorrow morning." },
  { icon: "cap", badge: "POS + Voice", name: "Education & tutoring", ex: "Matches a parent with an SAT math tutor and books two sessions a week." },
  { icon: "wrench", badge: "POS + Voice", name: "Repair shops", ex: "Quotes a cracked-screen repair, confirms the part is in stock and books a noon drop-off." },
];

/** Cluster colour for tile k: the same spectrum position the particle field uses, as pure CSS. */
function tone(k: number): string {
  const h = (k / (VERTICALS.length - 1)) * 0.98 * 3;
  const seg = Math.min(2, Math.floor(h));
  const f = h - seg;
  const pct = Math.round((1 - f) * 100);
  return `color-mix(in srgb, var(--s${seg + 1}) ${pct}%, var(--s${seg + 2}))`;
}

export function Verticals() {
  const [pinned, setPinned] = useState(-1);
  const [hover, setHover] = useState(-1);
  const active = hover >= 0 ? hover : pinned;

  const show = (k: number) => {
    setHover(k);
    setHome({ hl: k >= 0 ? k : pinned });
  };

  return (
    <div className="wrap vert">
      <div className="vert-intro">
        <div className="panel glass">
          <div className="idx mono"><b>04</b><i />Verticals</div>
          <h2 id="h-vert">Every industry has a voice.</h2>
          <p className="lede">
            AI voice agents built for the trade, from the salon chair to the service bay. Each cluster in the field is an industry. Hover or select one to light it up.
          </p>
          <p className="vert-now mono" aria-live="polite">
            <i style={active >= 0 ? { ["--now" as string]: tone(active) } : undefined} />
            {active >= 0 ? (
              <span>
                Cluster {String(active + 1).padStart(2, "0")} · <b>{VERTICALS[active].name}</b>
              </span>
            ) : (
              <span>14 verticals · one platform</span>
            )}
          </p>
        </div>
      </div>
      <ul className="tiles">
        {VERTICALS.map((v, k) => (
          <li key={v.name}>
            <button
              className="tile"
              type="button"
              aria-pressed={pinned === k}
              style={{ ["--tone" as string]: tone(k) }}
              onPointerEnter={(e) => e.pointerType === "mouse" && show(k)}
              onPointerLeave={(e) => {
                if (e.pointerType !== "mouse") return;
                setHover(-1);
                setHome({ hl: pinned });
              }}
              onFocus={() => show(k)}
              onBlur={() => {
                setHover(-1);
                setHome({ hl: pinned });
              }}
              onClick={() => {
                const next = pinned === k ? -1 : k;
                setPinned(next);
                setHome({ hl: next === -1 ? (hover === k ? k : -1) : next });
              }}
            >
              <span className="t-top">
                <span className="t-ico"><Icon name={v.icon} /></span>
                <span className="badge">{v.badge}</span>
              </span>
              <span className="t-name">{v.name}</span>
              <span className="t-ex">{v.ex}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
