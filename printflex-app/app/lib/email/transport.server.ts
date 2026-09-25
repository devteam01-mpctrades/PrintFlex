import { SmtpTransport } from "./smtp-transport.server";
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
  /** Where a customer's reply should land: the merchant, not the app's sending mailbox. */
  replyTo?: string;
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
    ...(email.replyTo ? [`Reply-To: ${email.replyTo}`] : []),
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

/**
 * Every email is sent from the app's own mailbox (PRINTFLEX_EMAIL_FROM, "PrintFlex <team@mpctrades.com>"
 * by default) so the sender is consistent and authenticated; the merchant's address goes in Reply-To.
 */
export const EMAIL_FROM = process.env.PRINTFLEX_EMAIL_FROM?.trim() || "PrintFlex <team@mpctrades.com>";

let smtp: EmailTransport | null = null;

/** The transport for a shop: SMTP when PRINTFLEX_SMTP_URL is set, otherwise the .eml outbox. */
export function transportFor(shopId: string): EmailTransport {
  const url = process.env.PRINTFLEX_SMTP_URL?.trim();
  if (!url) return new OutboxTransport(shopId);
  if (!smtp) smtp = new SmtpTransport(url);
  return smtp;
}
