import type { IconName } from "@/components/Icons";

export type NavItem = {
  key: string;
  label: string;
  icon: IconName;
  href?: string;
  /** Not built yet: shown greyed out with the phase that delivers it. */
  phase?: number;
};

export const PRODUCT_NAME = "Lumoras Growth";
/** Owner decision #1 (section 18): product name and host name are pending. */
export const PRODUCT_NAME_PENDING = true;

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Workspace",
    items: [
      { key: "home", label: "Overview", icon: "home", href: "/" },
      { key: "calendar", label: "Content calendar", icon: "calendar", phase: 3 },
      { key: "pipeline", label: "Pipeline runs", icon: "flow", phase: 3 },
      { key: "keywords", label: "Keywords", icon: "key", phase: 2 },
      { key: "rankings", label: "Rankings", icon: "trend", phase: 4 },
      { key: "audit", label: "Site audit", icon: "audit", phase: 4 },
      { key: "backlinks", label: "Backlinks", icon: "link", phase: 5 },
      { key: "social", label: "Social", icon: "share", phase: 5 },
    ],
  },
  {
    group: "Settings",
    items: [
      { key: "site", label: "Site settings", icon: "globe", phase: 1 },
      { key: "workspace", label: "Workspace", icon: "settings", phase: 1 },
    ],
  },
];

export const DESIGN_NAV: NavItem = { key: "design", label: "Design system", icon: "swatch", href: "/design" };
