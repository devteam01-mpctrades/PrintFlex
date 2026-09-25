import { randomUUID } from "node:crypto";
import { toEml, type EmailTransport, type OutgoingEmail } from "./transport.server";

/**
 * Sending through the Gmail API with an OAuth2 refresh token, the same way
 * the MPC Trades contact relay does, so the app mails as team@mpctrades.com
 * without an app password. Plain fetch: token refresh, then messages.send
 * with the RFC 5322 message that toEml already builds.
 */

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function gmailCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): GmailCredentials | null {
  const clientId = env.PRINTFLEX_GMAIL_CLIENT_ID?.trim();
  const clientSecret = env.PRINTFLEX_GMAIL_CLIENT_SECRET?.trim();
  const refreshToken = env.PRINTFLEX_GMAIL_REFRESH_TOKEN?.trim();
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

/** Gmail wants the raw message base64url-encoded. Pure, so it can be tested. */
export function encodeRawMessage(email: OutgoingEmail, messageId: string, date: Date): string {
  return Buffer.from(toEml(email, messageId, date)).toString("base64url");
}

export class GmailTransport implements EmailTransport {
  readonly name = "gmail";
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly credentials: GmailCredentials, private readonly fetchImpl: typeof fetch = fetch) {}

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        refresh_token: this.credentials.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const data = (await response.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!response.ok || !data.access_token) throw new Error(`Gmail token refresh failed: ${data.error_description ?? data.error ?? response.status}`);
    this.accessToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return data.access_token;
  }

  async send(email: OutgoingEmail): Promise<{ messageId: string }> {
    const messageId = `${randomUUID()}@printflex.mpctrades.com`;
    const response = await this.fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: encodeRawMessage(email, messageId, new Date()) }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Gmail send failed (${response.status}): ${text.slice(0, 300)}`);
    }
    return { messageId };
  }
}
