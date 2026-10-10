# Posts endpoint ("Lumoras Growth serves it")

A site whose publishing connection is **Lumoras Growth serves it** reads its new articles from
Lumoras Growth at request time, so publishing an article needs no commit, merge or deploy. The
site's own post files keep working; articles from the endpoint are added beside them.

Owner decision, 10 October 2026: sonorch.ai and seasonx.ai publish this way.

## Request

```
GET <LUMORAS_GROWTH>/api/feeds/<token>/posts.json
```

- `<token>` is the site's feed token (64 hex characters), shown on the connection in the app. It
  only names the site; the endpoint is read-only and lists only what is already public.
- On VPS3 the site containers and Lumoras Growth share the `lumoras_internal` network, so a site
  can use `http://lumoras-seo:3007/api/feeds/<token>/posts.json` without leaving the server.
- No authentication, no cookies, no query parameters.

## Response

`200`, `Content-Type: application/json; charset=utf-8`, `Cache-Control: public, max-age=300`:

```json
{
  "version": 1,
  "site": "sonorch.ai",
  "generatedAt": "2026-10-14T13:05:00.000Z",
  "posts": [
    {
      "slug": "salon-deposit-policy",
      "title": "How to write a salon deposit policy clients accept",
      "description": "One sentence for the meta description and the card.",
      "publishedAt": "2026-10-14",
      "author": "tran",
      "readingMinutes": 4,
      "cover": { "motif": "card", "chips": ["Deposit · $25", "Refund · 48h notice"] },
      "body": "The first paragraph.\n\n## A heading\n\nMore text with [a link](/pricing)."
    }
  ]
}
```

- `posts` is newest first (by `publishedAt`, then `slug`), at most 500.
- Only articles whose `publishedAt` is **today or earlier in UTC** are listed. A future-dated
  article is never sent.
- `updatedAt` (`YYYY-MM-DD`, never earlier than `publishedAt`) is present only when the article
  was refreshed; otherwise the key is absent (never `null` or `""`).
- `body` is Markdown (CommonMark with GFM tables and lists). It never contains a level-1 heading,
  and it is written as plain Markdown: sites render it **with raw HTML disabled** and never
  compile it as MDX or JSX.
- An article taken down in the app disappears from the list.
- Unknown token, or a site that does not publish through Lumoras Growth: `404 {"error":"not found"}`.

## What Lumoras Growth guarantees before an article is listed

The same rules as the sites' post files (`docs/site-formats/sonorch.ai.md`, `seasonx.ai.md`):

| Field | Rule |
| --- | --- |
| `slug` | `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 120 characters |
| `title`, `description` | non-empty, no leading or trailing whitespace, no line breaks |
| `publishedAt`, `updatedAt` | real calendar dates, `YYYY-MM-DD` |
| `author` | one of the site's author keys (`tim`, `tran`, `alex`, `jayden`) |
| `readingMinutes` | integer, at least 1 |
| `cover.motif` | `calendar`, `phone`, `receipt`, `card`, `chart`, `clock`, `people` or `list` |
| `cover.chips` | 1 to 3 strings, each non-empty and at most 26 characters |

Sites still validate every post with their own schema and **skip** (and log) one that fails,
rather than failing the page.

## What a site must do with it

- Read the URL from a server-side environment variable (`INSIGHTS_API_URL`). Unset: the site
  behaves exactly as before.
- A post file in the repository wins over an endpoint post with the same slug.
- If the endpoint cannot be reached while a page is being regenerated, throw, so Next.js keeps
  serving the last good page. Never treat a failed request as "no posts": that would take posts
  down. During `next build`, a failure only logs a warning and builds with the file posts.
