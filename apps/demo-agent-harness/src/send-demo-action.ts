import type { NormalizedActionRequest } from "@agentgate/core-types";

export async function sendDemoActionPlaceholder(
  request: NormalizedActionRequest
): Promise<NormalizedActionRequest> {
  return request;
}
