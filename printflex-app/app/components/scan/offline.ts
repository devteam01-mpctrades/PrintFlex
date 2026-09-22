/**
 * Offline tolerance for scan mode, all in the browser.
 *
 * - Sheets: the pack sheet of every order in an opened batch is cached in
 *   localStorage, so the checklist renders with no connection.
 * - Queue: pack and flag events that cannot reach the server are queued
 *   locally and replayed when the network returns. Each event carries a
 *   client id the server treats idempotently, so a replay can never
 *   double-count. The pending count shown to staff is the real queue size.
 */

import type { PackSheet } from "../../lib/pack/pack.server";

const SHEET_PREFIX = "pf:sheet:";
const QUEUE_KEY = "pf:queue";
const API = "/scan/api/pack";

export interface QueuedEvent {
  id: string;
  orderId: string;
  intent: "pack" | "flag";
  fields: Record<string, string>;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function cacheSheet(sheet: PackSheet): void {
  write(`${SHEET_PREFIX}${sheet.order.id}`, { sheet, cachedAt: new Date().toISOString() });
}
export function cachedSheet(orderId: string): { sheet: PackSheet; cachedAt: string } | null {
  return read(`${SHEET_PREFIX}${orderId}`);
}
export function cacheBatch(jobId: string, data: unknown): void {
  write(`pf:batch:${jobId}`, { data, cachedAt: new Date().toISOString() });
}
export function cachedBatch<T>(jobId: string): { data: T; cachedAt: string } | null {
  return read(`pf:batch:${jobId}`);
}

/** Mark a cached sheet with the outcome we applied locally, so it renders as done offline. */
export function markCachedStatus(orderId: string, status: "PACKED" | "NEEDS_REVIEW"): void {
  const entry = cachedSheet(orderId);
  if (!entry) return;
  entry.sheet.order.documentStatus = status;
  write(`${SHEET_PREFIX}${orderId}`, entry);
}

export function queue(): QueuedEvent[] {
  return read<QueuedEvent[]>(QUEUE_KEY) ?? [];
}
function saveQueue(events: QueuedEvent[]): void {
  write(QUEUE_KEY, events);
  window.dispatchEvent(new CustomEvent("pf:queue"));
}
export function enqueue(event: Omit<QueuedEvent, "queuedAt" | "attempts">): void {
  const events = queue().filter((e) => e.id !== event.id);
  events.push({ ...event, queuedAt: new Date().toISOString(), attempts: 0 });
  saveQueue(events);
}
export function pendingFor(orderId: string): QueuedEvent | undefined {
  return queue().find((e) => e.orderId === orderId);
}

export interface ApiResult {
  ok: boolean;
  message: string;
  outcome?: "packed" | "flagged";
  already?: boolean;
}

/** POST one event. Throws on network failure; resolves with the server's answer otherwise. */
export async function postEvent(orderId: string, intent: string, fields: Record<string, string>): Promise<ApiResult> {
  const body = new FormData();
  body.set("orderId", orderId);
  body.set("intent", intent);
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const response = await fetch(API, { method: "POST", body, credentials: "same-origin" });
  if (response.status === 401) return { ok: false, message: "This device is signed out. Scan a sheet to sign in again." };
  return (await response.json()) as ApiResult;
}

let syncing = false;

/** Replay the queue in order. Stops at the first network failure. */
export async function syncQueue(): Promise<void> {
  if (syncing || typeof navigator !== "undefined" && !navigator.onLine) return;
  syncing = true;
  try {
    for (const event of queue()) {
      try {
        const result = await postEvent(event.orderId, event.intent, event.fields);
        // Server answered: whether it applied or rejected the event, it is settled.
        const remaining = queue().filter((e) => e.id !== event.id);
        saveQueue(remaining);
        if (!result.ok) console.warn(`Queued ${event.intent} for ${event.orderId} rejected: ${result.message}`);
      } catch (error) {
        const events = queue().map((e) => (e.id === event.id ? { ...e, attempts: e.attempts + 1, lastError: String(error) } : e));
        saveQueue(events);
        break; // still offline
      }
    }
  } finally {
    syncing = false;
  }
}

/** Start the background sync loop once per page. */
export function startSyncLoop(): () => void {
  const run = () => void syncQueue();
  window.addEventListener("online", run);
  const timer = window.setInterval(run, 15_000);
  run();
  return () => {
    window.removeEventListener("online", run);
    window.clearInterval(timer);
  };
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/scan-sw.js", { scope: "/" }).catch((error: unknown) => console.warn("scan service worker not registered", error));
}
