---
site: sonorch.ai
repo:
  provider: gitea
  host: https://gitea.timdatinh.com
  owner: lumoras
  name: sonorch.ai
  base_branch: main
format_status:
  state: pending-merge
  pull_request: https://gitea.timdatinh.com/lumoras/sonorch.ai/pulls/1
  pr_branch: content/file-per-post
  note: >-
    The one-file-per-post format exists on main only after PR #1 is merged.
    Until then, main still keeps post metadata in the POSTS array in
    src/content/posts.ts, and a lone .mdx file would not be published.
content_dir: src/content/posts
filename_pattern: "{slug}.mdx"
slug_pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$"
url_pattern: "https://sonorch.ai/insights/{slug}"
encoding: utf-8
line_endings: lf
body_format: mdx
frontmatter:
  delimiter: "---"
  position: first line of the file; nothing before it (no blank line, no BOM)
  syntax: yaml-1.2
  quote_strings: double
  unknown_fields: rejected
  fields:
    - name: slug
      type: string
      required: true
      example: "walk-ins-and-appointments"
      rules: must equal the file name without .mdx; matches slug_pattern
    - name: title
      type: string
      required: true
      example: "Taking walk-ins without wrecking the appointment book"
      rules: non-empty; no leading or trailing whitespace
    - name: description
      type: string
      required: true
      example: "Walk-ins fill a slow Tuesday and wreck a busy Saturday. How to fit them into the gaps, and when to say no."
      rules: one sentence; non-empty; no leading or trailing whitespace; used as the meta description and the card summary
    - name: publishedAt
      type: string (date, YYYY-MM-DD)
      required: true
      example: "2026-10-07"
      rules: >-
        real calendar date, quoted; a future date hides the post until that UTC day
        (the site revalidates hourly, so no deploy is needed); no two posts dated
        2026-08-30 or later may share a date; the house cadence is one post every two days
    - name: updatedAt
      type: string (date, YYYY-MM-DD)
      required: false
      example: "2026-10-09"
      rules: omit unless the post was meaningfully revised; must be >= publishedAt; never write null or ""
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
      example: { motif: "calendar", chips: ["Walk-in · 20 min wait", "3:00 PM · booked"] }
      fields:
        - name: motif
          type: string (enum)
          required: true
          allowed: [calendar, phone, receipt, card, chart, clock, people, list]
        - name: chips
          type: list of string
          required: true
          rules: 1 to 3 items; each non-empty and 26 characters or fewer (enforced by npm test)
validation:
  enforced_by: src/lib/post-files.ts (run by scripts/generate-posts.ts before dev, build, typecheck and test)
  on_error: the build fails, naming the file and the field
  ci: .gitea/workflows/ci.yml runs npm ci, typecheck, test and build on PRs to main and dev
---

# sonorch.ai: Insights post format

This is the post format for the Lumoras Growth Git publisher (Gitea provider). The frontmatter
above is the machine-readable spec; the notes below are for whoever maintains the generator.

## Publishing one post

Create one file, `src/content/posts/<slug>.mdx`, on a branch from `main`, and open a PR into `main`.
Don't change any other file: the site compiles its post list from these files at build time.
The post is live at `https://sonorch.ai/insights/<slug>` once the PR is merged, deployed and its
`publishedAt` date has arrived.

```mdx
---
slug: "walk-ins-and-appointments"
title: "Taking walk-ins without wrecking the appointment book"
description: "Walk-ins fill a slow Tuesday and wreck a busy Saturday. How to fit them into the gaps, and when to say no."
publishedAt: "2026-10-07"
author: "tran"
readingMinutes: 3
cover:
  motif: "calendar"
  chips:
    - "Walk-in · 20 min wait"
    - "3:00 PM · booked"
---

The first paragraph of the post.

## A heading

More prose, with [a link to another page](/pricing).
```

Write the fields in the order shown, put one blank line after the closing `---`, and end the file
with a newline. Every existing post follows that layout.

## What the generator must avoid in the MDX body

- **A bare `<`.** MDX reads it as the start of a JSX tag. `<5 minutes` or `<b` fails the build.
  Write `\<` or `&lt;`.
- **A bare `{` or `}`.** MDX reads `{...}` as a JavaScript expression. It either fails the build or
  renders wrongly, because `{name}` becomes an undefined variable. Write `\{` and `\}`, or `&#123;`
  and `&#125;`.
- **HTML comments** (`<!-- ... -->`). These fail the build.
- **`import` or `export` lines, JSX components, and raw HTML tags.** No post uses them, so the body
  stays plain Markdown.
- **A second frontmatter block, or anything before the opening `---`.**
- **Absolute links to sonorch.ai.** Use root-relative links such as `/pricing` or
  `/insights/<slug>`.
- **Links to pages or posts that don't exist.** `npm test` fails if a link points at a page that
  doesn't exist, or at a post whose `publishedAt` is later than this post's (the check also
  allows for today, for back-dated posts).
- **A headline in the body.** The page already renders `title` as the `<h1>`. Start with a
  paragraph, and use `##` for section headings.

`>` is safe in the body. Inside the frontmatter, braces and angle brackets are safe because the
strings are quoted; escape a double quote inside a value as `\"`.

## Things the format does not decide

- Cover art is generated from `cover.motif` and `cover.chips`, so no image is needed.
- Authors are fixed in `src/content/post-schema.ts`. Adding a new author is a code change, not a post.
- The Open Graph image, sitemap entry, RSS item, `llms-full.txt` entry and JSON-LD are all derived
  from the frontmatter. Don't add them by hand.
