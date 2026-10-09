import { AppShell, type ShellData } from "@/components/shell/AppShell";

/** /design renders inside the real shell with sample data (no session needed; dev only). */
const DEMO: ShellData = {
  user: { name: "Demo reviewer", email: "reviewer@example.com" },
  platformAdmin: true,
  impersonation: null,
  designEnabled: true,
  demo: true,
  notifications: [
    { id: "n1", title: "Crawl finished: sonorch.ai", body: "214 routes from 3 sitemaps.", href: null, read: false, at: "2 min ago", workspace: "Lumoras" },
    { id: "n2", title: "Ana joined Northwind Dental", body: "As a viewer.", href: null, read: true, at: "Yesterday", workspace: "Northwind Dental" },
  ],
  workspaces: [
    {
      id: "demo-lumoras",
      name: "Lumoras",
      slug: "lumoras",
      role: "owner",
      sites: [
        { id: "s1", name: "Sonorch", domain: "sonorch.ai" },
        { id: "s2", name: "SeasonX", domain: "seasonx.ai" },
        { id: "s3", name: "Lumoras", domain: "lumoras.ai" },
      ],
    },
  ],
};

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  return <AppShell data={DEMO}>{children}</AppShell>;
}
