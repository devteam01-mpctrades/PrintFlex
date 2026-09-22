import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { puppeteerRenderer } from "../lib/render/pdf.server";
import { ensureDocumentFile } from "../lib/render/render-order.server";
import { readDocument } from "../lib/render/storage.server";
import { requireShop } from "../lib/request.server";

/**
 * Streams a generated PDF to the merchant. Only documents of their own shop.
 * A document produced inside a combined batch PDF gets its own file rendered
 * the first time it is requested.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop, admin } = await requireShop(request);
  const existing = await prisma.document.findFirst({ where: { id: params.id, shopId: shop.id }, select: { id: true } });
  if (!existing) {
    throw new Response("This document does not exist or was removed. Print the order again to regenerate it.", {
      status: 404,
    });
  }
  const ensured = await ensureDocumentFile(existing.id, { client: admin, pdf: puppeteerRenderer });
  const document = await prisma.document.findUniqueOrThrow({
    where: { id: ensured.id },
    include: { order: { select: { orderName: true } } },
  });
  if (!document.filePath) throw new Response("The PDF could not be produced. Try again.", { status: 500 });
  const pdf = await readDocument(document.filePath);
  if (!pdf) {
    throw new Response("The PDF file for this document is gone. Print the order again to regenerate it.", {
      status: 410,
    });
  }
  const safeName = `${document.documentType.toLowerCase()}-${document.order.orderName.replace(/[^A-Za-z0-9-]+/g, "")}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
};
