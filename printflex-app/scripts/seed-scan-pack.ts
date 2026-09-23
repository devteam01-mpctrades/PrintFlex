/**
 * Seed a running warehouse into the DEV database so the Scan & pack page
 * can be seen in its running state, and wipe it again.
 *
 *   npx tsx scripts/seed-scan-pack.ts                 # seed
 *   npx tsx scripts/seed-scan-pack.ts --shift today   # force today's shift even if it is early
 *   npx tsx scripts/seed-scan-pack.ts --wipe          # remove everything it seeded, meter rows included
 *
 * Events are spread over a working shift (08:30 to 17:00 in the shop's
 * timezone) with uneven gaps and a lunch lull. By default the most recent
 * shift that has at least two hours behind it is used, which may be
 * yesterday; the script says which day it picked.
 *
 * Needs the app's Shopify credentials in the environment (SHOPIFY_API_KEY,
 * SHOPIFY_API_SECRET, SHOPIFY_APP_URL). Run `npm run env -- pull` once to
 * write them to .env; this script reads .env itself. The dev store must have
 * synced orders (open the Orders page and Sync from Shopify first).
 *
 * Everything goes through the app's own code paths: the PIN is hashed by
 * setStorePin, devices enrol through signInDevice, the batch is rendered by
 * the real job runner (PDFs, meter, printed tags), and every scan event is
 * written by packOrder / flagOrder / recordOpened / recordWrongScan with
 * their idempotency keys. If any of those refuse, the script fails loudly.
 *
 * Dev tooling only. Refuses to run with NODE_ENV=production and is not part
 * of the build.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

if (process.env.NODE_ENV === "production") {
  console.error("seed-scan-pack refuses to run in production.");
  process.exit(1);
}

// Load .env by hand so the script has no dependency on the app's Vite setup.
const envPath = path.resolve(".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}
for (const key of ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET"]) {
  if (!process.env[key]) {
    console.error(`${key} is not set. Run \`npm run env -- pull\` once, or export it, then rerun.`);
    process.exit(1);
  }
}

const MARKER = path.resolve("scripts/.seed-scan-pack.json");
const PIN = "2468";
const DEVICES = [
  { name: "Bench 1", staff: "Sila" },
  { name: "Bench 2", staff: "Dara" },
  { name: "Bench 3", staff: "Vuth" },
];
const BATCH_SIZE = 30;

interface Marker {
  shopId: string;
  domain: string;
  jobId: string;
  orderIds: string[];
  shopifyOrderIds: string[];
  deviceIds: string[];
  pinWasSet: boolean;
  seededAt: string;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

// Deterministic PRNG so reruns produce comparable data.
let rngState = 20260923;
function random(): number {
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 4294967296;
}

async function printUsage(shopId: string, label: string) {
  const { getUsage } = await import("../app/lib/meter.server");
  const usage = await getUsage(shopId);
  console.log(`Meter ${label}: ${usage.used} of ${usage.limit ?? "∞"} used in ${usage.period}`);
}

async function main() {
  const wipe = process.argv.includes("--wipe");
  // Dynamic imports so the NODE_ENV guard above runs before the app modules load.
  const { default: prisma } = await import("../app/db.server");
  const shop = await prisma.shop.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  await printUsage(shop.id, "before");
  if (wipe) await wipeSeed(prisma, shop);
  else await seed(prisma, shop, arg("--shift"));
  await printUsage(shop.id, "after");
  await prisma.$disconnect();
}

/**
 * Shift timestamps in the shop's timezone. Returns `count` instants between
 * 08:30 and the shift end, uneven gaps, thinner over lunch, sorted.
 */
