import { launch as launchChrome, type Browser } from "puppeteer";
import type { PaperSize } from "../templates/templates.server";

/**
 * HTML to PDF with a shared headless Chrome. The browser is created lazily,
 * kept for the life of the process and relaunched if it dies. Callers that
 * need to swap this out (tests, the future worker process) depend on the
 * PdfRenderer interface, not on this module.
 */

export interface PdfOptions {
  paperSize: PaperSize;
}

export interface PdfRenderer {
  render(html: string, options: PdfOptions): Promise<Buffer>;
}

declare global {
  // eslint-disable-next-line no-var
  var printflexBrowser: Promise<Browser> | undefined;
}

async function launch(): Promise<Browser> {
  return launchChrome({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  });
}

async function getBrowser(): Promise<Browser> {
  if (!globalThis.printflexBrowser) {
    globalThis.printflexBrowser = launch();
  }
  let browser = await globalThis.printflexBrowser;
  if (!browser.connected) {
    globalThis.printflexBrowser = launch();
    browser = await globalThis.printflexBrowser;
  }
  return browser;
}

export const puppeteerRenderer: PdfRenderer = {
  async render(html, options) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "load" });
      await page.evaluateHandle("document.fonts.ready");
      const pdf = await page.pdf({
        format: options.paperSize === "LETTER" ? "letter" : "a4",
        printBackground: true,
        preferCSSPageSize: true,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  },
};

export async function closeBrowser(): Promise<void> {
  const pending = globalThis.printflexBrowser;
  globalThis.printflexBrowser = undefined;
  if (pending) {
    const browser = await pending.catch(() => null);
    await browser?.close();
  }
}
