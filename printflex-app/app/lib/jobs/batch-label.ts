/**
 * Batch names staff say aloud and type into search. Numbered batches read
 * BATCH-0412; batches created before numbering keep the old hex suffix so
 * printed cover sheets still match what the admin shows.
 */
export const BATCH_NUMBER_PADDING = 4;

export function batchLabel(job: { id: string; number: number | null }): string {
  return job.number !== null ? `BATCH-${String(job.number).padStart(BATCH_NUMBER_PADDING, "0")}` : `BATCH-${job.id.slice(-6).toUpperCase()}`;
}
