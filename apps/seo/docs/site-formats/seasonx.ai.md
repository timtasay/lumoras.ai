---
site: seasonx.ai
repo:
  provider: gitea
  host: https://gitea.timdatinh.com
  owner: lumoras
  name: seasonx.ai
  base_branch: dev
  live_branch: main
  promotion: >-
    Post PRs target dev. A post reaches the live site (seasonx.ai) only after dev
    is promoted to main and the VPS rebuilds from main, and its publishedAt date
    has arrived.
format_status:
  state: pending-merge
  pull_request: https://gitea.timdatinh.com/lumoras/seasonx.ai/pulls/1
  pr_branch: content/file-per-post
  pr_base: dev
  note: >-
    PR #1 targets dev (retargeted from main on 10 October 2026, owner's
    request). The one-file-per-post format exists on dev only once PR #1 is
    merged; until then dev keeps post metadata in the POSTS array in
    src/content/posts.ts, a lone .mdx file would be ignored, and the publisher
    refuses to write one (format check: src/content/postFrontmatter.ts on dev).
content_dir: src/content/posts
filename_pattern: "{slug}.mdx"
slug_pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$"
url_pattern: "https://seasonx.ai/insights/{slug}"
encoding: utf-8
line_endings: lf
body_format: mdx
frontmatter:
  delimiter: "---"
  position: first line of the file; nothing before it (no blank line; a BOM is tolerated but don't write one)
  syntax: yaml-1.2 (parsed with the yaml package, core schema, strict, duplicate keys rejected)
  quote_strings: double
  unknown_fields: rejected
  field_order: [slug, title, description, publishedAt, updatedAt, author, readingMinutes, cover]
  fields:
    - name: slug
      type: string
      required: true
      example: "large-party-bookings"
      rules: must equal the file name without .mdx; matches slug_pattern
    - name: title
      type: string
      required: true
      example: "Large party bookings by phone: what to ask, and what not to"
      rules: non-empty; rendered as the page <h1> and the <title>
    - name: description
      type: string
      required: true
      example: "An eight-top is your most valuable booking and the easiest to lose on the phone. The five questions that matter, and why you should not ask for every guest's details."
      rules: one sentence; non-empty; the meta description, card summary, RSS description and JSON-LD description
    - name: publishedAt
      type: string (date, YYYY-MM-DD)
      required: true
      example: "2026-10-01"
      rules: >-
        real calendar date, quoted; a future date hides the post (index, pages,
        sitemap, RSS, highlights.json, llms-full.txt) and 404s its URL until that UTC
        day, and hourly revalidation reveals it without a deploy; no two posts dated
        2026-08-30 or later may share a date (npm test); house cadence is one post
        every two days
    - name: updatedAt
      type: string (date, YYYY-MM-DD)
      required: false
      example: "2026-10-12"
      rules: omit unless the post was meaningfully revised; never write null or ""; no existing post uses it
    - name: author
      type: string (enum)
      required: true
      example: "tran"
      allowed: [tim, tran, alex, jayden]
    - name: readingMinutes
      type: integer
      required: true
      example: 3
      rules: whole number >= 1, unquoted
    - name: cover
      type: mapping
      required: true
      example: { motif: "people", chips: ["Party of 8 · Sat 7:30", "Birthday · high chair"] }
      fields:
        - name: motif
          type: string (enum)
          required: true
          allowed: [calendar, phone, receipt, card, chart, clock, people, list]
        - name: chips
          type: list of string
          required: true
          rules: 1 to 3 items, each non-empty (enforced by the build) and 26 characters or fewer (enforced by npm test)
validation:
  enforced_by: src/content/postFrontmatter.ts (loaded by next.config.ts before compiling, and by npm test)
  on_error: the build fails, naming the file and every bad field
  ci: .gitea/workflows/ci.yml runs npm ci, typecheck, test and build on pushes and PRs to main and dev
---

# seasonx.ai: Insights post format

This is the post format for the Lumoras Growth Git publisher (Gitea provider). The frontmatter
above is the machine-readable spec; the notes below are for whoever maintains the generator.

## Publishing one post

1. Create one file, `src/content/posts/<slug>.mdx`, on a branch from `dev`.
2. Open a PR into `dev`. Don't change any other file: the build reads the post list from these
   files.
3. The post goes live at `https://seasonx.ai/insights/<slug>` once all of these have happened:
   - the PR is merged into `dev`;
   - `dev` is promoted to `main`;
   - the VPS has rebuilt from `main`;
   - the post's `publishedAt` date has arrived.

```mdx
---
slug: "large-party-bookings"
title: "Large party bookings by phone: what to ask, and what not to"
description: "An eight-top is your most valuable booking and the easiest to lose on the phone. The five questions that matter, and why you should not ask for every guest's details."
publishedAt: "2026-10-01"
author: "tran"
readingMinutes: 3
cover:
  motif: "people"
  chips:
    - "Party of 8 · Sat 7:30"
    - "Birthday · high chair"
---

The first paragraph of the post.

## A heading

More prose, with [a link to another post](/insights/restaurant-waitlist).
```

Write the fields in the order shown, with every string double-quoted. Put one blank line after
the closing `---`, and end the file with a newline. All 43 existing posts follow that layout.

## What the generator must avoid in the MDX body

- **A bare `<`.** MDX reads it as the start of a JSX tag, so `<5 minutes` fails the build. Write
  `\<` or `&lt;`.
- **A bare `{` or `}`.** MDX reads `{...}` as a JavaScript expression. Write `\{` and `\}`.
- **HTML comments** (`<!-- ... -->`). MDX does not support them, and the build fails.
- **`import` or `export` lines, JSX components, and raw HTML tags.** No post uses them, and
  `mdx-components.tsx` provides no components. Keep the body to plain Markdown.
- **A second frontmatter block, or anything before the opening `---`.**
- **Absolute links to seasonx.ai.** Use root-relative links such as `/pricing` or
  `/insights/<slug>`.
- **Links to pages, docs or posts that don't exist.**
  - `npm test` fails if a link points at a page or doc that doesn't exist.
  - It also fails if a link points at a post whose `publishedAt` is later than the day this post
    is first read. That day is this post's date, or today if the post is back-dated.
- **A headline in the body.** The page already renders `title` as the `<h1>`. Start with a
  paragraph, and use `##` for section headings.
- **A body with no prose.** A file with nothing after the frontmatter fails the build.

`>` is safe in the body. Inside the frontmatter, braces and angle brackets are safe because the
strings are quoted; escape a double quote inside a value as `\"`.

## Things the format does not decide

- **Cover art** is generated from `cover.motif` and `cover.chips`, so no image is needed.
- **Authors** are fixed in `AUTHORS` in `src/content/posts.ts`. Adding a new author is a code
  change, not a post.
- **Derived outputs come from the frontmatter.** Don't add any of these by hand:
  - the Open Graph image
  - the sitemap entry and `lastModified`
  - the RSS item
  - the `highlights.json` entry
  - the `llms-full.txt` entry
  - the JSON-LD (`BlogPosting`, with the author as a `Person`)
- **Post order** is newest `publishedAt` first. Two posts on the same date fall back to slug order.
