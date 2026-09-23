import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { flagOrder, packOrder, recordOpened, recordWrongScan, type FlagLine } from "../lib/pack/pack.server";
import { getDeviceSession } from "../lib/scan/devices.server";
import { unauthenticated } from "../shopify.server";

/**
 * JSON endpoint behind the pack screen and the offline replay. Every call
 * is idempotent on the server, so replaying a queued event is safe.
 */

const PROBLEMS = new Set(["SHORT_PICK", "DAMAGED", "SUBSTITUTED"]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const session = await getDeviceSession(request);
  if (!session) return json({ ok: false, message: "This device is signed out. Scan a sheet to sign in again." }, 401);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const orderId = String(form.get("orderId") ?? "");
  const clientEventId = String(form.get("clientEventId") ?? "").slice(0, 80);

  if (intent === "opened") {
    await recordOpened(session.shopId, orderId, session.name, session.staffLabel);
    return json({ ok: true, message: "" });
  }
  if (intent === "wrongScan") {
    await recordWrongScan(session.shopId, orderId, session.name, String(form.get("scanned") ?? ""), new Date(), session.staffLabel);
    return json({ ok: true, message: "" });
  }

  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: session.shopId }, select: { domain: true } });
  const { admin } = await unauthenticated.admin(shop.domain);

  if (intent === "pack") {
    if (!clientEventId) return json({ ok: false, message: "This device sent an incomplete request. Reload the page and try again." });
    const weightRaw = String(form.get("weightGrams") ?? "").trim();
    const weight = weightRaw ? Number(weightRaw) : null;
    try {
      const result = await packOrder({
        shopId: session.shopId, orderId, deviceName: session.name, staffLabel: session.staffLabel, clientEventId,
        itemCount: Number(form.get("itemCount") ?? 0),
        weightGrams: weight !== null && Number.isInteger(weight) && weight > 0 ? weight : null,
        client: admin,
      });
      if (!result.ok) return json({ ok: false, message: "This order no longer exists in PrintFlex." });
      return json({ ok: true, outcome: "packed", already: result.already, message: result.already ? "This order was already packed. Nothing was counted twice." : "Packed. The order is tagged in Shopify and ready to ship." });
    } catch (error) {
      console.error("pack failed", error);
      return json({ ok: false, message: "Shopify could not be updated. It will be retried automatically; nothing will be counted twice." }, 502);
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
          .map((l) => ({ lineId: String(l.lineId ?? ""), title: String(l.title ?? "Item").slice(0, 120), outcome: l.outcome as FlagLine["outcome"], note: String(l.note ?? "").slice(0, 200) }));
      }
    } catch {
      lines = [];
    }
    if (lines.length === 0 || !clientEventId) return json({ ok: false, message: "Flag at least one line before sending for review." });
    try {
      const result = await flagOrder({ shopId: session.shopId, orderId, deviceName: session.name, staffLabel: session.staffLabel, clientEventId, lines, client: admin });
      if (!result.ok) return json({ ok: false, message: "This order no longer exists in PrintFlex." });
      return json({ ok: true, outcome: "flagged", already: result.already, message: "Sent for review. The order is tagged needs-review and will not ship as packed until someone in the admin resolves it." });
    } catch (error) {
      console.error("flag failed", error);
      return json({ ok: false, message: "Shopify could not be updated. It will be retried automatically." }, 502);
    }
  }
  return json({ ok: false, message: "Unknown action." }, 400);
};

export const loader = async () => json({ ok: false, message: "POST only." }, 405);
