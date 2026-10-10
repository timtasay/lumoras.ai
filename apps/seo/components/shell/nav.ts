import type { IconName } from "@/components/Icons";
import { can, type WorkspaceRole } from "@/lib/auth/permissions";

export type NavItem = {
  key: string;
  label: string;
  icon: IconName;
  href?: string;
  /** Not built yet: shown greyed out with the phase that delivers it. */
  phase?: number;
  /** Highlight for any path under href, not only href itself. */
  prefix?: boolean;
};
export type NavGroup = { group: string; items: NavItem[] };

export const PRODUCT_NAME = "Lumoras Growth";
/** Owner decision #1 (section 18): product name and host name are pending. */
export const PRODUCT_NAME_PENDING = true;

/** Screens that arrive with later phases, listed so the shape of the product is visible. */
export const LATER: NavItem[] = [
  { key: "prospects", label: "Link prospects", icon: "link", phase: 5 },
  { key: "social", label: "Social", icon: "share", phase: 5 },
];

export type ShellSite = { id: string; name: string; domain: string };
export type ShellWorkspace = { id: string; name: string; slug: string; role: WorkspaceRole; sites: ShellSite[] };

export function buildNav(ws: ShellWorkspace | null, opts: { platformAdmin: boolean; designEnabled: boolean }): NavGroup[] {
  const groups: NavGroup[] = [];
  if (ws) {
    const base = `/w/${ws.slug}`;
    groups.push({
      group: ws.name,
      items: [
        { key: "home", label: "Overview", icon: "home", href: base },
        ...ws.sites.slice(0, 8).map((s) => ({ key: `site-${s.id}`, label: s.domain, icon: "globe" as const, href: `${base}/sites/${s.id}`, prefix: true })),
        { key: "keywords", label: "Keywords", icon: "key" as const, href: `${base}/keywords` },
        ...(can(ws.role, "site:create") ? [{ key: "add-site", label: "Add a site", icon: "plus" as const, href: `${base}/sites/new` }] : []),
      ],
    });
    groups.push({
      group: "Content",
      items: [
        { key: "calendar", label: "Content calendar", icon: "calendar", href: `${base}/content`, prefix: true },
        { key: "review", label: "Review queue", icon: "gate", href: `${base}/review` },
        { key: "runs", label: "Pipeline runs", icon: "flow", href: `${base}/runs`, prefix: true },
      ],
    });
    // Phase 4: measurement; each opens the first site's tab (the site's own tabs switch between them)
    groups.push({
      group: "Measure",
      items: [
        { key: "rankings", label: "Rankings", icon: "trend", href: `${base}/rankings` },
        { key: "search", label: "Search Console and GA4", icon: "search", href: `${base}/search` },
        { key: "site-audit", label: "Site audit", icon: "audit", href: `${base}/site-audit` },
        { key: "backlinks", label: "Backlinks", icon: "link", href: `${base}/backlinks` },
      ],
    });
    groups.push({ group: "Coming next", items: LATER });
    groups.push({
      group: "Settings",
      items: [
        { key: "settings", label: "Members and roles", icon: "users", href: `${base}/settings` },
        { key: "budget", label: "Budget and usage", icon: "db", href: `${base}/settings/budget` },
        { key: "audit", label: "Audit log", icon: "history", href: `${base}/audit` },
      ],
    });
  }
  if (opts.platformAdmin) {
    groups.push({
      group: "Lumoras staff",
      items: [
        { key: "agency", label: "Agency home", icon: "building", href: "/agency" },
        { key: "platform-audit", label: "Platform audit", icon: "shield", href: "/agency/audit" },
      ],
    });
  }
  if (opts.designEnabled) groups.push({ group: "Build", items: [DESIGN_NAV] });
  return groups;
}

export const DESIGN_NAV: NavItem = { key: "design", label: "Design system", icon: "swatch", href: "/design" };
