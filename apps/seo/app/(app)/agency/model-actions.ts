"use server";
/**
 * Agency → Models: a platform admin chooses the model for each pipeline step.
 * Only models from the configured provider's catalog are accepted, and the
 * write goes through platform_set_llm_models() (admin only, audited).
 */
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth/app";
import { toActionError, type ActionState } from "@/lib/actions";
import { webEnv } from "@/lib/config";
import { pool } from "@/lib/db/pool";
import { withActor } from "@/lib/db/tenant";
import { catalogFor } from "@/lib/llm/catalog";
import { PURPOSES, type ModelChoice } from "@/lib/llm/model-settings";

export async function setModelsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await requirePlatformAdmin();
    const llm = webEnv().llm;
    const { models } = await catalogFor(llm.provider, { baseURL: llm.baseURL });
    const byId = new Map(models.map((m) => [m.id, m]));
    const choice: ModelChoice = { models: {}, prices: {} };
    const fieldErrors: Record<string, string> = {};
    for (const { key, label } of PURPOSES) {
      const id = String(fd.get(key) ?? "").trim();
      if (!id) continue;
      const m = byId.get(id);
      if (!m) {
        fieldErrors[key] = `${label}: "${id.slice(0, 80)}" is not in the provider's current list of models that support tools, structured answers and reasoning.`;
        continue;
      }
      choice.models[key] = m.id;
      choice.prices[m.id] = m.price;
    }
    if (Object.keys(fieldErrors).length) return { ok: false, error: "Some choices are not available.", fieldErrors, at: Date.now() };
    await withActor(pool(), { actorId: v.user.id, requestId: v.requestId }, (tx) => tx.exec("SELECT platform_set_llm_models($1::jsonb)", [JSON.stringify(choice)]));
    revalidatePath("/agency/models");
    const n = Object.keys(choice.models).length;
    return { ok: true, message: n ? `Saved. ${n} step${n === 1 ? "" : "s"} use${n === 1 ? "s" : ""} a chosen model from the next run step on; the rest use the defaults.` : "Saved. Every step uses the default models.", at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}
