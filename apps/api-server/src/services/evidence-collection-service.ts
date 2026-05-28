import type { PrismaClient } from "@prisma/client";
import { createEvidenceTasksForRun } from "./evidence-task-service";

export type EvidenceCollectionInput = {
  prisma: PrismaClient;
  runId: string;
  checkKeys?: string[] | undefined;
  requestedBy?: string | undefined;
};

export async function collectEvidenceForRun(input: EvidenceCollectionInput) {
  return createEvidenceTasksForRun(input);
}
