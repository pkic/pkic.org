import type { z } from "zod";
import { emailTemplatePreviewResponseSchema } from "./schemas/email-templates";

export const emailPreviewDocumentMessageSchema = emailTemplatePreviewResponseSchema.pick({ html: true });

export type EmailPreviewDocumentMessage = z.infer<typeof emailPreviewDocumentMessageSchema>;