async function shiftTimes(timezone: string, count: number, force: string | null): Promise<{ times: Date[]; day: string }> {
  const { zonedDayStart } = await import("../app/lib/period.server");
  const now = new Date();
  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const window = (day: string) => {
    const start = new Date(zonedDayStart(day, timezone).getTime() + 8.5 * 3_600_000);
    const end = new Date(Math.min(zonedDayStart(day, timezone).getTime() + 17 * 3_600_000, now.getTime() - 10 * 60_000));
    return { start, end };
  };
  let day = force === "yesterday" ? yesterday : today;
  let w = window(day);
  const hours = (w.end.getTime() - w.start.getTime()) / 3_600_000;
  if (force === "today" && hours < 0.5) {
    console.log(`Today's shift in ${timezone} has not started yet (it is before 09:00 there); using yesterday's instead.`);
  }
  if (force !== "yesterday" && (force !== "today" ? hours < 2 : hours < 0.5)) {
    day = yesterday;
    w = window(day);
  }
  const span = w.end.getTime() - w.start.getTime();
  const times: Date[] = [];
  while (times.length < count) {
    const t = new Date(w.start.getTime() + random() * span);
    const localHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(t));
    const localMinute = Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, minute: "2-digit" }).format(t));
    const lunch = localHour === 12 && localMinute >= 15 && localMinute < 55;
    if (lunch && random() < 0.8) continue; // a lull, not a hard stop
    times.push(t);
  }
  times.sort((a, b) => a.getTime() - b.getTime());
  return { times, day };
}

type Prisma = Awaited<typeof import("../app/db.server")>["default"];
type Shop = Awaited<ReturnType<Prisma["shop"]["findFirstOrThrow"]>>;

