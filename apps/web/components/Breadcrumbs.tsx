import Link from "next/link";
import { JsonLd } from "./JsonLd";
import { breadcrumbLd, type Crumb } from "@/lib/seo";

/** Visible breadcrumb trail plus BreadcrumbList JSON-LD. The last crumb is the current page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const all: Crumb[] = [{ name: "Home", path: "/" }, ...items];
  return (
    <>
      <nav className="crumbs mono" aria-label="Breadcrumb">
        <ol>
          {all.map((c, i) => (
            <li key={c.path}>
              {i < all.length - 1 ? <Link href={c.path}>{c.name}</Link> : <span aria-current="page">{c.name}</span>}
            </li>
          ))}
        </ol>
      </nav>
      <JsonLd data={breadcrumbLd(all)} />
    </>
  );
}
