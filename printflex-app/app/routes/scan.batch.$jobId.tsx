import { ScanError } from "../components/scan/ScanError";
import type { ClientLoaderFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { cacheBatch, cachedBatch, cacheSheet } from "../components/scan/offline";
import { ScanShell } from "../components/scan/ScanShell";
import { loadBatchProgress, loadPackSheet, type BatchOrderState, type PackSheet } from "../lib/pack/pack.server";
import { requireDevice } from "../lib/scan/scan-request.server";

/**
 * The batch view, opened by scanning the cover sheet. Shows where every
 * order stands and, as a side effect, hands the device every order's pack
 * sheet so the whole batch can be packed with no connection.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const session = await requireDevice(request);
  const progress = await loadBatchProgress(session.shopId, params.jobId ?? "");
  const sheets: PackSheet[] = [];
  if (progress) {
    for (const order of progress.orders) {
      if (order.state === "packed") continue;
      const sheet = await loadPackSheet(session.shopId, order.id);
      if (sheet) sheets.push(sheet);
    }
  }
  return { device: session.name, progress, sheets, offline: false as boolean, cachedAt: null as string | null };
};

export async function clientLoader({ serverLoader, params }: ClientLoaderFunctionArgs) {
  try {
    const data = await serverLoader<typeof loader>();
    for (const sheet of data.sheets) cacheSheet(sheet);
    if (data.progress) cacheBatch(params.jobId ?? "", data.progress);
    window.localStorage.setItem("pf:device", data.device);
    return { ...data, sheets: [] };
  } catch (error) {
    const hit = cachedBatch<Awaited<ReturnType<typeof loader>>["progress"]>(params.jobId ?? "");
    if (!hit) throw error;
    return { device: window.localStorage.getItem("pf:device") ?? "this device", progress: hit.data, sheets: [], offline: true, cachedAt: hit.cachedAt };
  }
}
clientLoader.hydrate = true as const;

const STATE: Record<BatchOrderState, { label: string; cls: string }> = {
  packed: { label: "Packed", cls: "ok" },
  "in-progress": { label: "In progress", cls: "info" },
  "needs-review": { label: "Needs review", cls: "warn" },
  "not-started": { label: "Not started", cls: "" },
};

export default function ScanBatchPage() {
  const { device, progress, offline, cachedAt } = useLoaderData<typeof loader>();
  if (!progress) {
    return (
      <ScanShell title="Batch" device={device}>
        <section className="card"><h1>Batch not found</h1><p>This batch no longer exists.</p><a className="btn secondary" href="/scan">Back</a></section>
      </ScanShell>
    );
  }
  return (
    <ScanShell title="Batch" device={device}>
      {offline && cachedAt ? <p className="notice">No connection. Showing the batch as it was at {new Date(cachedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</p> : null}
      <section className="card">
        <h1>{progress.label}</h1>
        <p className="muted">{progress.total} orders{offline ? "" : " · saved to this device for offline packing"}</p>
        <div className="meta">
          {(Object.keys(STATE) as BatchOrderState[]).map((state) => (
            <div key={state}><div className="l">{STATE[state].label}</div><div className="v num">{progress.counts[state]}</div></div>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>Orders</h2>
        <ul className="list">
          {progress.orders.map((o) => (
            <li key={o.id} className="row" style={{ justifyContent: "space-between" }}>
              <a href={`/scan/order/${o.id}`}>{o.orderName}<span className="muted" style={{ fontWeight: 400, fontSize: 14 }}> · {o.customerName ?? "Guest"} · {o.itemCount} items</span></a>
              <span className={`badge ${STATE[o.state].cls}`} style={{ flex: "0 0 auto" }}>{STATE[o.state].label}</span>
            </li>
          ))}
        </ul>
      </section>
      <a className="btn secondary" href="/scan">Scan an order</a>
    </ScanShell>
  );
}

export function ErrorBoundary() {
  return <ScanError />;
}
