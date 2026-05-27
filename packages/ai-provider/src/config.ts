export type AiProviderName = "openai" | "deepseek" | "mock";

export type AiProviderConfig = {
  enabled: boolean;
  provider: AiProviderName;
  model: string;
  apiKey?: string | undefined;
  maxInputTokens: number;
  dailyBudgetCents: number;
};

const DEFAULT_MAX_INPUT_TOKENS = 4000;
const DEFAULT_DAILY_BUDGET_CENTS = 50;

export function readAiProviderConfig(env: Record<string, string | undefined> = process.env): AiProviderConfig {
  const provider = parseProvider(env.AI_PROVIDER);

  return {
    enabled: env.AI_ENABLED === "true",
    provider,
    model: env.AI_MODEL ?? defaultModelForProvider(provider),
    apiKey: env.AI_API_KEY,
    maxInputTokens: positiveInteger(env.AI_MAX_INPUT_TOKENS, DEFAULT_MAX_INPUT_TOKENS),
    dailyBudgetCents: positiveInteger(env.AI_DAILY_BUDGET_CENTS, DEFAULT_DAILY_BUDGET_CENTS)
  };
}

function parseProvider(value: string | undefined): AiProviderName {
  if (value === "deepseek" || value === "mock") return value;
  return "openai";
}

function defaultModelForProvider(provider: AiProviderName): string {
  if (provider === "deepseek") return "deepseek-chat";
  if (provider === "mock") return "mock-ai";
  return "gpt-4o-mini";
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
