import Link from "next/link";
import { BrandMark } from "./Icons";
import { ProductMark } from "./ProductMark";
import { COMPANY_LINKS, LEGAL_NAME, PRODUCTS, SIGN_IN_URL } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div className="foot-about">
            <Link className="brand" href="/" aria-label="Lumoras home">
              <BrandMark />
              <span className="brand-t">Lumoras</span>
            </Link>
            <p>
              Sound orchestration for business. AI receptionists, AI voice agents and point of sale, working as one system, from
              the first call to the order on its way.
            </p>
          </div>
          <nav aria-labelledby="ft-platform">
            <h2 className="foot-h" id="ft-platform">Platform</h2>
            <ul>
              <li><Link href="/#platform">Lumoras Voice</Link></li>
              <li><Link href="/#switch">Lumoras POS</Link></li>
              <li><Link href="/#retail">Retail order support</Link></li>
              <li><Link href="/#verticals">AI voice verticals</Link></li>
              <li><Link href="/#enterprise">Enterprise</Link></li>
            </ul>
          </nav>
          <nav aria-labelledby="ft-products">
            <h2 className="foot-h" id="ft-products">Products</h2>
            <ul>
              <li><a href={PRODUCTS.sonorch.url}><ProductMark brand="sonorch" />Sonorch</a><small>{PRODUCTS.sonorch.domain}</small></li>
              <li><a href={PRODUCTS.seasonx.url}><ProductMark brand="seasonx" />SeasonX</a><small>{PRODUCTS.seasonx.domain}</small></li>
              <li><a href={PRODUCTS.kitchenspot.url}><ProductMark brand="kitchenspot" />KitchenSpot</a><small>{PRODUCTS.kitchenspot.domain}</small></li>
            </ul>
          </nav>
          <nav aria-labelledby="ft-company">
            <h2 className="foot-h" id="ft-company">Company</h2>
            <ul>
              {COMPANY_LINKS.map((l) => (
                <li key={l.href}><Link href={l.href}>{l.label}</Link></li>
              ))}
              <li><Link href="/demo">Book a demo</Link></li>
              <li><Link href="/privacy">Privacy policy</Link></li>
              <li><Link href="/terms">Terms of use</Link></li>
              {/* TODO(launch): real sign-in URL */}
              <li><a href={SIGN_IN_URL}>Sign in</a></li>
            </ul>
          </nav>
        </div>
        <div className="foot-base">
          <span>© 2026 {LEGAL_NAME} · lumoras.ai</span>
          <span>Simulated examples on this site are illustrative</span>
        </div>
      </div>
    </footer>
  );
}
