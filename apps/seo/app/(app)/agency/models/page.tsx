import type { Metadata } from "next";
import Link from "next/link";
import { ModelChoiceForm } from "@/components/forms/ModelChoiceForm";
import { Icon } from "@/components/Icons";
import { buttonClass } from "@/components/ui/Button";
import { requirePlatformAdmin } from "@/lib/auth/app";
import { webEnv } from "@/lib/config";
import { pool } from "@/lib/db/pool";
import { catalogFor, priceLabel, type CatalogModel } from "@/lib/llm/catalog";
import { chosenModel, loadModelChoice, PURPOSES } from "@/lib/llm/model-settings";
import { setModelsAction } from "../model-actions";

export const metadata: Metadata = { title: "Models" };

const PROVIDER_LABEL = { openrouter: "OpenRouter", anthropic: "Anthropic", fake: "Fake (recorded fixtures)", none: "None configured" } as const;

/** Platform admins choose which model each pipeline step uses (owner request, 10 October 2026). */
export default async function ModelsPage() {
  await requirePlatformAdmin();
  const llm = webEnv().llm;
  const choice = await loadModelChoice(pool());
  let models: CatalogModel[] = [];
  let note: string | null = null;
  let failed: string | null = null;
  try {
    ({ models, note } = await catalogFor(llm.provider, { baseURL: llm.baseURL }));
  } catch (e) {
    failed = `The model list could not be loaded (${e instanceof Error ? e.message.slice(0, 160) : "error"}). Current choices are kept; try again later.`;
  }
  // a saved choice that left the catalog stays visible, so saving does not silently drop it
  const ids = new Set(models.map((m) => m.id));
  const extra = [...new Set(Object.values(choice.models))].filter((id): id is string => !!id && !ids.has(id));
  const options = [...models.map((m) => ({ id: m.id, label: `${m.name} · ${priceLabel(m.price)}` })), ...extra.map((id) => ({ id, label: `${id} (no longer listed)` }))];
  const steps = PURPOSES.map((p) => ({ key: p.key, label: p.label, hint: p.hint, current: choice.models[p.key] ?? "", defaultModel: chosenModel({ models: {}, prices: {} }, p.key, llm.models) }));
  return (
    <div className="page">
      <header className="pg-head">
        <div>
          <p className="eyebrow">
            <b>Lumoras staff</b> · models
          </p>
          <h1>Which model writes</h1>
          <p className="lede">
            Choose the model for each step of the article pipeline. Provider: <strong>{PROVIDER_LABEL[llm.provider]}</strong>. Only models that support tools, structured answers and reasoning are listed, with their list prices. A change applies from the next step of any run, for every workspace, and is recorded in the platform audit log.
          </p>
        </div>
        <Link href="/agency" className={buttonClass("secondary")}>
          <Icon name="back" /> Agency home
        </Link>
      </header>
      <section className="panel pad stack" aria-labelledby="m-h">
        <h2 id="m-h">Models per step</h2>
        {note ? <p className="small muted">{note}</p> : null}
        {failed ? (
          <p className="small" role="alert">
            <Icon name="alert" className="inline-ico" /> {failed}
          </p>
        ) : (
          <ModelChoiceForm action={setModelsAction} steps={steps} options={options} />
        )}
        <p className="small muted">Each workspace&apos;s monthly model budget still caps spending: a dearer model uses it faster. OpenRouter charges are recorded at the cost OpenRouter reports.</p>
      </section>
    </div>
  );
}
