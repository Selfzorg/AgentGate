import type { RiskScannerSample, RiskScannerSimulation } from "./api-types";
import { apiBaseUrl } from "./api-config";

export async function getRiskScannerSamples(): Promise<{ samples: RiskScannerSample[] }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/risk-scanner/samples`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load risk scanner samples: ${response.status}`);
  }

  return (await response.json()) as { samples: RiskScannerSample[] };
}

export async function simulateRisk(payload: Record<string, unknown>): Promise<RiskScannerSimulation> {
  const response = await fetch(`${apiBaseUrl}/api/v1/risk-scanner/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as RiskScannerSimulation;
}
