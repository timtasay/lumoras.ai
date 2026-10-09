/**
 * Line diff for version history (Myers-style LCS on lines, word-level within
 * a changed paragraph is left to the reader). Pure; bounded so a pathological
 * pair of 200 KB bodies cannot stall a request.
 */
export type DiffLine = { op: "same" | "add" | "del"; text: string; a?: number; b?: number };

export function diffLines(before: string, after: string, maxCells = 4_000_000): DiffLine[] {
  const a = before.split("\n"), b = after.split("\n");
  // trim the common head and tail first
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ op: "same", text: a[i], a: i + 1, b: i + 1 });
  const ma = a.slice(start, endA), mb = b.slice(start, endB);
  if ((ma.length + 1) * (mb.length + 1) > maxCells) {
    ma.forEach((t, i) => out.push({ op: "del", text: t, a: start + i + 1 }));
    mb.forEach((t, i) => out.push({ op: "add", text: t, b: start + i + 1 }));
  } else {
    const n = ma.length, m = mb.length;
    const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = ma[i] === mb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (ma[i] === mb[j]) {
        out.push({ op: "same", text: ma[i], a: start + i + 1, b: start + j + 1 });
        i++;
        j++;
      } else if (L[i + 1][j] >= L[i][j + 1]) {
        out.push({ op: "del", text: ma[i], a: start + i + 1 });
        i++;
      } else {
        out.push({ op: "add", text: mb[j], b: start + j + 1 });
        j++;
      }
    }
    for (; i < n; i++) out.push({ op: "del", text: ma[i], a: start + i + 1 });
    for (; j < m; j++) out.push({ op: "add", text: mb[j], b: start + j + 1 });
  }
  for (let k = 0; k < a.length - endA; k++) out.push({ op: "same", text: a[endA + k], a: endA + k + 1, b: endB + k + 1 });
  return out;
}

export function diffStats(lines: DiffLine[]) {
  return { added: lines.filter((l) => l.op === "add").length, removed: lines.filter((l) => l.op === "del").length };
}

/** Changed lines with `context` unchanged lines around them; runs of unchanged lines collapse to a gap marker. */
export function hunks(lines: DiffLine[], context = 2): (DiffLine | { op: "gap"; skipped: number })[] {
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (l.op !== "same") for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep.add(k);
  });
  const out: (DiffLine | { op: "gap"; skipped: number })[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep.has(i)) {
      if (skipped) out.push({ op: "gap", skipped });
      skipped = 0;
      out.push(l);
    } else skipped++;
  });
  if (skipped) out.push({ op: "gap", skipped });
  return out;
}
