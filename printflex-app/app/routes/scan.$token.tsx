import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData } from "react-router";
import { ScanShell } from "../components/scan/ScanShell";
import { SignInForm } from "../components/scan/SignInForm";
import { clientKeyFor, getDeviceSession, signInDevice } from "../lib/scan/devices.server";
import { shopName } from "../lib/scan/scan-request.server";
import { verifyScanToken } from "../lib/scan/tokens.server";

/**
 * /scan/:token — what the printed QR opens. Verifies the token, asks for the
 * store PIN once per device, then shows the order.
 */

const TOKEN_MESSAGES = {
  unknown: "This code is not one PrintFlex recognises. Scan the QR code printed by PrintFlex on the packing slip or invoice.",
  "bad-signature": "This code was printed for a different store or has been tampered with. Print the order again to get a fresh code.",
  expired: "This code has expired. Codes stop working after the period set in PrintFlex settings. Print the order again to get a fresh code.",
  revoked: "This code was revoked from the PrintFlex admin. Print the order again to get a fresh code.",
} as const;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const verified = await verifyScanToken(params.token ?? "");
  if (!verified.ok) {
    return { kind: "invalid" as const, message: TOKEN_MESSAGES[verified.reason] };
  }
  const label = await shopName(verified.shopId);
  const session = await getDeviceSession(request);
  if (!session || session.shopId !== verified.shopId) {
    return { kind: "signin" as const, shopLabel: label, error: null as string | null };
  }
  if (verified.target.kind === "batch") {
    throw redirect(`/scan/batch/${verified.target.jobId}`);
  }
  // A signed-in device lands on the pack screen, the same one every other entry path uses.
  throw redirect(`/scan/order/${verified.target.orderId}`);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const verified = await verifyScanToken(params.token ?? "");
  if (!verified.ok) return redirect(`/scan/${params.token}`);
  const form = await request.formData();
  const result = await signInDevice(
    verified.shopId,
    String(form.get("pin") ?? ""),
    String(form.get("deviceName") ?? ""),
    clientKeyFor(request),
    new Date(),
    String(form.get("staffLabel") ?? "") || null,
  );
  if (!result.ok) {
    const errors = {
      "no-pin": "This store has not set a PIN yet. Ask the store owner to set one under Scan & pack in PrintFlex.",
      throttled: "Too many attempts. Wait 15 minutes and try again.",
      "wrong-pin": "That PIN is not right. Try again.",
      name: "Give this device a name so the store can see who packed what.",
    };
    return { error: errors[result.reason] };
  }
  return redirect(`/scan/${params.token}`, { headers: { "Set-Cookie": result.setCookie } });
};

export default function ScanTokenPage() {
  const data = useLoaderData<typeof loader>();
  const actionError = useActionData<{ error?: string }>()?.error;

  if (data.kind === "invalid") {
    return (
      <ScanShell title="Code not valid">
        <section className="card">
          <h1>This code will not open</h1>
          <p>{data.message}</p>
          <a className="btn secondary" href="/scan">Type an order number instead</a>
        </section>
      </ScanShell>
    );
  }
  if (data.kind === "signin") {
    return (
      <ScanShell title="Sign in">
        <SignInForm shopLabel={data.shopLabel} error={data.error ?? actionError} />
      </ScanShell>
    );
  }
  return null;
}
