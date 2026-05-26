import type { PrismaClient } from "@prisma/client";

export async function claimQueuedRun(prisma: PrismaClient, runId: string): Promise<boolean> {
  const claimed = await prisma.skillRun.updateMany({
    where: {
      id: runId,
      status: "execution_queued"
    },
    data: {
      status: "executing"
    }
  });

  return claimed.count === 1;
}

export async function findQueuedRunIds(prisma: PrismaClient, limit = 5): Promise<string[]> {
  const candidates = await prisma.skillRun.findMany({
    where: { status: "execution_queued" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true }
  });

  return candidates.map((candidate) => candidate.id);
}
