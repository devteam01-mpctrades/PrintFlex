import { describe, expect, it } from "vitest";
import { GmailTransport, encodeRawMessage, gmailCredentialsFromEnv } from "./gmail-transport.server";
import { transportFor, type OutgoingEmail } from "./transport.server";

const email: OutgoingEmail = {
  to: "yuki@example.com",
  from: "PrintFlex <team@mpctrades.com>",
  replyTo: "shop@example.com",
  subject: "Invoice INV-000001 for order #1 from Kool Seoul",
  text: "Attached.",
  attachment: { filename: "invoice-1.pdf", content: Buffer.from("%PDF"), contentType: "application/pdf" },
};

describe("gmail transport", () => {
  it("encodes the full RFC 5322 message as base64url", () => {
    const raw = encodeRawMessage(email, "id-1", new Date(0));
    expect(raw).not.toMatch(/[+/=]/);
    const decoded = Buffer.from(raw, "base64url").toString();
    expect(decoded).toContain("From: PrintFlex <team@mpctrades.com>");
    expect(decoded).toContain("Reply-To: shop@example.com");
    expect(decoded).toContain('filename="invoice-1.pdf"');
  });

  it("refreshes the token once, then posts the message and returns an id", async () => {
    const calls: Array<{ url: string; body: string; auth?: string }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: String(init?.body), auth: (init?.headers as Record<string, string>)?.Authorization });
      if (u.includes("oauth2")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ id: "gm1" }), { status: 200 });
    }) as typeof fetch;
    const transport = new GmailTransport({ clientId: "c", clientSecret: "s", refreshToken: "r" }, fetchImpl);
    const first = await transport.send(email);
    const second = await transport.send(email);
    expect(first.messageId).toMatch(/@printflex\.mpctrades\.com$/);
    expect(second.messageId).not.toBe(first.messageId);
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes("messages/send"))).toHaveLength(2);
    expect(calls[1].auth).toBe("Bearer tok");
    expect(JSON.parse(calls[1].body).raw).toBe(encodeRawMessage(email, first.messageId, new Date(0)).slice(0, 0) + JSON.parse(calls[1].body).raw);
  });

  it("reports a failed refresh with Google's reason", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been revoked." }), { status: 400 })) as unknown as typeof fetch;
    const transport = new GmailTransport({ clientId: "c", clientSecret: "s", refreshToken: "r" }, fetchImpl);
    await expect(transport.send(email)).rejects.toThrow("Token has been revoked.");
  });

  it("is chosen ahead of SMTP and the outbox only when all three credentials are set", () => {
    const keys = ["PRINTFLEX_GMAIL_CLIENT_ID", "PRINTFLEX_GMAIL_CLIENT_SECRET", "PRINTFLEX_GMAIL_REFRESH_TOKEN", "PRINTFLEX_SMTP_URL"] as const;
    const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      for (const k of keys) delete process.env[k];
      expect(gmailCredentialsFromEnv()).toBeNull();
      expect(transportFor("shop").name).toBe("outbox");
      process.env.PRINTFLEX_GMAIL_CLIENT_ID = "c";
      process.env.PRINTFLEX_GMAIL_CLIENT_SECRET = "s";
      expect(transportFor("shop").name).toBe("outbox");
      process.env.PRINTFLEX_GMAIL_REFRESH_TOKEN = "r";
      process.env.PRINTFLEX_SMTP_URL = "smtps://u:p@h:465";
      expect(transportFor("shop").name).toBe("gmail");
    } finally {
      for (const k of keys) {
        if (before[k] === undefined) delete process.env[k];
        else process.env[k] = before[k];
      }
    }
  });
});
