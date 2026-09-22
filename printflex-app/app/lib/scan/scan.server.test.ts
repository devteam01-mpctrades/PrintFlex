import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import { deviceCookie, getDeviceSession, listDevices, revokeDevice, signInDevice } from "./devices.server";
import { lookupOrder, tokenFromScan } from "./lookup.server";
import { setStorePin } from "./pin.server";

async function shop() {
  return prisma.shop.create({ data: { domain: `scan-${Math.random().toString(36).slice(2)}.myshopify.com` } });
}
function requestWith(cookie: string): Request {
  return new Request("https://app.example/scan", { headers: { Cookie: cookie.split(";")[0] } });
}

beforeEach(async () => {
  await prisma.scanDevice.deleteMany();
  await prisma.orderIndex.deleteMany();
  await prisma.shop.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("store PIN and devices", () => {
  it("signs a device in with the PIN, remembers it, and rotation invalidates it", async () => {
    const s = await shop();
    expect(await signInDevice(s.id, "1234", "Bench 1", "ip")).toEqual({ ok: false, reason: "no-pin" });
    expect(await setStorePin(s.id, "12")).toEqual({ ok: false, reason: "format" });
    expect((await setStorePin(s.id, "4821")).ok).toBe(true);

    expect(await signInDevice(s.id, "0000", "Bench 1", "ip")).toEqual({ ok: false, reason: "wrong-pin" });
    expect(await signInDevice(s.id, "4821", "   ", "ip")).toEqual({ ok: false, reason: "name" });
    const signedIn = await signInDevice(s.id, "4821", "Bench 1 · Sila", "ip");
    if (!signedIn.ok) throw new Error("expected sign-in");
    expect(signedIn.setCookie).toMatch(/^pf_device=/);
    expect(signedIn.setCookie).toMatch(/HttpOnly/);

    const session = await getDeviceSession(requestWith(signedIn.setCookie));
    expect(session).toMatchObject({ shopId: s.id, name: "Bench 1 · Sila" });
    expect(await listDevices(s.id)).toHaveLength(1);

    await setStorePin(s.id, "9999");
    expect(await getDeviceSession(requestWith(signedIn.setCookie))).toBeNull();
    expect((await listDevices(s.id))[0].stale).toBe(true);
  });

  it("revokes a single device and throttles brute force", async () => {
    const s = await shop();
    await setStorePin(s.id, "246810");
    const a = await signInDevice(s.id, "246810", "Bench A", "ip-a");
    const b = await signInDevice(s.id, "246810", "Bench B", "ip-b");
    if (!a.ok || !b.ok) throw new Error("expected sign-in");
    expect(await revokeDevice(s.id, a.session.deviceId)).toBe(true);
    expect(await getDeviceSession(requestWith(a.setCookie))).toBeNull();
    expect(await getDeviceSession(requestWith(b.setCookie))).not.toBeNull();

    let last: Awaited<ReturnType<typeof signInDevice>> | null = null;
    for (let i = 0; i < 11; i += 1) last = await signInDevice(s.id, "0000", "Bench X", "attacker");
    expect(last).toEqual({ ok: false, reason: "throttled" });
  });

  it("rejects a forged cookie", async () => {
    const s = await shop();
    await setStorePin(s.id, "1111");
    const real = await signInDevice(s.id, "1111", "Bench", "ip");
    if (!real.ok) throw new Error("expected sign-in");
    const forged = await deviceCookie.serialize(`${real.session.deviceId}.forgedsecret`);
    expect(await getDeviceSession(requestWith(forged))).toBeNull();
    expect(await getDeviceSession(requestWith(await deviceCookie.serialize("garbage")))).toBeNull();
  });
});

describe("lookupOrder", () => {
  it("resolves scanned barcodes, typed numbers and QR URLs", async () => {
    const s = await shop();
    const base = { shopId: s.id, shopifyCreatedAt: new Date(), shopifyUpdatedAt: new Date() };
    const a = await prisma.orderIndex.create({ data: { ...base, shopifyOrderId: "o1", orderName: "#KS-10236" } });
    await prisma.orderIndex.create({ data: { ...base, shopifyOrderId: "o2", orderName: "#KS-10237" } });
    await prisma.orderIndex.create({ data: { ...base, shopifyOrderId: "o3", orderName: "#1236" } });

    expect(await lookupOrder(s.id, "#KS-10236")).toEqual({ kind: "order", orderId: a.id });
    expect(await lookupOrder(s.id, "KS-10236")).toEqual({ kind: "order", orderId: a.id });
    expect(await lookupOrder(s.id, "10236")).toEqual({ kind: "order", orderId: a.id });
    expect((await lookupOrder(s.id, "1236")).kind).toBe("order"); // exact #1236 wins over the suffix match
    expect(await lookupOrder(s.id, "99999")).toEqual({ kind: "none" });
    expect(await lookupOrder(s.id, "https://x.trycloudflare.com/scan/abcdefghijklmnop.qrstuvwxyz012345")).toEqual({
      kind: "url",
      token: "abcdefghijklmnop.qrstuvwxyz012345",
    });
    expect(tokenFromScan("nope")).toBeNull();
    // Another shop cannot see these orders.
    const other = await shop();
    expect(await lookupOrder(other.id, "#KS-10236")).toEqual({ kind: "none" });
  });
});
