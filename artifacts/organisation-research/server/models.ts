/**
 * The one research model (plan P1.4, 28 Oct 2026). Every research run makes
 * one analysis with the model named by RESEARCH_MODEL. Until a deployment sets
 * that variable, POWER_MODEL (the former Power tier) is used so an existing
 * deployment keeps working. Model IDs are never guessed or defaulted, and the
 * former Economy and Max tiers, workspace overrides and the editable prompt
 * are retired (stored settings are kept but no longer read).
 */
export type ProviderKind = "gemini" | "anthropic" | "openai";

export const PROVIDER_LABEL: Record<ProviderKind, string> = {
  gemini: "Gemini",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,99}$/;

/** The request format is chosen from the model ID, as in rawModelCall. */
export function providerOf(model: string): ProviderKind {
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("claude")) return "anthropic";
  return "openai";
}

export const RESEARCH_MODEL_VARIABLES = ["RESEARCH_MODEL", "POWER_MODEL"] as const;

export interface ResearchModel {
  model?: string;
  /** The variable the model came from. */
  envVar?: (typeof RESEARCH_MODEL_VARIABLES)[number];
  /** Set when the configured value cannot be used; research is then not ready. */
  problem?: string;
}

export function researchModel(env: NodeJS.ProcessEnv = process.env): ResearchModel {
  for (const envVar of RESEARCH_MODEL_VARIABLES) {
    const model = env[envVar]?.trim();
    if (!model) continue;
    return {
      model,
      envVar,
      problem: MODEL_ID.test(model)
        ? undefined
        : `${envVar} is set to "${model}", which is not a valid model ID.`,
    };
  }
  return {};
}
