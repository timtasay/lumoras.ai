import Link from "next/link";
import { Icon } from "./Icons";
import { CallChip } from "./CallChip";
import { PRODUCTS } from "@/lib/site";

/** "Still stuck?" block: contact via /demo, the live line, and product help centers. */
export function StillStuck({ headingLevel = "h2" }: { headingLevel?: "h2" | "h3" }) {
  const H = headingLevel;
  return (
    <section className="stuck panel" aria-labelledby="stuck-h">
      <div className="stuck-main">
        <H id="stuck-h" className="stuck-title">Still stuck?</H>
        <p>
          Tell us what you&apos;re trying to do and we&apos;ll walk you through it. Or call the live demo line to hear the AI receptionist
          handle a call.
        </p>
        <div className="stuck-actions">
          <Link className="btn btn-primary" href="/demo">
            Contact us <Icon name="arrow" />
          </Link>
          <CallChip />
        </div>
      </div>
      <div className="stuck-side">
        <p className="stuck-k">Product help centers</p>
        <ul>
          <li>
            <a href={PRODUCTS.sonorch.helpCenter}>
              <strong>Sonorch</strong> <span>Salons, barbers and spas</span> <Icon name="ext" />
            </a>
          </li>
          <li>
            <a href={PRODUCTS.seasonx.helpCenter}>
              <strong>SeasonX</strong> <span>Restaurants</span> <Icon name="ext" />
            </a>
          </li>
        </ul>
      </div>
    </section>
  );
}
