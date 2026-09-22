import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { renderFallbackForJob, verifyPrintLink } from "../lib/render/fallback.server";
import { unauthenticated } from "../shopify.server";

/**
 * The browser print view. Opens in a new tab from a signed 30-minute link,
 * so it needs no embedded-admin session. Every message here is a sentence
 * about what happened and what to do next.
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const result = await verifyPrintLink(params.token ?? "");
  if (!result.ok) {
    const text =
      result.reason === "expired"
        ? "This print link has expired. Go back to the batch in PrintFlex and click Print from browser again."
        : "This print link is not valid. Go back to the batch in PrintFlex and click Print from browser again.";
    return new Response(text, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: result.shopId }, select: { domain: true } });
  const { admin } = await unauthenticated.admin(shop.domain);
  const html = await renderFallbackForJob(result.jobId, { client: admin });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
};
