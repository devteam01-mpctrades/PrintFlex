/**
 * Seed realistic orders on the dev store for testing PrintFlex.
 *
 *   node scripts/seed-orders.ts [--count 200] [--shop my-store.myshopify.com]
 *
 * Runs on Node 22.18+ with built-in TypeScript stripping; no extra tooling.
 * Authenticates with the offline access token the app stored in
 * prisma/dev.sqlite, so open the app in the Shopify admin first so the token
 * is fresh, then run this from the project root.
 *
 * Dev tooling only. Creating products needs write_products, which the dev
 * toml currently grants; the shipped app will not have it.
 */
import { PrismaClient } from "@prisma/client";

const API_VERSION = "2026-07";
const MIN_SKU_PRODUCTS = 30;

interface Args {
  count: number;
  shop: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { count: 200, shop: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--count") args.count = Number(argv[++i]);
    else if (argv[i] === "--shop") args.shop = argv[++i] ?? null;
  }
  if (!Number.isInteger(args.count) || args.count < 1) {
    throw new Error("--count must be a positive integer");
  }
  return args;
}

interface ThrottleStatus {
  currentlyAvailable: number;
  restoreRate: number;
}

interface GraphqlBody<T> {
  data?: T;
  errors?: Array<{ message: string }>;
  extensions?: { cost?: { throttleStatus?: ThrottleStatus } };
}

class Client {
  private throttle: ThrottleStatus | null = null;
  private readonly shop: string;
  private readonly token: string;

