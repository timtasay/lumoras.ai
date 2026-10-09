/**
 * A local stand-in for api.dataforseo.com (v3), answering with responses in
 * DataForSEO's documented envelope and item shapes (docs.dataforseo.com,
 * read 9 October 2026). Values are synthetic. Records every request so tests
 * can assert on paths, bodies and the Authorization header. Never reachable
 * from outside the machine (binds 127.0.0.1).
 */
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

export type DfsRequest = { method: string; path: string; auth: string | undefined; body: unknown };

const envelope = (cost: number, result: unknown[], extra: Record<string, unknown> = {}) => ({
  version: "0.1.20260901",
  status_code: 20000,
  status_message: "Ok.",
  time: "0.4 sec.",
  cost,
  tasks_count: 1,
  tasks_error: 0,
  tasks: [{ id: "10091200-1111-0066-0000-abcdef012345", status_code: 20000, status_message: "Ok.", time: "0.3 sec.", cost, result_count: result.length, path: [], data: {}, result, ...extra }],
});

const kwItem = (keyword: string, sv: number, cpc: number, kd: number, intent: string) => ({
  se_type: "google",
  keyword,
  location_code: 2840,
  language_code: "en",
  keyword_info: { se_type: "google", last_updated_time: "2026-09-30 10:00:00 +00:00", competition: 0.41, competition_level: "MEDIUM", cpc, search_volume: sv, monthly_searches: [] },
  keyword_properties: { se_type: "google", core_keyword: null, keyword_difficulty: kd, detected_language: "en" },
  search_intent_info: { se_type: "google", main_intent: intent, foreign_intent: null },
});

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const t = Buffer.concat(chunks).toString("utf8");
  return t ? JSON.parse(t) : null;
}

export async function startFakeDataForSeo() {
  const requests: DfsRequest[] = [];
  let failNext: { status_code: number; message: string; cost: number } | null = null;
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    const path = req.url ?? "/";
    requests.push({ method: req.method ?? "GET", path, auth: req.headers.authorization, body });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.headers.authorization !== `Basic ${Buffer.from("login@example.test:pw-test").toString("base64")}`) {
      return send(401, { status_code: 40100, status_message: "You are not authorized to access this resource.", cost: 0, tasks: [] });
    }
    if (failNext) {
      const f = failNext;
      failNext = null;
      return send(200, { status_code: 20000, status_message: "Ok.", cost: f.cost, tasks: [{ status_code: f.status_code, status_message: f.message, cost: f.cost, result: null }] });
    }
    switch (path) {
      case "/v3/appendix/user_data":
        return send(200, envelope(0, [{ login: "login@example.test", money: { total: 50, balance: 12.345678, limits: {}, statistics: {} }, price: {}, rates: {} }]));
      case "/v3/dataforseo_labs/google/keyword_ideas/live":
        return send(200, envelope(0.01236, [{ se_type: "google", seed_keywords: ["salon pos"], location_code: 2840, language_code: "en", total_count: 3, items_count: 3, items: [kwItem("salon pos", 1900, 12.4, 38, "commercial"), kwItem("Salon POS system", 1300, 15.1, 41, "commercial"), kwItem("salon pos reviews", 210, 9.1, 22, "INVALID")] }]));
      case "/v3/dataforseo_labs/google/keyword_overview/live":
        return send(200, envelope(0.01224, [{ items: [kwItem("salon pos", 1900, 12.4, 38, "commercial"), kwItem("no show policy", 2400, 3.1, 29, "informational")] }]));
      case "/v3/serp/google/organic/live/advanced":
        return send(200, envelope(0.004, [{ keyword: "salon pos", items: [
          { type: "paid", rank_group: 1, rank_absolute: 1, domain: "ads.example", url: "https://ads.example/", title: "Ad" },
          { type: "organic", rank_group: 1, rank_absolute: 2, domain: "sonorch.ai", url: "https://sonorch.ai/pos", title: "Salon POS" },
          { type: "organic", rank_group: 2, rank_absolute: 3, domain: "other.example", url: "https://other.example/x", title: "Other" },
        ] }]));
      case "/v3/dataforseo_labs/google/domain_rank_overview/live":
        return send(200, envelope(0.01212, [{ items: [{ se_type: "google", location_code: 2840, language_code: "en", metrics: { organic: { pos_1: 3, pos_2_3: 5, pos_4_10: 20, etv: 1840.6, count: 612, estimated_paid_traffic_cost: 3120.5 }, paid: {} } }] }]));
      case "/v3/dataforseo_labs/google/ranked_keywords/live":
        return send(200, envelope(0.0124, [{ items: [{ keyword_data: { keyword: "salon pos", keyword_info: { search_volume: 1900 } }, ranked_serp_element: { serp_item: { type: "organic", rank_group: 4, rank_absolute: 5, url: "https://sonorch.ai/pos", etv: 41.2 } } }] }]));
      case "/v3/dataforseo_labs/google/competitors_domain/live":
        return send(200, envelope(0.0126, [{ items: [{ domain: "sonorch.ai", avg_position: 1, intersections: 600 }, { domain: "rival.example", avg_position: 12.4, intersections: 88, full_domain_metrics: { organic: { etv: 5400 } } }] }]));
      case "/v3/backlinks/summary/live":
        return send(200, envelope(0.024036, [{ target: "sonorch.ai", rank: 211, backlinks: 1450, referring_domains: 132, broken_backlinks: 4 }]));
      case "/v3/backlinks/backlinks/live":
        return send(200, envelope(0.024072, [{ items: [{ url_from: "https://dir.example/salons", domain_from: "dir.example", url_to: "https://sonorch.ai/", anchor: "Sonorch", dofollow: true, domain_from_rank: 300, first_seen: "2026-03-01 00:00:00 +00:00", is_lost: false }] }]));
      case "/v3/on_page/task_post":
        return send(200, envelope(0.0015, [], { id: "09201234-1111-0216-0000-onpage000001" }));
      case "/v3/on_page/summary/09201234-1111-0216-0000-onpage000001":
        return send(200, envelope(0, [{ crawl_progress: "finished", crawl_status: { max_crawl_pages: 10, pages_in_queue: 0, pages_crawled: 10 }, page_metrics: { checks: { no_title: 1, title_too_long: 7, no_description: 0 } } }]));
      default:
        return send(404, { status_code: 40400, status_message: "Not Found.", cost: 0, tasks: [] });
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    failNextWith: (f: { status_code: number; message: string; cost: number }) => void (failNext = f),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
