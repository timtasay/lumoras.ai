/**
 * A Git connection's author keys as text: "Name = key", one per line. Names
 * are bylines as configured on the site; keys are what the site's
 * frontmatter expects (sonorch.ai: "tran"). No dependencies, so the
 * connection form can use it in the browser.
 */
export function parseAuthorKeys(text: string): { keys: Record<string, string> } | { error: string } {
  const keys: Record<string, string> = {};
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.{1,120}?)\s*=\s*([A-Za-z0-9._-]{1,60})$/.exec(line);
    if (!m) return { error: `Line ${i + 1}: write it as "Name = key" (the key: letters, digits, '.', '_' or '-').` };
    if (keys[m[1]]) return { error: `Line ${i + 1}: ${m[1]} is listed twice.` };
    keys[m[1]] = m[2];
  }
  if (Object.keys(keys).length > 50) return { error: "At most 50 authors." };
  return { keys };
}

export const formatAuthorKeys = (keys: Record<string, string>) =>
  Object.entries(keys)
    .map(([n, k]) => `${n} = ${k}`)
    .join("\n");
