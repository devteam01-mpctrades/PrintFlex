import type { LoaderFunctionArgs } from "react-router";
import { canExportHistory, historyToCsv, listHistory } from "../lib/pack/history.server";
import { requireShop } from "../lib/request.server";

/** CSV of the last 90 days of scan history. Paid plans only. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  if (!canExportHistory(shop.plan)) {
    throw new Response("CSV export is included on Premium and Unlimited. Upgrade on Plans & billing.", { status: 403 });
  }
  const rows = await listHistory(shop.id, { limit: 100_000, includeOpened: false });
  return new Response(historyToCsv(rows, shop.timezone), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="printflex-scan-history.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
};
