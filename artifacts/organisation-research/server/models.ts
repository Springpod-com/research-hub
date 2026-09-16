import type {
  ModelSlot,
  ResearchSettings,
  Workspace,
} from "../shared/types.js";

export type ProviderKind = "gemini" | "anthropic" | "openai";
export type Tier = "economy" | "power" | "max";

export interface SlotInfo {
  slot: ModelSlot;
  tier: Tier;
  provider: ProviderKind;
  label: string;
  description: string;
  envVar: string;
}

/** The research tiers and the model positions behind them. */
export const SLOTS: SlotInfo[] = [
  {
    slot: "economy",
    tier: "economy",
    provider: "gemini",
    label: "Economy",
    description: "One Gemini analysis · economical evidence extraction",
    envVar: "ECONOMY_MODEL",
  },
  {
    slot: "power",
    tier: "power",
    provider: "anthropic",
    label: "Power",
    description: "One Claude analysis · research synthesis",
    envVar: "POWER_MODEL",
  },
  {
    slot: "maxClaude",
    tier: "max",
    provider: "anthropic",
    label: "Max · first analysis",
    description: "Claude analysis of the shared captured sources",
    envVar: "MAX_CLAUDE_MODEL",
  },
  {
    slot: "maxOpenai",
    tier: "max",
    provider: "openai",
    label: "Max · second analysis",
    description: "Independent OpenAI analysis of the same sources",
    envVar: "MAX_OPENAI_MODEL",
  },
];

export const PROVIDER_LABEL: Record<ProviderKind, string> = {
  gemini: "Gemini",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

/**
 * Text models listed as available through the Replit AI integrations when this
 * list was checked (16 September 2026). It is a convenience for the picker,
 * not a guarantee: every change is verified with a live request before it is
 * saved, and a deployment using its own provider key may enter any model ID.
 */
export const CATALOGUE: Record<ProviderKind, { id: string; note: string }[]> = {
  gemini: [
    { id: "gemini-3.1-pro-preview", note: "Most capable Gemini" },
    { id: "gemini-3-flash-preview", note: "Fast, economical" },
    { id: "gemini-2.5-pro", note: "Earlier generation" },
    { id: "gemini-2.5-flash", note: "Earlier generation, economical" },
  ],
  anthropic: [
    { id: "claude-opus-5", note: "Most capable Claude" },
    { id: "claude-sonnet-5", note: "Balanced capability and speed" },
    { id: "claude-haiku-4-5", note: "Fastest, most compact" },
    { id: "claude-opus-4-8", note: "Earlier Opus generation" },
    { id: "claude-opus-4-7", note: "Earlier Opus generation" },
    { id: "claude-opus-4-6", note: "Earlier Opus generation" },
    { id: "claude-opus-4-5", note: "Earlier Opus generation" },
    { id: "claude-opus-4-1", note: "Earlier Opus generation" },
    { id: "claude-sonnet-4-6", note: "Earlier Sonnet generation" },
    { id: "claude-sonnet-4-5", note: "Earlier Sonnet generation" },
  ],
  openai: [
    { id: "gpt-6-astra", note: "Most capable OpenAI model" },
    { id: "gpt-5.6-sol", note: "Most powerful of the 5.6 fleet" },
    { id: "gpt-5.6-terra", note: "Best general purpose" },
    { id: "gpt-5.6-luna", note: "Affordable 5.6 model" },
    { id: "gpt-5.4", note: "Highly capable general purpose" },
    { id: "gpt-5.4-mini", note: "Cost-effective small model" },
    { id: "gpt-5.2", note: "Earlier generation" },
    { id: "gpt-5.1", note: "Earlier generation" },
    { id: "gpt-5", note: "Earlier generation" },
    { id: "gpt-5-mini", note: "Cost-effective, high volume" },
    { id: "gpt-5-nano", note: "Fastest and cheapest" },
    { id: "o4-mini", note: "Reasoning model" },
    { id: "o3", note: "Reasoning model, slower" },
  ],
};

/** The request format is chosen from the model ID, as in modelCall. */
export function providerOf(model: string): ProviderKind {
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("claude")) return "anthropic";
  return "openai";
}

export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,99}$/;

export function settingsOf(w: Workspace): ResearchSettings {
  if (!w.settings) w.settings = { models: {} };
  if (!w.settings.models) w.settings.models = {};
  return w.settings;
}

export interface ResolvedModel {
  model?: string;
  source: "workspace" | "environment" | "none";
  /** Set when the configured value cannot be used for this slot; the tier is then not ready. */
  problem?: string;
}

/**
 * A value is usable for a slot only when it is a well-formed model ID whose
 * provider prefix matches the slot; requests are routed by that prefix, so a
 * mismatch would send the call to a provider the slot does not run on.
 */
export function slotProblem(info: SlotInfo, model: string): string | undefined {
  if (!MODEL_ID.test(model))
    return `${info.envVar ? `${info.label} (${info.envVar})` : info.label} is set to "${model}", which is not a valid model ID.`;
  if (providerOf(model) !== info.provider)
    return `${info.label} runs on ${PROVIDER_LABEL[info.provider]}, but its configured model "${model}" would be sent to ${PROVIDER_LABEL[providerOf(model)]}. Choose a ${PROVIDER_LABEL[info.provider]} model under Research connections.`;
  return undefined;
}

/** The workspace override wins; the deployment's environment variable is the default. */
export function resolveModel(w: Workspace, slot: ModelSlot): ResolvedModel {
  const info = SLOTS.find((s) => s.slot === slot)!;
  const override = w.settings?.models?.[slot];
  if (override)
    return {
      model: override,
      source: "workspace",
      problem: slotProblem(info, override),
    };
  const env = process.env[info.envVar]?.trim();
  if (env)
    return {
      model: env,
      source: "environment",
      problem: slotProblem(info, env),
    };
  return { source: "none" };
}

export function resolveModels(w: Workspace): Record<ModelSlot, ResolvedModel> {
  return Object.fromEntries(
    SLOTS.map((s) => [s.slot, resolveModel(w, s.slot)]),
  ) as Record<ModelSlot, ResolvedModel>;
}
