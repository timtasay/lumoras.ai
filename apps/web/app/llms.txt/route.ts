import { getFaq, getGuides, getHelpArticles, getInsights } from "@/lib/content";
import { DEMO_LINE, LEGAL_NAME, PRODUCTS, SITE_URL, absoluteUrl } from "@/lib/site";

export const dynamic = "force-static";

export function GET() {
  const insights = getInsights();
  const guides = getGuides();
  const help = getHelpArticles();
  const faq = getFaq();
  const line = (title: string, path: string, desc?: string) => `- [${title}](${absoluteUrl(path)})${desc ? `: ${desc}` : ""}`;

  const body = [
    "# Lumoras",
    "",
    `> Lumoras (${LEGAL_NAME}) builds sound orchestration for business: an AI receptionist and AI voice agents for every industry, a point of sale (POS) for any service business with voice you can switch on anytime, and custom in-store sound for retail. Product family: Sonorch (salons), SeasonX (restaurants) and KitchenSpot (restaurant discovery).`,
    "",
    `Live AI receptionist demo line: ${DEMO_LINE}. Website: ${SITE_URL}.`,
    "",
    "## Products",
    "",
    "- Lumoras Voice: AI receptionist and voice agents that answer on the first ring, 24/7, book into the live calendar, take orders and deposits, and transfer to staff.",
    "- Lumoras POS: appointments or tickets, payments, staff and commissions, inventory, multi-location reporting.",
    "- Lumoras Sound: zoned in-store music, dayparted playlists, brand audio, automated announcements and voice paging across locations.",
    `- [Sonorch](${PRODUCTS.sonorch.url}): ${PRODUCTS.sonorch.description}`,
    `- [SeasonX](${PRODUCTS.seasonx.url}): ${PRODUCTS.seasonx.description}`,
    `- [KitchenSpot](${PRODUCTS.kitchenspot.url}): ${PRODUCTS.kitchenspot.description}`,
    "",
    "## Pages",
    "",
    line("Home", "/", "AI receptionist, AI voice agents, POS and retail sound"),
    line("About", "/about"),
    line("Insights", "/insights"),
    line("Knowledge base", "/knowledge-base"),
    line("Help center", "/help-center"),
    line("FAQ", "/faq", `${faq.groups.reduce((n, g) => n + g.items.length, 0)} questions and answers`),
    line("Book a demo", "/demo"),
    "",
    "## Knowledge base",
    "",
    ...guides.map((g) => line(g.title, `/knowledge-base/${g.slug}`, g.description)),
    "",
    "## Insights",
    "",
    ...insights.map((i) => line(i.title, `/insights/${i.slug}`, i.description)),
    "",
    "## Help center",
    "",
    ...help.map((h) => line(h.title, `/help-center/${h.slug}`, h.description)),
    "",
  ].join("\n");

  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
