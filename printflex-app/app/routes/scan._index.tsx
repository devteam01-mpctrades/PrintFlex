import { ScanError } from "../components/scan/ScanError";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigate, useSubmit } from "react-router";
import { CameraIcon, ScanIcon } from "../components/scan/icons";
import { CameraScanner } from "../components/scan/CameraScanner";
import { ScanShell } from "../components/scan/ScanShell";
import { getDeviceSession } from "../lib/scan/devices.server";
import { tokenFromScan } from "../lib/scan/token-parse";
import { shopName } from "../lib/scan/scan-request.server";

/**
 * /scan — the hub. Three ways in, one destination:
 *   camera (QR or barcode), USB keyboard-wedge scanner, or a typed number.
 * Without a device session the page explains how to start: scan a PrintFlex
 * QR code, which knows the store and asks for the PIN.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const session = await getDeviceSession(request);
  const ambiguous = (url.searchParams.get("ambiguous") ?? "")
    .split(",")
    .filter(Boolean)
    .map((pair) => {
      const [id, ...name] = pair.split(":");
      return { id, orderName: name.join(":") };
    });
  return {
    session: session ? { device: session.name, shop: await shopName(session.shopId) } : null,
    from: url.searchParams.get("from"),
    notFound: url.searchParams.get("notfound") === "1" ? url.searchParams.get("q") : null,
    ambiguous,
  };
};

export default function ScanHub() {
  const { session, from, notFound, ambiguous } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(false);
  const [value, setValue] = useState("");

  // USB scanners type fast and end with Enter: keep the field focused and submit on Enter.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = useCallback(
    (text: string) => {
      const token = tokenFromScan(text);
      if (token) {
        void navigate(`/scan/${token}`);
        return;
      }
      void submit({ q: text }, { method: "post", action: "/scan/lookup" });
    },
    [navigate, submit],
  );

  if (!session) {
    return (
      <ScanShell title="Not signed in">
        <section className="card hero">
          <div className="icon"><ScanIcon /></div>
          <h1>Scan a sheet to begin</h1>
          <p>Use the QR code PrintFlex prints on every invoice and packing slip.</p>
          {from ? <p className="notice" style={{ textAlign: "left" }}>You were sent here because this device is not signed in{from.startsWith("/scan/order") ? " for that order's store" : ""}.</p> : null}
          <ol className="steps">
            <li>Point your phone camera at the QR code on a sheet</li>
            <li>Enter the store PIN once</li>
            <li>Give this phone a name, then start packing</li>
          </ol>
          <p className="fine">No app to install. No Shopify account needed.</p>
        </section>
      </ScanShell>
    );
  }

  return (
    <ScanShell title="Scan" device={session.device}>
      {notFound ? (
        <p className="notice bad">No order matches “{notFound}”. Check the number, or scan the QR code on the sheet.</p>
      ) : null}
      {ambiguous.length > 0 ? (
        <section className="card">
          <h2>Several orders match</h2>
          <ul className="list">
            {ambiguous.map((o) => (
              <li key={o.id}><a href={`/scan/order/${o.id}`}>{o.orderName}</a></li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card">
        <span className="storechip">{session.shop}</span>
        <h1>Open an order</h1>
        {camera ? (
          <>
            <CameraScanner active={camera} onResult={(text) => { setCamera(false); send(text); }} />
            <button className="btn ghost" type="button" onClick={() => setCamera(false)}>Stop camera</button>
          </>
        ) : (
          <button className="btn" type="button" onClick={() => setCamera(true)}><CameraIcon />Scan with camera</button>
        )}
        <div className="or">or type the order number</div>
        <Form
          method="post"
          action="/scan/lookup"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) send(value);
          }}
        >
          <label htmlFor="q">Order number or scanned code</label>
          <input
            id="q"
            ref={inputRef}
            name="q"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="#1200"
            autoComplete="off"
            autoCapitalize="characters"
            inputMode="text"
            enterKeyHint="go"
          />
          <button className="btn secondary" type="submit" disabled={!value.trim()}>Open order</button>
        </Form>
        <p className="hint">A USB scanner types into this field and presses Enter for you.</p>
      </section>
    </ScanShell>
  );
}

export function ErrorBoundary() {
  return <ScanError />;
}
