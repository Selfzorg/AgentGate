import type { AiProviderConfig } from "./config";

export type AiProviderRequest = {
  system: string;
  user: string;
  maxOutputTokens?: number | undefined;
};

export type AiProviderResult = {
  content: string;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
};

export interface AiProvider {
  completeJson(request: AiProviderRequest): Promise<AiProviderResult>;
}

export function createAiProvider(config: AiProviderConfig): AiProvider {
  return new OpenAiCompatibleProvider(config);
}

class OpenAiCompatibleProvider implements AiProvider {
  constructor(private readonly config: AiProviderConfig) {}

  async completeJson(request: AiProviderRequest): Promise<AiProviderResult> {
    if (!this.config.apiKey) {
      throw new Error("AI_API_KEY is required when AI_ENABLED=true.");
    }

    const response = await fetch(endpointForProvider(this.config.provider), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user }
        ],
        temperature: 0.1,
        max_tokens: request.maxOutputTokens ?? 700,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      throw new Error(`AI provider request failed with ${response.status}.`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI provider returned an empty response.");

    return {
      content,
      inputTokens: body.usage?.prompt_tokens,
      outputTokens: body.usage?.completion_tokens,
      totalTokens: body.usage?.total_tokens
    };
  }
}

function endpointForProvider(provider: AiProviderConfig["provider"]): string {
  if (provider === "deepseek") return "https://api.deepseek.com/chat/completions";
  return "https://api.openai.com/v1/chat/completions";
}
