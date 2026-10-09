"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "@/components/Icons";

export type Command = {
  id: string;
  label: string;
  group: string;
  hint?: string;
  icon?: IconName;
  keywords?: string;
  run: () => void;
};

const PaletteCtx = createContext<{ open: () => void } | null>(null);

export function useCommandPalette() {
  const ctx = useContext(PaletteCtx);
  if (!ctx) throw new Error("useCommandPalette must be used inside <CommandPaletteProvider>");
  return ctx;
}

/** Subsequence match with a bonus for word starts; null when it does not match. */
export function scoreCommand(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let ti = 0, score = 0, prev = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    if (at === 0 || t[at - 1] === " " || t[at - 1] === "." || t[at - 1] === "-") score += 3;
    if (at === prev + 1) score += 2;
    score += 1;
    prev = at;
    ti = at + 1;
  }
  return score - t.length * 0.01;
}

/**
 * ⌘K / Ctrl+K command palette: jump between sites, pages and actions.
 * Combobox + listbox (aria-activedescendant), arrow keys, Enter, Esc.
 */
export function CommandPaletteProvider({ commands, children }: { commands: Command[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open: () => setOpen(true) }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <PaletteCtx.Provider value={value}>
      {children}
      <Palette open={open} onClose={() => setOpen(false)} commands={commands} />
    </PaletteCtx.Provider>
  );
}

function Palette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  const results = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, s: scoreCommand(q, `${c.label} ${c.group} ${c.keywords ?? ""}`) }))
      .filter((x): x is { c: Command; s: number } => x.s !== null);
    if (q.trim()) scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.c);
  }, [q, commands]);

  // grouped for display; `i` is the position in display order, which arrow keys follow
  const { groups, flat } = useMemo(() => {
    const gs: { group: string; items: { c: Command; i: number }[] }[] = [];
    for (const c of results) {
      let g = gs.find((x) => x.group === c.group);
      if (!g) gs.push((g = { group: c.group, items: [] }));
      g.items.push({ c, i: 0 });
    }
    let n = 0;
    for (const g of gs) for (const it of g.items) it.i = n++;
    return { groups: gs, flat: gs.flatMap((g) => g.items.map((x) => x.c)) };
  }, [results]);
  const current = Math.min(active, Math.max(0, flat.length - 1));

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      delete d.dataset.closing;
      d.showModal();
      inputRef.current?.focus();
    } else if (!open && d.open) {
      d.dataset.closing = "";
      const done = () => {
        delete d.dataset.closing;
        d.close();
        setQ("");
        setActive(0);
      };
      const anims = d.getAnimations();
      if (anims.length) Promise.all(anims.map((a) => a.finished)).then(done, done);
      else done();
    }
  }, [open]);

  useEffect(() => {
    const el = document.getElementById(`${listId}-o-${current}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [current, listId]);

  const runAt = (i: number) => {
    const c = flat[i];
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <dialog
      ref={ref}
      className="modal palette"
      aria-label="Command palette"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pal-in">
        <div className="pal-search">
          <Icon name="search" />
          <input
            ref={inputRef}
            className="pal-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat.length ? `${listId}-o-${current}` : undefined}
            aria-label="Search sites, pages and actions"
            placeholder="Jump to a site, page or action…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setActive((a) => Math.min(flat.length - 1, a + 1));
              else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
              else if (e.key === "Home") setActive(0);
              else if (e.key === "End") setActive(flat.length - 1);
              else if (e.key === "Enter") runAt(current);
              else return;
              e.preventDefault();
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="pal-list" id={listId} role="listbox" aria-label="Results">
          {flat.length === 0 ? (
            <p className="pal-empty">No matches for “{q}”. Try a site name or an action.</p>
          ) : (
            groups.map((g) => (
              <div key={g.group} role="group" aria-labelledby={`${listId}-g-${g.group}`}>
                <p className="pal-group label" id={`${listId}-g-${g.group}`}>
                  {g.group}
                </p>
                {g.items.map(({ c, i }) => {
                  return (
                    <div
                      key={c.id}
                      id={`${listId}-o-${i}`}
                      role="option"
                      aria-selected={i === current}
                      className="pal-opt"
                      onPointerMove={() => i !== current && setActive(i)}
                      onClick={() => runAt(i)}
                    >
                      <span className="pal-ico" aria-hidden="true">
                        <Icon name={c.icon ?? "arrow"} />
                      </span>
                      <span className="pal-label">{c.label}</span>
                      {c.hint ? <span className="pal-hint">{c.hint}</span> : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="pal-foot" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>⌘</kbd>
            <kbd>K</kbd> toggle
          </span>
        </div>
      </div>
    </dialog>
  );
}
