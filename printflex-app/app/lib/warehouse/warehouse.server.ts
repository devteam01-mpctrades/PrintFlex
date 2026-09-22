import prisma from "../../db.server";
import { audit } from "../audit.server";
import { deriveSequences, parseBinCsv, parseBundleCsv } from "./csv.server";

export type WalkingMode = "csv" | "derive";

export async function importBins(shopId: string, csv: string, mode: WalkingMode): Promise<{ imported: number; errors: string[] }> {
  const parsed = parseBinCsv(csv);
  if (parsed.rows.length === 0) return { imported: 0, errors: parsed.errors.length ? parsed.errors : ["The file has no rows. Expected columns: SKU, bin, optional walking sequence."] };
  const rows = mode === "derive" ? deriveSequences(parsed.rows.map((r) => ({ ...r, sequence: null }))) : parsed.rows;
  await prisma.$transaction([
    prisma.binMap.deleteMany({ where: { shopId } }),
    prisma.binMap.createMany({ data: rows.map((r) => ({ shopId, sku: r.sku, bin: r.bin, sequence: r.sequence })) }),
  ]);
  await audit(shopId, "merchant", "warehouse.bins_imported", null, { rows: rows.length, mode });
  return { imported: rows.length, errors: parsed.errors };
}

export async function clearBins(shopId: string): Promise<number> {
  const result = await prisma.binMap.deleteMany({ where: { shopId } });
  await audit(shopId, "merchant", "warehouse.bins_cleared");
  return result.count;
}

export async function importBundles(shopId: string, csv: string): Promise<{ imported: number; errors: string[] }> {
  const parsed = parseBundleCsv(csv);
  if (parsed.rows.length === 0) return { imported: 0, errors: parsed.errors.length ? parsed.errors : ["The file has no rows. Expected columns: bundle SKU, component SKU, quantity, optional component title."] };
  await prisma.$transaction([
    prisma.bundleMap.deleteMany({ where: { shopId } }),
    prisma.bundleMap.createMany({ data: parsed.rows.map((r) => ({ shopId, ...r })) }),
  ]);
  await audit(shopId, "merchant", "warehouse.bundles_imported", null, { rows: parsed.rows.length });
  return { imported: parsed.rows.length, errors: parsed.errors };
}

export async function clearBundles(shopId: string): Promise<number> {
  const result = await prisma.bundleMap.deleteMany({ where: { shopId } });
  await audit(shopId, "merchant", "warehouse.bundles_cleared");
  return result.count;
}

export async function warehouseSummary(shopId: string) {
  const [bins, bundles, withSequence] = await Promise.all([
    prisma.binMap.count({ where: { shopId } }),
    prisma.bundleMap.groupBy({ by: ["bundleSku"], where: { shopId } }),
    prisma.binMap.count({ where: { shopId, sequence: { not: null } } }),
  ]);
  return { bins, bundles: bundles.length, withSequence };
}
