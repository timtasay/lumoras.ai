"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ThemeControl } from "@lumoras/ui-tokens/theme-control";
import {
  dispatchThemeChange,
  persistThemeMode,
  resolveMode,
  revealThemeChange,
  setThemeModeState,
  writeThemeAttr,
  type ThemeMode,
} from "@lumoras/ui-tokens/theme";
import { BrandMark, Icon } from "@/components/Icons";
import { CommandPaletteProvider, useCommandPalette, type Command } from "@/components/ui/CommandPalette";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { DESIGN_NAV, NAV, PRODUCT_NAME, type NavItem } from "./nav";

const SITES = ["sonorch.ai", "seasonx.ai", "lumoras.ai"];

function setTheme(m: ThemeMode) {
  const before = resolveMode((document.documentElement.getAttribute("data-theme") as ThemeMode) || "auto");
  setThemeModeState(m);
  persistThemeMode(m);
  revealThemeChange(resolveMode(m) !== before, null, () => {
    writeThemeAttr(m);
    dispatchThemeChange({ mode: m, resolved: resolveMode(m) });
  });
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: () => void }) {
  if (!item.href) {
    return (
      <span className="side-link" aria-disabled="true">
        <Icon name={item.icon} />
        <span className="side-text">{item.label}</span>
        <span className="side-phase" title={`Arrives in Phase ${item.phase}`}>
          P{item.phase}
        </span>
      </span>
    );
  }
  return (
    <Link href={item.href} className="side-link" aria-current={active ? "page" : undefined} onClick={onNavigate}>
      <Icon name={item.icon} />
      <span className="side-text">{item.label}</span>
    </Link>
  );
}

function TopBar({ title, onMenu, menuOpen }: { title: string; onMenu: () => void; menuOpen: boolean }) {
  const palette = useCommandPalette();
  return (
    <header className="top">
      <button type="button" className="icon-btn top-menu" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="side" onClick={onMenu}>
        <Icon name={menuOpen ? "close" : "menu"} />
      </button>
      <p className="top-title">{title}</p>
      <button type="button" className="top-search" onClick={palette.open}>
        <Icon name="search" />
        <span className="top-search-text">Search or jump to…</span>
        <span className="top-kbd" aria-hidden="true">
          <kbd>⌘</kbd>
          <kbd>K</kbd>
        </span>
      </button>
      <ThemeControl renderIcon={(n) => <Icon name={n} />} />
      <span className="avatar" aria-label="Signed in as Lumoras staff (placeholder)" role="img">
        LS
      </span>
    </header>
  );
}

function Shell({ children, designEnabled }: { children: ReactNode; designEnabled: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const all = [...NAV.flatMap((g) => g.items), DESIGN_NAV];
  const title = all.find((i) => i.href === pathname)?.label ?? PRODUCT_NAME;

  return (
    <div className="app" data-menu={open ? "open" : undefined}>
      <aside id="side" className="side" aria-label="Sidebar">
        <Link href="/" className="side-brand">
          <BrandMark size={28} />
          <span>
            {PRODUCT_NAME}
            <small>working name</small>
          </span>
        </Link>
        <button type="button" className="ws-switch" aria-label="Workspace: Lumoras, 3 sites (switching arrives in Phase 1)">
          <span className="ws-mark" aria-hidden="true">L</span>
          <span className="ws-text">
            <strong>Lumoras</strong>
            <span>{SITES.length} sites</span>
          </span>
          <Icon name="chev" />
        </button>
        <nav className="side-nav" aria-label="Main navigation">
          {NAV.map((g) => (
            <div key={g.group} className="side-group">
              <p className="label side-label">{g.group}</p>
              <ul>
                {g.items.map((it) => (
                  <li key={it.key}>
                    <NavLink item={it} active={pathname === it.href} onNavigate={() => setOpen(false)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {designEnabled ? (
            <div className="side-group">
              <p className="label side-label">Build</p>
              <ul>
                <li>
                  <NavLink item={DESIGN_NAV} active={pathname === "/design"} onNavigate={() => setOpen(false)} />
                </li>
              </ul>
            </div>
          ) : null}
        </nav>
        <div className="side-foot">
          <span className="side-env">
            <span className="light-dot" aria-hidden="true" /> Phase 0 · foundations
          </span>
        </div>
      </aside>
      <button type="button" className="side-scrim" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />
      <div className="main-col">
        <TopBar title={title} onMenu={() => setOpen((o) => !o)} menuOpen={open} />
        <main id="main" tabIndex={-1} className="main">
          {children}
        </main>
      </div>
    </div>
  );
}

function CommandsAndShell({ children, designEnabled }: { children: ReactNode; designEnabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const commands = useMemo<Command[]>(() => {
    const soon = (what: string, phase: number) => () =>
      toast.push({ tone: "info", title: `${what} arrives in Phase ${phase}`, body: "Phase 0 is the foundations and the design system." });
    const cmds: Command[] = [
      ...SITES.map((s) => ({ id: `site-${s}`, label: s, group: "Sites", icon: "globe" as const, hint: "Open site dashboard", run: soon("Site dashboards", 4) })),
      { id: "go-home", label: "Overview", group: "Pages", icon: "home", run: () => router.push("/") },
      ...NAV.flatMap((g) => g.items)
        .filter((i) => i.phase)
        .map((i) => ({ id: `go-${i.key}`, label: i.label, group: "Pages", icon: i.icon, hint: `Phase ${i.phase}`, run: soon(i.label, i.phase!) })),
      { id: "act-run", label: "Start a pipeline run", group: "Actions", icon: "bolt", hint: "Preview", run: () => router.push("/design#pipeline") },
      { id: "act-site", label: "Add a site", group: "Actions", icon: "plus", run: soon("Onboarding", 1) },
      { id: "theme-light", label: "Theme: Light", group: "Preferences", icon: "sun", keywords: "appearance clean room", run: () => setTheme("light") },
      { id: "theme-dark", label: "Theme: Dark", group: "Preferences", icon: "moon", keywords: "appearance control room", run: () => setTheme("dark") },
      { id: "theme-auto", label: "Theme: Auto (match system)", group: "Preferences", icon: "auto", keywords: "appearance system", run: () => setTheme("auto") },
    ];
    if (designEnabled) cmds.splice(SITES.length + 1, 0, { id: "go-design", label: "Design system", group: "Pages", icon: "swatch", run: () => router.push("/design") });
    return cmds;
  }, [router, toast, designEnabled]);

  return (
    <CommandPaletteProvider commands={commands}>
      <Shell designEnabled={designEnabled}>{children}</Shell>
    </CommandPaletteProvider>
  );
}

/** App frame: sidebar navigation (drawer on phones), top bar with ⌘K and the theme control, toasts. */
export function AppShell({ children, designEnabled }: { children: ReactNode; designEnabled: boolean }) {
  return (
    <ToastProvider>
      <CommandsAndShell designEnabled={designEnabled}>{children}</CommandsAndShell>
    </ToastProvider>
  );
}
