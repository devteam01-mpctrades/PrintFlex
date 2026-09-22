import prisma from "../../db.server";
import type { JobState } from "../types";

/**
 * A thin queue. The interface is what the rest of the app depends on; the
 * in-process implementation runs jobs on the server's event loop with a
 * per-shop concurrency cap. Moving the worker to its own process later
 * means replacing `queue` with an implementation that publishes the job id
 * to a broker, and nothing else changes.
 */

export interface JobQueue {
  enqueue(jobId: string): Promise<void>;
  cancel(jobId: string): Promise<boolean>;
}

export type JobRunner = (jobId: string, signal: AbortSignal) => Promise<void>;

const PER_SHOP_CONCURRENCY = Number(process.env.PRINTFLEX_JOBS_PER_SHOP ?? 1);

export class InProcessQueue implements JobQueue {
  private readonly waiting = new Map<string, string[]>(); // shopId -> jobIds
  private readonly running = new Map<string, Set<string>>(); // shopId -> jobIds
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly run: JobRunner) {}

  async enqueue(jobId: string): Promise<void> {
    const job = await prisma.documentJob.findUniqueOrThrow({ where: { id: jobId }, select: { shopId: true } });
    const list = this.waiting.get(job.shopId) ?? [];
    list.push(jobId);
    this.waiting.set(job.shopId, list);
    this.pump(job.shopId);
  }

  async cancel(jobId: string): Promise<boolean> {
    for (const [shopId, list] of this.waiting) {
      const index = list.indexOf(jobId);
      if (index >= 0) {
        list.splice(index, 1);
        this.waiting.set(shopId, list);
        await transition(jobId, "CANCELLED");
        return true;
      }
    }
    const controller = this.controllers.get(jobId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  private pump(shopId: string): void {
    const active = this.running.get(shopId) ?? new Set<string>();
    const list = this.waiting.get(shopId) ?? [];
    while (active.size < PER_SHOP_CONCURRENCY && list.length > 0) {
      const jobId = list.shift() as string;
      active.add(jobId);
      this.running.set(shopId, active);
      const controller = new AbortController();
      this.controllers.set(jobId, controller);
      setImmediate(() => {
        void this.run(jobId, controller.signal)
          .catch((error: unknown) => console.error(`Job ${jobId} crashed`, error))
          .finally(() => {
            active.delete(jobId);
            this.controllers.delete(jobId);
            this.pump(shopId);
          });
      });
    }
  }
}

export async function transition(jobId: string, state: JobState, extra: Record<string, unknown> = {}): Promise<void> {
  const timestamps =
    state === "RUNNING"
      ? { startedAt: new Date() }
      : state === "SUCCEEDED" || state === "FAILED" || state === "CANCELLED"
        ? { finishedAt: new Date() }
        : {};
  await prisma.documentJob.update({ where: { id: jobId }, data: { state, ...timestamps, ...extra } });
}
