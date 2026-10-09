"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icons";

/** Site sections as links (each is its own URL), styled like tabs; the current one carries aria-current. */
export function SiteTabs({ base }: { base: string }) {
  const path = usePathname();
  const tabs: [string, string, IconName][] = [
    ["", "Overview", "radar"],
    ["/keywords", "Keywords", "key"],
    ["/brand", "Brand profile", "sparkle"],
    ["/authors", "Authors", "users"],
    ["/connections", "Connections", "plug"],
    ["/settings", "Settings", "settings"],
  ];
  return (
    <nav className="site-tabs" aria-label="Site sections">
      {tabs.map(([href, label, icon]) => {
        const full = base + href;
        const active = path === full;
        return (
          <Link key={href} href={full} className="site-tab" aria-current={active ? "page" : undefined}>
            <Icon name={icon} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
