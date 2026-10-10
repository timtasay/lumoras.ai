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
import { Popover } from "@/components/ui/Popover";
import { useToast } from "@/components/ui/Toast";
import { buildNav, PRODUCT_NAME, type NavItem, type ShellWorkspace } from "./nav";
import { can } from "@/lib/auth/permissions";

export type ShellNotification = { id: string; title: string; body: string; href: string | null; read: boolean; at: string; workspace: string };

export type ShellData = {
  user: { name: string; email: string } | null;
  platformAdmin: boolean;
  /** Set while a platform admin is impersonating the signed-in user. */
  impersonation: { adminEmail: string } | null;
  workspaces: ShellWorkspace[];
  notifications: ShellNotification[];
  designEnabled: boolean;
  /** Sample-data mode (the /design route): actions are inert. */
  demo?: boolean;
};

export type ShellActions = {
  signOut?: () => Promise<void>;
  stopImpersonating?: () => Promise<void>;
  markNotificationsRead?: () => Promise<void>;
};

function setTheme(m: ThemeMode) {
  const before = resolveMode((document.documentElement.getAttribute("data-theme") as ThemeMode) || "auto");
  setThemeModeState(m);
  persistThemeMode(m);
  revealThemeChange(resolveMode(m) !== before, null, () => {
    writeThemeAttr(m);
    dispatchThemeChange({ mode: m, resolved: resolveMode(m) });
  });
}

const initials = (s: string) =>
  s
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]!.toUpperCase())
    .join("") || "?";

