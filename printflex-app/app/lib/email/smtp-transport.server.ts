import nodemailer, { type Transporter } from "nodemailer";
import type { EmailTransport, OutgoingEmail } from "./transport.server";

/**
 * Real sending over SMTP, configured by one URL (PRINTFLEX_SMTP_URL), for
 * example smtps://user%40example.com:app-password@smtp.gmail.com:465.
 * One pooled connection per process; nodemailer handles MIME and encoding.
 */

/** Pure: the nodemailer message for an outgoing email, kept separate so it can be tested without a server. */
export function toMailOptions(email: OutgoingEmail) {
  return {
    from: email.from,
    to: email.to,
    ...(email.replyTo ? { replyTo: email.replyTo } : {}),
    subject: email.subject,
    text: email.text,
    attachments: [{ filename: email.attachment.filename, content: email.attachment.content, contentType: email.attachment.contentType }],
  };
}

export class SmtpTransport implements EmailTransport {
  readonly name = "smtp";
  private readonly mailer: Transporter;

  constructor(url: string) {
    // The URL form carries host, port, TLS and credentials; pooling keeps one authenticated connection warm.
    const parsed = new URL(url);
    this.mailer = nodemailer.createTransport({
      host: parsed.hostname,
      port: Number(parsed.port) || (parsed.protocol === "smtps:" ? 465 : 587),
      secure: parsed.protocol === "smtps:",
      auth: { user: decodeURIComponent(parsed.username), pass: decodeURIComponent(parsed.password) },
      pool: true,
      maxConnections: 2,
    });
  }

  async send(email: OutgoingEmail): Promise<{ messageId: string }> {
    const info = await this.mailer.sendMail(toMailOptions(email));
    return { messageId: info.messageId };
  }
}
