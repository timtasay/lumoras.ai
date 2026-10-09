import Link from "next/link";
import { BrandMark } from "./Icons";
import { COMPANY_LINKS, LEGAL_NAME, PRODUCTS } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div>
            <Link className="brand" href="/" aria-label="Lumoras home">
              <BrandMark />
              Lumoras
            </Link>
            <p>Sound orchestration for every business. AI receptionists, AI voice agents, point of sale and in-store sound, working as one system.</p>
          </div>
          <nav aria-labelledby="ft-platform">
            <h2 className="foot-h" id="ft-platform">Platform</h2>
            <ul>
              <li><Link href="/#voice">Lumoras Voice</Link></li>
              <li><Link href="/#pos">Lumoras POS</Link></li>
              <li><Link href="/#sound">Lumoras Sound</Link></li>
              <li><Link href="/#verticals">Verticals</Link></li>
              <li><Link href="/#enterprise">Enterprise</Link></li>
            </ul>
          </nav>
          <nav aria-labelledby="ft-products">
            <h2 className="foot-h" id="ft-products">Products</h2>
            <ul>
              <li><a href={PRODUCTS.sonorch.url}>Sonorch</a> <span className="dim">{PRODUCTS.sonorch.domain}</span></li>
              <li><a href={PRODUCTS.seasonx.url}>SeasonX</a> <span className="dim">{PRODUCTS.seasonx.domain}</span></li>
              <li><a href={PRODUCTS.kitchenspot.url}>KitchenSpot</a> <span className="dim">{PRODUCTS.kitchenspot.domain}</span></li>
            </ul>
          </nav>
          <nav aria-labelledby="ft-company">
            <h2 className="foot-h" id="ft-company">Company</h2>
            <ul>
              {COMPANY_LINKS.map((l) => (
                <li key={l.href}><Link href={l.href}>{l.label}</Link></li>
              ))}
              <li><Link href="/demo">Book a demo</Link></li>
            </ul>
          </nav>
        </div>
        <div className="foot-base mono">
          <span>© 2026 {LEGAL_NAME}</span>
          <span>Simulated examples on this site are illustrative</span>
        </div>
      </div>
    </footer>
  );
}
