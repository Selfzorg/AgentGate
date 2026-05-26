import type { AuditEventInput } from "@agentgate/core-types";

export type AuditEmitter = {
  emit(event: AuditEventInput): Promise<void>;
};

export function createNoopAuditEmitter(): AuditEmitter {
  return {
    async emit(_event) {
      return undefined;
    }
  };
}