  constructor(shop: string, token: string) {
    this.shop = shop;
    this.token = token;
  }

  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    await this.waitForBudget(50);
    const response = await fetch(`https://${this.shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": this.token },
      body: JSON.stringify({ query, variables }),
    });
    if (response.status === 401) {
      throw new Error(
        "Shopify rejected the stored access token. Open the PrintFlex app in the admin once to refresh it, then rerun.",
      );
    }
    const body = (await response.json()) as GraphqlBody<T>;
    this.throttle = body.extensions?.cost?.throttleStatus ?? this.throttle;
    if (body.errors?.length) {
      throw new Error(body.errors.map((e) => e.message).join("; "));
    }
    if (!body.data) throw new Error("GraphQL response had no data");
    return body.data;
  }

  private async waitForBudget(cost: number): Promise<void> {
    if (!this.throttle) return;
    const shortfall = cost - this.throttle.currentlyAvailable;
    if (shortfall <= 0) return;
    const ms = Math.ceil((shortfall / Math.max(1, this.throttle.restoreRate)) * 1000);
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// --- Random helpers -------------------------------------------------------

let seed = 20260922;
function random(): number {
  // Deterministic PRNG so reruns produce comparable data.
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}
function between(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}
function chance(probability: number): boolean {
  return random() < probability;
}

// --- Catalogue ------------------------------------------------------------

interface Variant {
  id: string;
  sku: string | null;
  price: string;
  title: string;
}

const PRODUCT_NAMES = [
  "Ginseng Cream 50ml",
  "Snail Essence",
  "Sheet Mask Pack ×10",
  "Hydrating Serum",
  "Gift Wrap",
  "Green Tea Cleansing Balm",
  "Rice Water Toner 200ml",
  "Centella Soothing Gel",
  "Propolis Ampoule",
  "Vitamin C Brightening Serum 30ml",
  "Overnight Sleeping Mask",
  "Mugwort Essence",
  "Sunscreen SPF50+ PA++++ Lightweight Daily Fluid",
  "Heartleaf Calming Toner Pad (70 pads)",
  "Black Bean Anti-Hair Loss Shampoo 500ml Family Size",
  "Cica Repair Cream for Sensitive and Redness-Prone Skin 80ml",
  "Double Cleanse Duo: Oil Cleanser 200ml + Foaming Wash 150ml Set",
  "Limited Edition Holiday Advent Calendar with 24 Mini Skincare Treats",
  "Lip Sleeping Mask Berry",
  "Hand Cream Trio",
  "Aloe Soothing Gel 300ml",
  "Charcoal Nose Strips ×10",
  "Glass Skin Starter Kit",
  "Bamboo Cotton Pads ×200",
  "Collagen Eye Patches ×60",
  "Peptide Firming Cream",
  "Salicylic Acid Spot Treatment",
  "Retinol Night Serum",
  "Niacinamide 10% + Zinc 1% Serum",
  "Hyaluronic Acid Hydrating Mist",
  "Ceramide Barrier Lotion",
  "Tea Tree Blemish Patch ×72",
];

const PRODUCTS_QUERY = `
  query SeedProducts($after: String) {
    products(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        title
        variants(first: 5) { nodes { id sku price } }
      }
    }
  }
`;

interface ProductsData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      title: string;
      variants: { nodes: Array<{ id: string; sku: string | null; price: string }> };
    }>;
  };
}

async function loadVariants(client: Client): Promise<Variant[]> {
  const variants: Variant[] = [];
  let after: string | null = null;
  do {
    const data: ProductsData = await client.query<ProductsData>(PRODUCTS_QUERY, { after });
    for (const product of data.products.nodes) {
      for (const v of product.variants.nodes) {
        variants.push({ id: v.id, sku: v.sku, price: v.price, title: product.title });
      }
    }
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (after);
  return variants;
}

const PRODUCT_SET_MUTATION = `
  mutation SeedProductSet($input: ProductSetInput!) {
    productSet(synchronous: true, input: $input) {
      product { title variants(first: 1) { nodes { id sku price } } }
      userErrors { field message }
    }
  }
`;

interface ProductSetData {
  productSet: {
    product: { title: string; variants: { nodes: Array<{ id: string; sku: string | null; price: string }> } } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

async function ensureCatalogue(client: Client): Promise<Variant[]> {
  const existing = await loadVariants(client);
  const withSku = existing.filter((v) => v.sku);
  const missing = MIN_SKU_PRODUCTS - withSku.length;
  if (missing <= 0) {
    console.log(`Catalogue: ${withSku.length} variants with SKUs already exist.`);
    return existing;
  }

  console.log(`Catalogue: creating ${missing} products with SKUs…`);
  const existingTitles = new Set(existing.map((v) => v.title));
  const names = PRODUCT_NAMES.filter((n) => !existingTitles.has(n));
  const created: Variant[] = [];
  for (let i = 0; i < missing && i < names.length; i += 1) {
    const title = names[i];
    const sku = `PF-${String(i + 1).padStart(3, "0")}`;
    const price = (between(6, 48) + pick([0, 0.5, 0.9, 0.99])).toFixed(2);
    const data = await client.query<ProductSetData>(PRODUCT_SET_MUTATION, {
      input: {
        title,
        status: "ACTIVE",
        productType: "Skincare",
        vendor: "PrintFlex Seed",
        productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
        variants: [
          {
            optionValues: [{ optionName: "Title", name: "Default Title" }],
            price,
            sku,
            inventoryItem: { tracked: false },
          },
        ],
      },
    });
    if (data.productSet.userErrors.length) {
      throw new Error(`productSet ${title}: ${data.productSet.userErrors.map((e) => e.message).join("; ")}`);
    }
    const variant = data.productSet.product?.variants.nodes[0];
    if (variant) created.push({ id: variant.id, sku: variant.sku, price: variant.price, title });
    process.stdout.write(`\r  created ${created.length}/${missing}`);
  }
  process.stdout.write("\n");
  return [...existing, ...created];
}

// --- Customers ------------------------------------------------------------

interface Locale {
  country: string;
  currency: "USD" | "EUR";
  cities: Array<{ city: string; zip: string; provinceCode?: string }>;
  names: Array<[string, string]>;
  shipping: string[];
}

const LOCALES: Locale[] = [
  {
    country: "US",
    currency: "USD",
    cities: [
      { city: "Austin", zip: "78701", provinceCode: "TX" },
      { city: "Portland", zip: "97201", provinceCode: "OR" },
      { city: "Brooklyn", zip: "11201", provinceCode: "NY" },
    ],
    names: [["John", "Smith"], ["Ava", "Johnson"], ["Marcus", "Lee"], ["Priya", "Patel"]],
    shipping: ["Standard Shipping", "Express Shipping", "USPS Priority"],
  },
  {
    country: "FR",
    currency: "EUR",
    cities: [{ city: "Paris", zip: "75011" }, { city: "Lyon", zip: "69002" }],
    names: [["Marie", "Dupont"], ["Léa", "Martin"], ["Hugo", "Bernard"], ["Chloé", "Petit"]],
    shipping: ["Colissimo", "Chronopost Express", "Mondial Relay"],
  },
  {
    country: "DE",
    currency: "EUR",
    cities: [{ city: "Berlin", zip: "10115" }, { city: "München", zip: "80331" }],
    names: [["Hans", "Weber"], ["Anna", "Schmidt"], ["Lukas", "Müller"]],
    shipping: ["DHL Paket", "DHL Express"],
  },
  {
    country: "JP",
    currency: "USD",
    cities: [{ city: "Tokyo", zip: "150-0001" }, { city: "Osaka", zip: "530-0001" }],
    names: [["Yuki", "Tanaka"], ["Haruto", "Sato"], ["Sakura", "Suzuki"]],
    shipping: ["K-Packet", "EMS"],
  },
  {
    country: "AU",
    currency: "USD",
    cities: [{ city: "Sydney", zip: "2000", provinceCode: "NSW" }, { city: "Melbourne", zip: "3000", provinceCode: "VIC" }],
    names: [["Emma", "Brown"], ["Liam", "Wilson"], ["Olivia", "Taylor"]],
    shipping: ["Australia Post Standard", "Australia Post Express"],
  },
  {
    country: "KH",
    currency: "USD",
    cities: [{ city: "Phnom Penh", zip: "12000" }],
    names: [["Sophea", "Chan"], ["Dara", "Sok"], ["Vuth", "Kim"]],
    shipping: ["Standard Shipping"],
  },
  {
    country: "GB",
    currency: "EUR",
    cities: [{ city: "London", zip: "EC1A 1BB" }, { city: "Manchester", zip: "M1 1AE" }],
    names: [["Oliver", "Evans"], ["Amelia", "Hughes"], ["George", "Walker"]],
    shipping: ["Royal Mail Tracked 48", "DPD Next Day"],
  },
  {
    country: "KR",
    currency: "USD",
    cities: [{ city: "Seoul", zip: "04524" }, { city: "Busan", zip: "48058" }],
    names: [["Min-jun", "Kim"], ["Seo-yeon", "Lee"], ["Ji-woo", "Park"]],
    shipping: ["CJ Logistics", "Standard Shipping"],
  },
];

// --- Orders ---------------------------------------------------------------

const ORDER_CREATE_MUTATION = `
  mutation SeedOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order { id name }
      userErrors { field message }
    }
  }
