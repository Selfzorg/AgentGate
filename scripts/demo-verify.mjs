#!/usr/bin/env node

const apiBaseUrl = normalizeBaseUrl(process.env.AGENTGATE_API_BASE_URL ?? "http://localhost:4000");
const webBaseUrl = normalizeBaseUrl(`http://localhost:${process.env.WEB_PORT ?? "3001"}`);

await verifyJson(`${apiBaseUrl}/health`, (body) => body?.ok === true, "API health");
await verifyJson(
  `${apiBaseUrl}/api/v1/skills`,
  (body) => Array.isArray(body?.skills) && body.skills.length > 0,
  "seeded skills API"
);
await verifyJson(
  `${apiBaseUrl}/api/v1/policies`,
  (body) => Array.isArray(body?.policies) && body.policies.length > 0,
  "seeded policies API"
);
await verifyJson(
  `${apiBaseUrl}/api/v1/evidence-monitor`,
  (body) =>
    Array.isArray(body?.workers) &&
    body.workers.some((worker) => ["online", "idle", "busy"].includes(worker?.effective_status)),
  "evidence worker heartbeat"
);
await verifyHtml(webBaseUrl, "dashboard");

console.log(`AgentGate demo is ready: dashboard ${webBaseUrl}, API ${apiBaseUrl}`);

async function verifyJson(url, predicate, label) {
  let lastError;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await retryFetch(url);
      if (!response.ok) {
        throw new Error(`${label} returned HTTP ${response.status}`);
      }

      const body = await response.json();
      if (predicate(body)) {
        console.log(`Verified ${label}`);
        return;
      }

      lastError = new Error(`${label} returned an unexpected response`);
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw lastError;
}

async function verifyHtml(url, label) {
  const response = await retryFetch(url);
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }

  const text = await response.text();
  if (!text.includes("AgentGate")) {
    throw new Error(`${label} did not render AgentGate content`);
  }

  console.log(`Verified ${label}`);
}

async function retryFetch(url) {
  let lastError;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await globalThis.fetch(url);
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }

  throw new Error(`Could not reach ${url}: ${lastError?.message ?? "unknown error"}`);
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
