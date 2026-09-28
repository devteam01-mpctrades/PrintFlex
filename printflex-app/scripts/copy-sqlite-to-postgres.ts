/**
 * One-off copy of a PrintFlex SQLite database into the (empty) PostgreSQL
 * database in DATABASE_URL, for moving an environment off SQLite:
 *
 *   node --no-warnings scripts/copy-sqlite-to-postgres.ts /path/to/dev.sqlite
 *
 * Needs Node 24 (node:sqlite) and a PostgreSQL database already migrated with
 * `prisma migrate deploy`. The SQLite file is opened read-only and never
 * changed. Refuses to run if the target already has a shop, so it cannot
 * overwrite live data. Everything is copied in one transaction: all or nothing.
 */
import { DatabaseSync } from "node:sqlite";
import { Prisma, PrismaClient } from "@prisma/client";

type Row = Record<string, unknown>;
type Model = (typeof Prisma.dmmf.datamodel.models)[number];

/** Parents before children, so every foreign key already exists when its row is inserted. */
function insertOrder(models: readonly Model[]): Model[] {
  const byName = new Map(models.map((m) => [m.name, m]));
  const parents = (m: Model) =>
    m.fields.filter((f) => f.kind === "object" && (f.relationFromFields?.length ?? 0) > 0).map((f) => f.type);
  const done = new Set<string>();
  const ordered: Model[] = [];
  const visit = (m: Model, path: string[]) => {
    if (done.has(m.name)) return;
    if (path.includes(m.name)) throw new Error(`Relation cycle: ${[...path, m.name].join(" -> ")}`);
    for (const p of parents(m)) if (p !== m.name) visit(byName.get(p)!, [...path, m.name]);
    done.add(m.name);
    ordered.push(m);
  };
  for (const m of models) visit(m, []);
  return ordered;
}

/** SQLite as Prisma wrote it: DateTime as epoch milliseconds, Boolean as 0/1, Decimal as REAL. */
function convert(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "DateTime":
      return new Date(typeof value === "number" || typeof value === "bigint" ? Number(value) : String(value));
    case "Boolean":
      return value === 1 || value === 1n || value === true || value === "1" || value === "true";
    case "BigInt":
      return BigInt(value as number | bigint | string);
    case "Int":
      return Number(value);
    case "Decimal":
      return new Prisma.Decimal(String(value));
    default:
      return value;
  }
}

function delegate(tx: Prisma.TransactionClient, model: string) {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  return (tx as unknown as Record<string, { createMany(args: { data: Row[] }): Promise<{ count: number }>; count(): Promise<number> }>)[key];
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: node scripts/copy-sqlite-to-postgres.ts /path/to/dev.sqlite");
  if (!process.env.DATABASE_URL?.startsWith("postgres")) throw new Error("DATABASE_URL must point at the PostgreSQL target.");

  const sqlite = new DatabaseSync(file, { readOnly: true });
  const prisma = new PrismaClient();
  try {
    if ((await prisma.shop.count()) > 0) throw new Error("The target database already has a shop. Refusing to copy over live data.");

    const models = insertOrder(Prisma.dmmf.datamodel.models);
    const copied: Array<[string, number, number]> = [];
    await prisma.$transaction(
      async (tx) => {
        for (const model of models) {
          const table = model.dbName ?? model.name;
          const scalars = model.fields.filter((f) => f.kind === "scalar" || f.kind === "enum");
          const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Row[];
          const data = rows.map((row) => Object.fromEntries(scalars.map((f) => [f.name, convert(row[f.dbName ?? f.name], f.type)])));
          for (let i = 0; i < data.length; i += 500) await delegate(tx, model.name).createMany({ data: data.slice(i, i + 500) });
          copied.push([model.name, rows.length, await delegate(tx, model.name).count()]);
        }
      },
      { timeout: 120_000 },
    );

    for (const [name, source, target] of copied) console.log(`${source === target ? "ok " : "MISMATCH"} ${name}: ${source} -> ${target}`);
    if (copied.some(([, source, target]) => source !== target)) process.exitCode = 1;
  } finally {
    sqlite.close();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
