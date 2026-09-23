import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { PackScreen } from "../components/scan/PackScreen";
import { ScanShell } from "../components/scan/ScanShell";
import { loadPackSheet } from "../lib/pack/pack.server";
import { pickPackPreviewOrderId, samplePackSheet } from "../lib/pack/sample-sheet.server";
import { verifyPreviewToken } from "../lib/scan/tokens.server";
import { parseSettings } from "../lib/settings.server";

/**
 * "What the packer sees": the real pack screen, rendered for the merchant
 * inside the admin. Opened with a short-lived signed preview token instead
 * of a device session, and the screen runs in preview mode so nothing is
 * written to Shopify or the index. Same components as staff use, so it
 * cannot drift from the real thing.
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const verified = await verifyPreviewToken(params.token ?? "");
  if (!verified.ok) {
    throw new Response("This preview link has expired. Reload the Scan & pack page to get a fresh one.", { status: 403 });
  }
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: verified.shopId }, select: { settingsJson: true } });
  const orderId = await pickPackPreviewOrderId(verified.shopId);
  const real = orderId ? await loadPackSheet(verified.shopId, orderId) : null;
  return {
    sheet: real ?? samplePackSheet(parseSettings(shop.settingsJson).pack),
    sample: real === null,
  };
};

export default function ScanPreviewPage() {
  const { sheet, sample } = useLoaderData<typeof loader>();
  return (
    <ScanShell title="Preview" device="Preview" preview>
      {sample ? <p className="notice">Sample order. Sync your orders and this preview switches to a real one.</p> : null}
      <PackScreen sheet={sheet} preview />
    </ScanShell>
  );
}