async function seed(prisma: Prisma, shop: Shop, shiftArg: string | null) {
  if (existsSync(MARKER)) {
    console.error(`Already seeded (${MARKER} exists). Run with --wipe first.`);
    process.exit(1);
  }
  const { setStorePin } = await import("../app/lib/scan/pin.server");
  const { signInDevice } = await import("../app/lib/scan/devices.server");
  const { createDocumentJob } = await import("../app/lib/jobs/create-job.server");
  const { runJob } = await import("../app/lib/jobs/worker.server");
  const { batchLabel } = await import("../app/lib/jobs/batch-label");
  const { packOrder, flagOrder, recordOpened, recordWrongScan } = await import("../app/lib/pack/pack.server");
  const { unauthenticated } = await import("../app/shopify.server");

  const now = new Date();
  const pinWasSet = Boolean(shop.pinHash);
  console.log(`Shop ${shop.domain}`);

  // 1. Store PIN through the real setter (hashes, bumps pinVersion, audits).
  const pin = await setStorePin(shop.id, PIN);
  if (!pin.ok) throw new Error("setStorePin refused the PIN");
  console.log(`PIN set to ${PIN}${pinWasSet ? " (replaced the existing PIN; every device must sign in again)" : ""}`);

  // 2. Three devices enrol exactly like a phone does.
  const deviceIds: string[] = [];
  for (const d of DEVICES) {
    const result = await signInDevice(shop.id, PIN, d.name, `seed-${d.name}`, now, d.staff);
    if (!result.ok) throw new Error(`Device ${d.name} could not sign in: ${result.reason}`);
    deviceIds.push(result.session.deviceId);
  }
  console.log(`Enrolled ${deviceIds.length} devices`);

  // 3. A real printed batch of recent unprinted orders.
  const orders = await prisma.orderIndex.findMany({
    where: { shopId: shop.id, documentStatus: "NEW", cancelledAt: null, fulfillmentStatus: "UNFULFILLED" },
    orderBy: { shopifyCreatedAt: "desc" },
    take: BATCH_SIZE,
    select: { id: true, shopifyOrderId: true, orderName: true, itemCount: true, lineItems: { select: { id: true, title: true }, orderBy: { position: "asc" } } },
  });
  if (orders.length < 10) throw new Error(`Only ${orders.length} unprinted unfulfilled orders are synced; sync orders first.`);
  const job = await createDocumentJob({ shopId: shop.id, documentTypes: ["INVOICE", "PACKING_SLIP"], orderIds: orders.map((o) => o.id), options: { coverSheet: true } });
  console.log(`Rendering ${batchLabel(job)} for ${orders.length} orders through the job runner (this takes a minute)…`);
  await runJob(job.id, new AbortController().signal);
  const finished = await prisma.documentJob.findUniqueOrThrow({ where: { id: job.id } });
  if (finished.state !== "SUCCEEDED") throw new Error(`Batch ended in state ${finished.state}: ${finished.error ?? ""}`);
  console.log(`Batch rendered: ${finished.progress}/${finished.total}, ${finished.outputBytes ?? 0} bytes`);

  // 4. Scan events across a working shift in the shop's timezone.
  const { admin } = await unauthenticated.admin(shop.domain);
  const device = (i: number) => DEVICES[i % DEVICES.length];
  const { times, day } = await shiftTimes(shop.timezone, 25, shiftArg);
  console.log(`Shift: ${day} in ${shop.timezone}, ${times.length} orders opened between ${times[0].toISOString()} and ${times[times.length - 1].toISOString()}`);
  const plan = orders.map((order, i) => {
    const opened = times[i] ?? now;
    const kind = i < 18 ? "packed" : i < 23 ? "in-progress" : i === 23 ? "short-pick" : i === 24 ? "wrong-item" : "not-started";
    return { order, opened, kind, device: device(Math.floor(random() * DEVICES.length) + i) };
  });
  let packed = 0;
  for (const { order, opened, kind, device: d } of plan) {
    if (kind === "not-started") continue;
    await recordOpened(shop.id, order.id, d.name, d.staff, opened);
    if (kind === "packed") {
      // 40 s to 6 min per parcel, skewed short, so the median is a real number.
      const seconds = 40 + Math.floor(Math.pow(random(), 1.6) * 320);
      const done = new Date(opened.getTime() + seconds * 1000);
      const result = await packOrder({ shopId: shop.id, orderId: order.id, deviceName: d.name, staffLabel: d.staff, clientEventId: `seed-pack-${order.id}`, itemCount: order.itemCount, weightGrams: 300 + Math.floor(random() * 900), client: admin, now: done });
      if (!result.ok) throw new Error(`packOrder failed for ${order.orderName}`);
      packed += 1;
    } else if (kind === "short-pick") {
      const line = order.lineItems[order.lineItems.length - 1];
      const result = await flagOrder({ shopId: shop.id, orderId: order.id, deviceName: d.name, staffLabel: d.staff, clientEventId: `seed-flag-${order.id}`, lines: [{ lineId: line.id, title: line.title, outcome: "SHORT_PICK", note: "Only 1 left on shelf" }], client: admin, now: new Date(opened.getTime() + 90_000) });
      if (!result.ok) throw new Error(`flagOrder failed for ${order.orderName}`);
    } else if (kind === "wrong-item") {
      await recordWrongScan(shop.id, order.id, d.name, "8801234567890", new Date(opened.getTime() + 40_000), d.staff);
    }
  }
  // Idempotency check: replaying one pack event must not create a second one.
  const replay = plan.find((p) => p.kind === "packed")!;
  const again = await packOrder({ shopId: shop.id, orderId: replay.order.id, deviceName: replay.device.name, staffLabel: replay.device.staff, clientEventId: `seed-pack-${replay.order.id}`, itemCount: replay.order.itemCount, weightGrams: null, client: admin });
  if (!again.ok || !again.already) throw new Error("Replaying a pack event was not treated as a duplicate.");
  console.log(`Events: ${packed} packed, 5 in progress, 1 short pick, 1 wrong item, ${orders.length - 25} not started. Replay check passed.`);

  const marker: Marker = { shopId: shop.id, domain: shop.domain, jobId: job.id, orderIds: orders.map((o) => o.id), shopifyOrderIds: orders.map((o) => o.shopifyOrderId), deviceIds, pinWasSet, seededAt: now.toISOString() };
  writeFileSync(MARKER, JSON.stringify(marker, null, 2));
  console.log(`Done. Marker written to ${MARKER}. Wipe with: npx tsx scripts/seed-scan-pack.ts --wipe`);
}

