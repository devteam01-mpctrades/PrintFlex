import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { PackScreen, type PackActionResult } from "../components/scan/PackScreen";
import { ScanShell } from "../components/scan/ScanShell";
import prisma from "../db.server";
import { flagOrder, loadPackSheet, packOrder, recordWrongScan, type FlagLine } from "../lib/pack/pack.server";
import { requireDevice } from "../lib/scan/scan-request.server";
import { unauthenticated } from "../shopify.server";

/** The pack screen. Every entry path (QR, barcode, USB, typed) ends here. */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const session = await requireDevice(request);
  const sheet = await loadPackSheet(session.shopId, params.orderId ?? "");
  return { device: session.name, sheet };
};

const PROBLEMS = new Set(["SHORT_PICK", "DAMAGED", "SUBSTITUTED"]);

export const action = async ({ request, params }: ActionFunctionArgs): Promise<PackActionResult> => {
  const session = await requireDevice(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const orderId = params.orderId ?? "";
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: session.shopId }, select: { domain: true } });
  const clientEventId = String(form.get("clientEventId") ?? "").slice(0, 80);

  if (intent === "wrongScan") {
    await recordWrongScan(session.shopId, orderId, session.name, String(form.get("scanned") ?? ""));
    return { ok: true, message: "" };
  }

  const { admin } = await unauthenticated.admin(shop.domain);

  if (intent === "pack") {
    if (!clientEventId) return { ok: false, message: "This device sent an incomplete request. Reload the page and try again." };
    const weightRaw = String(form.get("weightGrams") ?? "").trim();
    const weight = weightRaw ? Number(weightRaw) : null;
    try {
      const result = await packOrder({
        shopId: session.shopId,
        orderId,
        deviceName: session.name,
        clientEventId,
        itemCount: Number(form.get("itemCount") ?? 0),
        weightGrams: weight !== null && Number.isInteger(weight) && weight > 0 ? weight : null,
        client: admin,
      });
      if (!result.ok) return { ok: false, message: "This order no longer exists in PrintFlex." };
      return { ok: true, outcome: "packed", message: result.already ? "This order was already packed. Nothing was counted twice." : "Packed. The order is tagged in Shopify and ready to ship." };
    } catch (error) {
      console.error("pack failed", error);
      return { ok: false, message: "Shopify could not be updated. Check the connection and tap Mark as packed again; nothing will be counted twice." };
    }
  }

  if (intent === "flag") {
    let lines: FlagLine[] = [];
    try {
      const parsed: unknown = JSON.parse(String(form.get("lines") ?? "[]"));
      if (Array.isArray(parsed)) {
        lines = parsed
          .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
          .filter((l) => typeof l.outcome === "string" && PROBLEMS.has(l.outcome))
          .map((l) => ({
            lineId: String(l.lineId ?? ""),
            title: String(l.title ?? "Item").slice(0, 120),
            outcome: l.outcome as FlagLine["outcome"],
            note: String(l.note ?? "").slice(0, 200),
          }));
      }
    } catch {
      lines = [];
    }
    if (lines.length === 0 || !clientEventId) return { ok: false, message: "Flag at least one line before sending for review." };
    try {
      const result = await flagOrder({ shopId: session.shopId, orderId, deviceName: session.name, clientEventId, lines, client: admin });
      if (!result.ok) return { ok: false, message: "This order no longer exists in PrintFlex." };
      return { ok: true, outcome: "flagged", message: "Sent for review. The order is tagged needs-review and will not ship as packed until someone in the admin resolves it." };
    } catch (error) {
      console.error("flag failed", error);
      return { ok: false, message: "Shopify could not be updated. Check the connection and tap Send for review again." };
    }
  }

  return { ok: false, message: "Unknown action." };
};

export default function ScanOrderPage() {
  const { device, sheet } = useLoaderData<typeof loader>();
  return (
    <ScanShell title="Order" device={device}>
      {sheet ? (
        <PackScreen sheet={sheet} />
      ) : (
        <section className="card">
          <h1>Order not found</h1>
          <p>No order with that number is in PrintFlex for this store. Check the number and try again.</p>
          <a className="btn secondary" href="/scan">Back</a>
        </section>
      )}
    </ScanShell>
  );
}
