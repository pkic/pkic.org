import { AppError } from "../errors";
import type { Env } from "../types";

export interface SendgridMessage {
  to: string;
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
  calendarIcsContent?: string;
  calendarMethod?: "PUBLISH" | "REQUEST";
  categories?: string[];
  replyTo?: string;
  bounceAddress?: string;
  attachments?: Array<{ filename: string; contentType: string; base64Content: string }>;
}

function toSendgridMimeType(contentType: string): string {
  return contentType.split(";")[0]?.trim() || "application/octet-stream";
}

export async function sendViaSendgrid(env: Env, message: SendgridMessage): Promise<string | null> {
  if (!env.SENDGRID_API_KEY) {
    throw new AppError(500, "SENDGRID_NOT_CONFIGURED", "SENDGRID_API_KEY is not configured");
  }

  const fromEmail = env.FROM_EMAIL ?? env.SENDGRID_FROM_EMAIL ?? "noreply@pkic.org";
  const fromName = env.FROM_NAME ?? env.SENDGRID_FROM_NAME ?? "PKI Consortium";

  const payload: Record<string, unknown> = {
    personalizations: [{
      to: [{ email: message.to }],
      ...(message.bcc && message.bcc.length > 0
        ? { bcc: message.bcc.map((email) => ({ email })) }
        : {}),
    }],
    from: { email: fromEmail, name: fromName },
    ...(message.replyTo ? { reply_to: { email: message.replyTo } } : {}),
    subject: message.subject,
    content: [
      { type: "text/plain", value: message.text },
      { type: "text/html", value: message.html },
      ...(message.calendarIcsContent
        ? [{
          type: "text/calendar",
          value: message.calendarIcsContent,
        }]
        : []),
    ],
    categories: message.categories ?? [],
    ...(message.bounceAddress ? { mail_settings: { bounce_forward: { email: message.bounceAddress, enable: true } } } : {}),
  };

  if (message.attachments && message.attachments.length > 0) {
    payload.attachments = message.attachments.map((attachment) => ({
      content: attachment.base64Content,
      filename: attachment.filename,
      type: toSendgridMimeType(attachment.contentType),
      disposition: "attachment",
    }));
  }

  const response = await fetch(env.SENDGRID_API_BASE ?? "https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.SENDGRID_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AppError(502, "SENDGRID_SEND_FAILED", "SendGrid rejected email", {
      status: response.status,
      body,
    });
  }

  return response.headers.get("x-message-id");
}
