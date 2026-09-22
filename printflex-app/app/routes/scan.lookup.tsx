import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { lookupOrder } from "../lib/scan/lookup.server";
import { requireDevice } from "../lib/scan/scan-request.server";

/** Where the USB scanner, the camera and the keyboard all send what they read. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const session = await requireDevice(request);
  const form = await request.formData();
  const raw = String(form.get("q") ?? "");
  const result = await lookupOrder(session.shopId, raw);
  switch (result.kind) {
    case "url":
      return redirect(`/scan/${result.token}`);
    case "order":
      return redirect(`/scan/order/${result.orderId}`);
    case "ambiguous":
      return redirect(`/scan?q=${encodeURIComponent(raw)}&ambiguous=${encodeURIComponent(result.candidates.map((c) => `${c.id}:${c.orderName}`).join(","))}`);
    default:
      return redirect(`/scan?q=${encodeURIComponent(raw)}&notfound=1`);
  }
};

export const loader = async () => redirect("/scan");