`;

interface OrderCreateData {
  orderCreate: {
    order: { id: string; name: string } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

const EUR_PER_USD = 0.92;

function money(usd: number, currency: "USD" | "EUR") {
  const shop = usd.toFixed(2);
  const presentment = currency === "EUR" ? (usd * EUR_PER_USD).toFixed(2) : shop;
  return {
    shopMoney: { amount: shop, currencyCode: "USD" },
    presentmentMoney: { amount: presentment, currencyCode: currency },
  };
}

function itemCountTarget(): number {
  // Mostly small parcels, a long tail up to 30 items.
  const r = random();
  if (r < 0.45) return between(1, 2);
  if (r < 0.8) return between(3, 6);
  if (r < 0.95) return between(7, 15);
  return between(16, 30);
}

function buildOrder(index: number, variants: Variant[], useEur: boolean) {
  const locale = pick(LOCALES);
  const currency: "USD" | "EUR" = useEur ? locale.currency : "USD";
  const [firstName, lastName] = pick(locale.names);
  const place = pick(locale.cities);
  const email = `${firstName}.${lastName}.${index}@example.com`.toLowerCase().replace(/[^a-z0-9.@-]/g, "");

  const target = itemCountTarget();
  const lineCount = Math.min(target, between(1, Math.min(8, target)));
  const chosen = new Set<Variant>();
  while (chosen.size < lineCount) chosen.add(pick(variants));
  let remaining = target;
  const lineItems = [...chosen].map((variant, i, all) => {
    const left = all.length - i - 1;
    const quantity = left === 0 ? remaining : between(1, Math.max(1, remaining - left));
    remaining -= quantity;
    return {
      variantId: variant.id,
      quantity,
      priceSet: money(Number(variant.price), currency),
    };
  });

  const fulfilled = chance(0.35);
  const daysAgo = between(0, 28);
  const processedAt = new Date(Date.now() - daysAgo * 86_400_000 - between(0, 86_399) * 1000);
  const tags: string[] = [];
  if (chance(0.2)) tags.push("express");
  if (chance(0.1)) tags.push("b2b");
  if (chance(0.15)) tags.push("gift");

  const address = {
    firstName,
    lastName,
    address1: `${between(1, 250)} ${pick(["Main St", "Rue de Rivoli", "Hauptstraße", "Sakura-dori", "George St"])}`,
    city: place.city,
    zip: place.zip,
    countryCode: locale.country,
    ...(place.provinceCode ? { provinceCode: place.provinceCode } : {}),
  };

  return {
    order: {
      currency: "USD",
      presentmentCurrency: currency,
      email,
      processedAt: processedAt.toISOString(),
      financialStatus: chance(0.9) ? "PAID" : "PENDING",
      ...(fulfilled ? { fulfillmentStatus: "FULFILLED" } : {}),
      tags,
      note: chance(0.15) ? pick(["Please gift wrap", "Leave at the door", "Fragile, thank you"]) : null,
      customer: { toUpsert: { firstName, lastName, email } },
      shippingAddress: address,
      billingAddress: address,
      shippingLines: [
        {
          title: pick(locale.shipping),
          code: "SEED",
          priceSet: money(pick([0, 4.9, 9.9, 14.5]), currency),
        },
      ],
      lineItems,
    },
    options: { inventoryBehaviour: "BYPASS", sendReceipt: false, sendFulfillmentReceipt: false },
    meta: { country: locale.country, currency, items: target, fulfilled },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const session = await prisma.session.findFirst({
    where: { isOnline: false, ...(args.shop ? { shop: args.shop } : {}) },
    orderBy: { expires: "desc" },
  });
  await prisma.$disconnect();
  if (!session) {
    throw new Error(
      "No offline session found in prisma/dev.sqlite. Run `shopify app dev`, open the app in the admin, then rerun.",
    );
  }

  const client = new Client(session.shop, session.accessToken);
  console.log(`Seeding ${args.count} orders on ${session.shop}`);

  const variants = (await ensureCatalogue(client)).filter((v) => v.sku);
  if (variants.length === 0) throw new Error("No variants with SKUs available");

  let eurSupported = true;
  const stats = { created: 0, failed: 0, fulfilled: 0, eur: 0, byCountry: new Map<string, number>(), maxItems: 0 };
  const failures: string[] = [];

  const CONCURRENCY = 4;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < args.count) {
      const index = next++;
      const built = buildOrder(index + 1, variants, eurSupported);
      try {
        const data = await client.query<OrderCreateData>(ORDER_CREATE_MUTATION, {
          order: built.order,
          options: built.options,
        });
        const errors = data.orderCreate.userErrors;
        if (errors.length) {
          const text = errors.map((e) => e.message).join("; ");
          if (eurSupported && built.meta.currency === "EUR" && /currenc/i.test(text)) {
            eurSupported = false;
            console.warn(`\nEUR presentment rejected ("${text}"); falling back to USD for the rest.`);
            next -= 1; // retry this index in USD
            continue;
          }
          throw new Error(text);
        }
        stats.created += 1;
        if (built.meta.fulfilled) stats.fulfilled += 1;
        if (built.meta.currency === "EUR") stats.eur += 1;
        stats.byCountry.set(built.meta.country, (stats.byCountry.get(built.meta.country) ?? 0) + 1);
        stats.maxItems = Math.max(stats.maxItems, built.meta.items);
      } catch (error) {
        stats.failed += 1;
        failures.push(error instanceof Error ? error.message : String(error));
      }
      process.stdout.write(`\r  orders: ${stats.created} created, ${stats.failed} failed`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write("\n");

  console.log(`Done. ${stats.created} orders created, ${stats.failed} failed.`);
  console.log(`  fulfilled: ${stats.fulfilled}, EUR presentment: ${stats.eur}, largest order: ${stats.maxItems} items`);
  console.log(`  by country: ${[...stats.byCountry.entries()].map(([c, n]) => `${c} ${n}`).join(", ")}`);
  if (failures.length) {
    const unique = [...new Set(failures)].slice(0, 5);
    console.log(`  sample failures:\n    ${unique.join("\n    ")}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
