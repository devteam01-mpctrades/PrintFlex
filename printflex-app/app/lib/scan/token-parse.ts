/** Pull a scan token out of a scanned QR URL. Pure, shared by client and server. */
export function tokenFromScan(value: string): string | null {
  const match = /\/scan\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/.exec(value.trim());
  return match ? match[1] : null;
}
