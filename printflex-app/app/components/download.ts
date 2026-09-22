/**
 * Inside the embedded admin, App Bridge attaches the session token to
 * same-origin fetches, so a file is fetched and handed to the browser as a
 * download instead of navigated to directly.
 */
export async function downloadFile(url: string, filename: string): Promise<string | null> {
  const response = await fetch(url);
  if (!response.ok) return await response.text();
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename.replace(/[^\w. #-]+/g, "");
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return null;
}
