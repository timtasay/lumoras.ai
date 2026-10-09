"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BrandMark, Icon } from "./Icons";
import { ThemeControl } from "./ThemeControl";
import { COMPANY_LINKS, NAV_SECTIONS, SIGN_IN_URL } from "@/lib/site";

const OPEN_DELAY = 110;
const CLOSE_DELAY = 220;

/**
 * Company ▾ dropdown: click or hover-intent (fine pointers) to open; Esc,
 * outside click, focus leaving, or a route change close it.
 */
function CompanyMenu({ latest }: { latest: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLLIElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusFirst = useRef(false);
  const hoverOpenedAt = useRef(0);
  const pathname = usePathname();
  const panelId = useId();

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const close = useCallback((returnFocus = false) => {
    clear();
    setOpen(false);
    if (returnFocus) btnRef.current?.focus();
  }, []);

  // Close on route change (render-time state adjustment, no effect needed).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    if (focusFirst.current) {
      focusFirst.current = false;
      panelRef.current?.querySelector<HTMLElement>("a")?.focus();
    }
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => clear, []);

  const finePointer = (e: React.PointerEvent) => e.pointerType === "mouse";

  return (
    <li
      ref={wrapRef}
      className="nav-co"
      onPointerEnter={(e) => {
        if (!finePointer(e)) return;
        clear();
        if (!open)
          timer.current = setTimeout(() => {
            hoverOpenedAt.current = Date.now();
            setOpen(true);
          }, OPEN_DELAY);
      }}
      onPointerLeave={(e) => {
        if (!finePointer(e)) return;
        clear();
        if (open) timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
      }}
      onBlur={(e) => {
        if (open && wrapRef.current && e.relatedTarget && !wrapRef.current.contains(e.relatedTarget as Node)) close();
      }}
    >
      <button
        ref={btnRef}
        type="button"
        className="nav-co-btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(e) => {
          clear();
          // a click that lands just after hover-intent opened the panel keeps it open
          if (open && e.detail > 0 && Date.now() - hoverOpenedAt.current < 700) return;
          // keyboard activation (detail === 0) moves focus into the panel
          if (!open && e.detail === 0) focusFirst.current = true;
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (open) panelRef.current?.querySelector<HTMLElement>("a")?.focus();
            else {
              focusFirst.current = true;
              setOpen(true);
            }
          }
        }}
      >
        Company
        <Icon name="chev" className="chev" />
      </button>
      <div ref={panelRef} id={panelId} className="co-panel" hidden={!open} data-open={open ? "" : undefined}>
        <div className="co-col">
          <p className="co-title">Company</p>
          <ul className="co-links">
            {COMPANY_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => close()} aria-current={pathname === l.href ? "page" : undefined}>
                  <strong>{l.label}</strong>
                  <span>{l.hint}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="co-latest">
          <div className="co-latest-head">
            <p className="co-title">Latest insights</p>
            <Link href="/insights" className="co-all" onClick={() => close()}>
              All insights <Icon name="arrow" />
            </Link>
          </div>
          <div className="co-cards" onClick={(e) => (e.target as HTMLElement).closest("a") && close()}>
            {latest}
          </div>
        </div>
      </div>
    </li>
  );
}

export function SiteNav({ latest }: { latest: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [coOpen, setCoOpen] = useState(false);
  const pathname = usePathname();
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const coListId = useId();

  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (menuOpen) setMenuOpen(false);
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuBtnRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className={`nav${scrolled ? " scrolled" : ""}${menuOpen ? " open" : ""}`}>
      <div className="wrap nav-in">
        <Link className="brand" href="/" aria-label="Lumoras home">
          <BrandMark />
          <span className="brand-t">Lumoras</span>
        </Link>
        <nav className="nav-main" aria-label="Main">
          <ul className="nav-links">
            {NAV_SECTIONS.map((s) => (
              <li key={s.href}>
                <Link href={s.href}>{s.label}</Link>
              </li>
            ))}
            <CompanyMenu latest={latest} />
          </ul>
        </nav>
        <div className="nav-cta">
          <ThemeControl />
          {/* TODO(launch): real sign-in URL */}
          <a className="nav-sign" href={SIGN_IN_URL}>
            Sign in
          </a>
          <Link className="btn btn-primary btn-sm nav-demo" href="/demo" aria-label="Book a demo">
            <span className="l">Book a demo</span>
            <span className="s" aria-hidden="true">Demo</span>
          </Link>
          <button
            ref={menuBtnRef}
            className="menu-btn"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="menuPanel"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Icon name={menuOpen ? "close" : "menu"} />
          </button>
        </div>
      </div>
      <nav className="menu-panel" id="menuPanel" aria-label="Mobile">
        {NAV_SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} onClick={closeMenu}>
            {s.label}
          </Link>
        ))}
        <button
          type="button"
          className="mp-co"
          aria-expanded={coOpen}
          aria-controls={coListId}
          onClick={() => setCoOpen((o) => !o)}
        >
          Company <Icon name="chev" className="chev" />
        </button>
        <ul className="mp-co-list" id={coListId} hidden={!coOpen}>
          {COMPANY_LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} onClick={closeMenu}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <a href={SIGN_IN_URL} onClick={closeMenu}>
          Sign in
        </a>
        <Link className="mp-demo" href="/demo" onClick={closeMenu}>
          Book a demo
        </Link>
      </nav>
    </header>
  );
}
