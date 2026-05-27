import { z } from "zod";

export const aiRunAnalysisOutputSchema = z.object({
  summary: z.string().min(1).max(1200),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  risk_notes: z.array(z.string().min(1).max(300)).max(8).default([]),
  missing_evidence: z.array(z.string().min(1).max(300)).max(8).default([]),
  suggested_actions: z.array(z.string().min(1).max(300)).max(8).default([]),
  failure_cause: z.string().max(800).nullable().default(null),
  approver_notes: z.string().max(800).nullable().default(null)
});

export type AiRunAnalysisOutput = z.infer<typeof aiRunAnalysisOutputSchema>;

export function parseAiRunAnalysisOutput(raw: string): AiRunAnalysisOutput {
  const parsed = JSON.parse(raw) as unknown;
  return aiRunAnalysisOutputSchema.parse(parsed);
}
