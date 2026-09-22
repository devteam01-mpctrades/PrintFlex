import { redirect } from "react-router";
import prisma from "../../db.server";
import { getDeviceSession, type DeviceSession } from "./devices.server";

/** Device session or a redirect to the scan hub, which explains how to sign in. */
export async function requireDevice(request: Request, shopId?: string): Promise<DeviceSession> {
  const session = await getDeviceSession(request);
  if (!session || (shopId && session.shopId !== shopId)) {
    throw redirect(`/scan?from=${encodeURIComponent(new URL(request.url).pathname)}`);
  }
  return session;
}

export async function shopName(shopId: string): Promise<string> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { domain: true } });
  return shop.domain.replace(".myshopify.com", "");
}
