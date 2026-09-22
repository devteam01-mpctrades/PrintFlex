import fs from "node:fs/promises";
import path from "node:path";
import { storageRoot } from "../render/storage.server";

/**
 * Sending mail. PrintFlex does not pick a provider for the merchant; the
 * transport is an interface. The outbox transport writes each message as
 * an .eml file (RFC 5322 with the PDF attached) under storage/outbox, so
 * the pipeline, the send log and resends are real end to end. A provider
 * transport (SMTP or an API) drops in behind the same interface.
 */

export interface OutgoingEmail {
  to: string;
  from: string;
  subject: string;
  text: string;
  attachment: { filename: string; content: Buffer; contentType: string };
}

export interface EmailTransport {
  readonly name: string;
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
}

function fold(base64: string): string {
  return base64.replace(/(.{76})/g, "$1\r\n");
}

export function toEml(email: OutgoingEmail, messageId: string, date: Date): string {
  const boundary = `pf-${messageId.replace(/[^a-z0-9]/gi, "")}`;
  return [
    `From: ${email.from}`,
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    email.text,
    "",
    `--${boundary}`,
    `Content-Type: ${email.attachment.contentType}; name="${email.attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${email.attachment.filename}"`,
    "",
    fold(email.attachment.content.toString("base64")),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export class OutboxTransport implements EmailTransport {
  readonly name = "outbox";
  constructor(private readonly shopId: string) {}

  async send(email: OutgoingEmail): Promise<{ messageId: string }> {
    const now = new Date();
    const messageId = `${now.getTime()}.${Math.random().toString(36).slice(2)}@printflex.local`;
    const dir = path.join(storageRoot(), "outbox", this.shopId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${messageId}.eml`), toEml(email, messageId, now));
    return { messageId };
  }
}

/** The transport for a shop. A provider is chosen by environment once one is configured. */
export function transportFor(shopId: string): EmailTransport {
  return new OutboxTransport(shopId);
}