function isActive(item: NavItem, path: string) {
  if (!item.href) return false;
  return path === item.href || (!!item.prefix && path.startsWith(item.href + "/"));
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

function WorkspaceSwitcher({ data, current }: { data: ShellData; current: ShellWorkspace | null }) {
  const label = current ? current.name : data.platformAdmin ? "Agency" : "No workspace";
  const sub = current ? `${current.sites.length} site${current.sites.length === 1 ? "" : "s"} · ${current.role}` : data.platformAdmin ? "Every workspace" : "Create one to start";
  return (
    <Popover
      label={`Workspace: ${label}. Switch workspace`}
      className="ws-pop"
      buttonClassName="ws-switch"
      button={
        <>
          <span className="ws-mark" aria-hidden="true">
            {label[0]?.toUpperCase()}
          </span>
          <span className="ws-text">
            <strong>{label}</strong>
            <span>{sub}</span>
          </span>
          <Icon name="chev" />
        </>
      }
    >
      {(close) => (
        <div className="menu">
          <p className="label menu-label">Workspaces</p>
          {data.workspaces.length ? (
            data.workspaces.map((w) => (
              <Link key={w.id} href={`/w/${w.slug}`} className="menu-item" aria-current={w.id === current?.id ? "true" : undefined} onClick={close}>
                <span className="ws-mark sm" aria-hidden="true">
                  {w.name[0]?.toUpperCase()}
                </span>
                <span className="menu-text">
                  {w.name}
                  <small>
                    {w.sites.length} site{w.sites.length === 1 ? "" : "s"} · {w.role}
                  </small>
                </span>
                {w.id === current?.id ? <Icon name="check" /> : null}
              </Link>
            ))
          ) : (
            <p className="menu-empty">You are not a member of any workspace yet.</p>
          )}
          <div className="menu-sep" />
          {data.platformAdmin ? (
            <Link href="/agency" className="menu-item" onClick={close}>
              <Icon name="building" />
              <span className="menu-text">Agency home</span>
            </Link>
          ) : null}
          <Link href="/onboarding" className="menu-item" onClick={close}>
            <Icon name="plus" />
            <span className="menu-text">New workspace</span>
          </Link>
        </div>
      )}
    </Popover>
  );
}

function Notifications({ items, onOpen }: { items: ShellNotification[]; onOpen?: () => void }) {
  const unread = items.filter((n) => !n.read).length;
  return (
    <Popover
      label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      align="end"
      className="bell-pop"
      buttonClassName="icon-btn bell"
      onOpen={unread ? onOpen : undefined}
      button={
        <>
          <Icon name="bell" />
          {unread ? (
            <span className="bell-n" aria-hidden="true">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </>
      }
    >
      {(close) => (
        <div className="menu notes">
          <p className="label menu-label">Notifications</p>
          {items.length ? (
            items.map((n) =>
              n.href ? (
                <Link key={n.id} href={n.href} className="note" data-unread={n.read ? undefined : ""} onClick={close}>
                  <span className="note-title">{n.title}</span>
                  {n.body ? <span className="note-body">{n.body}</span> : null}
                  <span className="note-meta mono">
                    {n.workspace} · {n.at}
                  </span>
                </Link>
              ) : (
                <div key={n.id} className="note" data-unread={n.read ? undefined : ""}>
                  <span className="note-title">{n.title}</span>
                  {n.body ? <span className="note-body">{n.body}</span> : null}
                  <span className="note-meta mono">
                    {n.workspace} · {n.at}
                  </span>
                </div>
              ),
            )
          ) : (
            <p className="menu-empty">Nothing new. Crawls and new members show up here.</p>
          )}
        </div>
      )}
    </Popover>
  );
}

function UserMenu({ user, onSignOut }: { user: NonNullable<ShellData["user"]>; onSignOut?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Popover
      label={`Account: ${user.email}`}
      align="end"
      className="user-pop"
      buttonClassName="avatar"
      button={<span aria-hidden="true">{initials(user.name || user.email)}</span>}
    >
      <div className="menu">
        <div className="menu-who">
          <strong>{user.name || user.email}</strong>
          <span>{user.email}</span>
        </div>
        <div className="menu-sep" />
        <button
          type="button"
          className="menu-item"
          disabled={busy || !onSignOut}
          onClick={async () => {
            setBusy(true);
            await onSignOut?.();
          }}
        >
          <Icon name="logout" />
          <span className="menu-text">{busy ? "Signing out…" : "Sign out"}</span>
        </button>
      </div>
    </Popover>
  );
}

function TopBar({ title, onMenu, menuOpen, data, actions }: { title: string; onMenu: () => void; menuOpen: boolean; data: ShellData; actions: ShellActions }) {
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
      {data.user ? <Notifications items={data.notifications} onOpen={actions.markNotificationsRead} /> : null}
      <ThemeControl renderIcon={(n) => <Icon name={n} />} />
      {data.user ? <UserMenu user={data.user} onSignOut={actions.signOut} /> : null}
    </header>
  );
}

function ImpersonationBanner({ data, actions }: { data: ShellData; actions: ShellActions }) {
  const [busy, setBusy] = useState(false);
  if (!data.impersonation || !data.user) return null;
  return (
    <div className="imp-banner" role="status">
      <Icon name="eye" />
      <p>
        <strong>Viewing as {data.user.email}.</strong> You are {data.impersonation.adminEmail}, impersonating. Everything you do is recorded in the
        audit log under both names.
      </p>
      <button
        type="button"
        className="btn btn-sm imp-stop"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await actions.stopImpersonating?.();
        }}
      >
        <span className="btn-label">{busy ? "Stopping…" : "Stop impersonating"}</span>
      </button>
    </div>
  );
}