async function wipeSeed(prisma: Prisma, shop: Shop) {
  if (!existsSync(MARKER)) {
    console.error(`Nothing to wipe: ${MARKER} does not exist.`);
    process.exit(1);
  }
  const marker = JSON.parse(readFileSync(MARKER, "utf8")) as Marker;
  if (marker.shopId !== shop.id) throw new Error(`Marker is for shop ${marker.domain}, database has ${shop.domain}.`);
  const { removeDocument } = await import("../app/lib/render/storage.server");
  const { parseSettings } = await import("../app/lib/settings.server");
  const { unauthenticated } = await import("../app/shopify.server");
  const { currentPeriod } = await import("../app/lib/period.server");

  // Shopify side: take the seeded tags back off the orders.
  const { tagNames } = parseSettings(shop.settingsJson);
  const { admin } = await unauthenticated.admin(shop.domain);
  const tags = [tagNames.printed, tagNames.packed, tagNames.needsReview];
  for (const gid of marker.shopifyOrderIds) {
    const response = await admin.graphql(`#graphql
      mutation Untag($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`, { variables: { id: gid, tags } });
    const body = (await response.json()) as { data?: { tagsRemove?: { userErrors: Array<{ message: string }> } } };
    const errors = body.data?.tagsRemove?.userErrors ?? [];
    if (errors.length) console.warn(`tagsRemove ${gid}: ${errors.map((e) => e.message).join("; ")}`);
  }
  console.log(`Removed ${tags.join(", ")} from ${marker.shopifyOrderIds.length} orders in Shopify`);

  // Files on disk.
  const documents = await prisma.document.findMany({ where: { jobId: marker.jobId }, select: { filePath: true } });
  for (const d of documents) if (d.filePath) await removeDocument(d.filePath);
  const job = await prisma.documentJob.findUnique({ where: { id: marker.jobId }, select: { outputPath: true, pickListPath: true } });
  for (const p of [job?.outputPath, job?.pickListPath]) if (p) await removeDocument(p);

  // Rows, in dependency order.
  const period = currentPeriod(shop.timezone);
  const [events, tokens, docs, jobs, meter, devices, orders] = await prisma.$transaction([
    prisma.packEvent.deleteMany({ where: { shopId: shop.id, orderId: { in: marker.orderIds } } }),
    prisma.scanToken.deleteMany({ where: { shopId: shop.id, OR: [{ jobId: marker.jobId }, { orderId: { in: marker.orderIds } }] } }),
    prisma.document.deleteMany({ where: { jobId: marker.jobId } }),
    prisma.documentJob.deleteMany({ where: { id: marker.jobId } }),
    prisma.meterEntry.deleteMany({ where: { shopId: shop.id, period, orderId: { in: marker.shopifyOrderIds } } }),
    prisma.scanDevice.deleteMany({ where: { id: { in: marker.deviceIds } } }),
    prisma.orderIndex.updateMany({ where: { id: { in: marker.orderIds } }, data: { documentStatus: "NEW", lastPrintedAt: null, lastPackedAt: null } }),
  ]);
  if (!marker.pinWasSet) {
    await prisma.shop.update({ where: { id: shop.id }, data: { pinHash: null, pinVersion: { increment: 1 } } });
  }
  console.log(`Deleted ${events.count} events, ${tokens.count} scan tokens, ${docs.count} documents, ${jobs.count} job, ${meter.count} meter entries, ${devices.count} devices; reset ${orders.count} orders${marker.pinWasSet ? "" : "; cleared the PIN"}.`);
  console.log("Not undone: the pack metafields packOrder wrote on the Shopify orders, and the audit log entries.");
  unlinkSync(MARKER);
}

main()
  .then(async () => {
    // The job runner keeps a headless Chrome and the retention scheduler alive; exit explicitly.
    const { closeBrowser } = await import("../app/lib/render/pdf.server");
    await closeBrowser().catch(() => undefined);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
