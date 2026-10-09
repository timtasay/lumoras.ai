"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icons";

export type Column<T> = {
  key: string;
  header: string;
  /** Numbers right-align with tabular numerals. */
  numeric?: boolean;
  sortValue?: (row: T) => number | string;
  render: (row: T) => ReactNode;
  /** Hidden below 640px to keep phones readable. */
  hideOnPhone?: boolean;
};

/**
 * Data table: real <table> semantics, sortable headers (aria-sort), sticky
 * header, tabular numerals. Scrolls inside its own frame on narrow screens so
 * the page never scrolls sideways.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  initialSort,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  initialSort?: { key: string; dir: "asc" | "desc" };
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    return [...rows].sort((a, b) => {
      const x = sv(a), y = sv(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.dir === "asc" ? c : -c;
    });
  }, [rows, columns, sort]);

  return (
    <div className="tbl-frame" role="region" aria-label={caption} tabIndex={0}>
      <table className="tbl">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const ariaSort = active ? (sort!.dir === "asc" ? "ascending" : "descending") : c.sortValue ? "none" : undefined;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={[c.numeric ? "n" : "", c.hideOnPhone ? "hide-phone" : ""].join(" ").trim() || undefined}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      className="th-sort"
                      data-active={active ? "" : undefined}
                      onClick={() =>
                        setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.numeric ? "desc" : "asc" }))
                      }
                    >
                      {c.header}
                      <Icon name={active ? (sort!.dir === "asc" ? "up" : "down") : "sort"} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c, i) =>
                i === 0 ? (
                  <th key={c.key} scope="row" className={c.numeric ? "n" : undefined}>
                    {c.render(r)}
                  </th>
                ) : (
                  <td key={c.key} className={[c.numeric ? "n" : "", c.hideOnPhone ? "hide-phone" : ""].join(" ").trim() || undefined}>
                    {c.render(r)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
