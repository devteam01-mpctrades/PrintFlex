import fs from "node:fs/promises";
import path from "node:path";

/**
 * Where generated PDFs live. Local disk for now, keyed by shop so a
 * shop/redact job can remove a whole directory. Swappable for object
 * storage later behind the same three functions.
 */

const ROOT = path.resolve(process.env.PRINTFLEX_STORAGE_DIR ?? "storage");

export function storageRoot(): string {
  return ROOT;
}

export function documentPath(shopId: string, documentId: string): string {
  return path.join(ROOT, "documents", shopId, `${documentId}.pdf`);
}

export async function writeDocument(shopId: string, documentId: string, pdf: Buffer): Promise<string> {
  const file = documentPath(shopId, documentId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, pdf);
  return file;
}

export function jobOutputPath(shopId: string, jobId: string, part: "batch" | "picklist"): string {
  return path.join(ROOT, "jobs", shopId, `${jobId}-${part}.pdf`);
}

export async function writeJobOutput(shopId: string, jobId: string, part: "batch" | "picklist", pdf: Buffer): Promise<string> {
  const file = jobOutputPath(shopId, jobId, part);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, pdf);
  return file;
}

export async function readDocument(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function removeDocument(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true });
}