function Shell({ children, data, actions }: { children: ReactNode; data: ShellData; actions: ShellActions }) {
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

  const slug = /^\/w\/([^/]+)/.exec(pathname)?.[1];
  const current = data.workspaces.find((w) => w.slug === slug) ?? null;
  const nav = buildNav(current, { platformAdmin: data.platformAdmin, designEnabled: data.designEnabled });
  const flat = nav.flatMap((g) => g.items);
  const activeItem = flat.filter((i) => isActive(i, pathname)).sort((a, b) => (b.href?.length ?? 0) - (a.href?.length ?? 0))[0];
  const title = activeItem?.label ?? current?.name ?? PRODUCT_NAME;

  return (
    <div className="app" data-menu={open ? "open" : undefined} data-impersonating={data.impersonation ? "" : undefined}>
      <aside id="side" className="side" aria-label="Sidebar">
        <Link href="/" className="side-brand">
          <BrandMark size={28} />
          <span>
            {PRODUCT_NAME}
            <small>working name</small>
          </span>
        </Link>
        <WorkspaceSwitcher data={data} current={current} />
        <nav className="side-nav" aria-label="Main navigation">
          {nav.map((g) => (
            <div key={g.group} className="side-group">
              <p className="label side-label">{g.group}</p>
              <ul>
                {g.items.map((it) => (
                  <li key={it.key}>
                    <NavLink item={it} active={activeItem?.key === it.key} onNavigate={() => setOpen(false)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <span className="side-env">
            <span className="light-dot" aria-hidden="true" /> Phase 4 · measurement
          </span>
        </div>
      </aside>
      <button type="button" className="side-scrim" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />
      <div className="main-col">
        <ImpersonationBanner data={data} actions={actions} />
        <TopBar title={title} onMenu={() => setOpen((o) => !o)} menuOpen={open} data={data} actions={actions} />
        <main id="main" tabIndex={-1} className="main">
          {children}
        </main>
      </div>
    </div>
  );
}

function CommandsAndShell({ children, data, actions }: { children: ReactNode; data: ShellData; actions: ShellActions }) {
  const router = useRouter();
  const toast = useToast();
  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => (data.demo ? toast.push({ tone: "info", title: "Sample data", body: "The design page does not navigate." }) : router.push(href));
    const cmds: Command[] = [];
    for (const w of data.workspaces) {
      cmds.push({ id: `ws-${w.id}`, label: w.name, group: "Workspaces", icon: "building", hint: `${w.sites.length} sites · ${w.role}`, keywords: w.slug, run: go(`/w/${w.slug}`) });
    }
    for (const w of data.workspaces) {
      for (const s of w.sites) {
        cmds.push({ id: `site-${s.id}`, label: s.domain, group: "Sites", icon: "globe", hint: w.name, keywords: `${s.name} ${w.name}`, run: go(`/w/${w.slug}/sites/${s.id}`) });
      }
    }
    for (const w of data.workspaces) {
      cmds.push({ id: `members-${w.id}`, label: `Members and roles · ${w.name}`, group: "Pages", icon: "users", run: go(`/w/${w.slug}/settings`) });
      cmds.push({ id: `audit-${w.id}`, label: `Audit log · ${w.name}`, group: "Pages", icon: "history", run: go(`/w/${w.slug}/audit`) });
      if (can(w.role, "site:create")) cmds.push({ id: `add-${w.id}`, label: `Add a site to ${w.name}`, group: "Actions", icon: "plus", run: go(`/w/${w.slug}/sites/new`) });
    }
    if (data.platformAdmin) {
      cmds.push({ id: "agency", label: "Agency home", group: "Pages", icon: "building", keywords: "staff all workspaces", run: go("/agency") });
      cmds.push({ id: "platform-audit", label: "Platform audit log", group: "Pages", icon: "shield", run: go("/agency/audit") });
    }
    cmds.push({ id: "new-ws", label: "New workspace", group: "Actions", icon: "plus", keywords: "create client onboarding", run: go("/onboarding") });
    if (data.designEnabled) cmds.push({ id: "go-design", label: "Design system", group: "Pages", icon: "swatch", run: () => router.push("/design") });
    cmds.push(
      { id: "theme-light", label: "Theme: Light", group: "Preferences", icon: "sun", keywords: "appearance clean room", run: () => setTheme("light") },
      { id: "theme-dark", label: "Theme: Dark", group: "Preferences", icon: "moon", keywords: "appearance control room", run: () => setTheme("dark") },
      { id: "theme-auto", label: "Theme: Auto (match system)", group: "Preferences", icon: "auto", keywords: "appearance system", run: () => setTheme("auto") },
    );
    return cmds;
  }, [router, toast, data]);

  return (
    <CommandPaletteProvider commands={commands}>
      <Shell data={data} actions={actions}>
        {children}
      </Shell>
    </CommandPaletteProvider>
  );
}

/** App frame: sidebar (drawer on phones), workspace switcher, top bar with ⌘K, notifications, theme and account. */
export function AppShell({ children, data, actions = {} }: { children: ReactNode; data: ShellData; actions?: ShellActions }) {
  return (
    <CommandsAndShell data={data} actions={actions}>
      {children}
    </CommandsAndShell>
  );
}
