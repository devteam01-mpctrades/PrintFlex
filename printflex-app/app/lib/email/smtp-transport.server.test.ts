import { describe, expect, it } from "vitest";
import { toMailOptions } from "./smtp-transport.server";
import { transportFor } from "./transport.server";

describe("smtp transport", () => {
  it("maps an outgoing email to a nodemailer message with the attachment and reply-to", () => {
    const options = toMailOptions({
      to: "yuki@example.com",
      from: "PrintFlex <team@mpctrades.com>",
      replyTo: "shop@example.com",
      subject: "Invoice INV-000001 for order #1 from Kool Seoul",
      text: "Attached.",
      attachment: { filename: "invoice-1.pdf", content: Buffer.from("%PDF"), contentType: "application/pdf" },
    });
    expect(options.from).toBe("PrintFlex <team@mpctrades.com>");
    expect(options.replyTo).toBe("shop@example.com");
    expect(options.attachments[0]).toMatchObject({ filename: "invoice-1.pdf", contentType: "application/pdf" });
    expect("replyTo" in toMailOptions({ to: "a@b", from: "c@d", subject: "s", text: "t", attachment: { filename: "x.pdf", content: Buffer.from("x"), contentType: "application/pdf" } })).toBe(false);
  });

  it("uses SMTP only when PRINTFLEX_SMTP_URL is set, and the outbox otherwise", () => {
    const before = process.env.PRINTFLEX_SMTP_URL;
    try {
      delete process.env.PRINTFLEX_SMTP_URL;
      expect(transportFor("shop").name).toBe("outbox");
      process.env.PRINTFLEX_SMTP_URL = "smtps://user%40example.com:secret@smtp.example.com:465";
      expect(transportFor("shop").name).toBe("smtp");
    } finally {
      if (before === undefined) delete process.env.PRINTFLEX_SMTP_URL;
      else process.env.PRINTFLEX_SMTP_URL = before;
    }
  });
});
