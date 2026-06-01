import { z } from "zod";
import {
  adminEmailOutboxQuerySchema,
  adminEmailTemplateActivateSchema,
  adminFormUpdateSchema,
  adminHeadshotUploadResponseSchema,
  adminProposalPatchSchema,
  adminUserIdParamsSchema,
  emailTemplateKeyParamsSchema,
  eventSlugParamsSchema,
  finalizeProposalSchema,
  formKeyParamsSchema,
  okResponseSchema,
  proposalIdParamsSchema,
  proposalCreateResponseSchema,
  proposalCreateSchema,
  proposalResendSpeakerManageLinkSchema,
  registrationConfirmQuerySchema,
  registrationConfirmResponseSchema,
  registrationConfirmSchema,
  registrationHeadshotUploadFormSchema,
  registrationResendConfirmationSchema,
  successResponseSchema,
} from "./api";

export const apiRootGetRouteSchema = {
  tags: ["System"],
  summary: "Get API status",
  description: "Returns the API name, version, documentation URL, and current health status.",
  responses: {
    "200": {
      description: "API status metadata.",
      content: {
        "application/json": {
          schema: z.object({
            name: z.string(),
            version: z.string(),
            docs: z.string(),
            status: z.literal("ok"),
          }),
        },
      },
    },
  },
};

export const adminEmailOutboxGetRouteSchema = {
  tags: ["Admin email"],
  summary: "List email outbox messages",
  description:
    "Returns a paginated operational view of queued, sent, failed, bounced, and retryable email outbox rows.",
  request: {
    query: adminEmailOutboxQuerySchema,
  },
  responses: {
    "200": { description: "Paginated email outbox rows and aggregate delivery summary." },
    "401": { description: "Admin authorization required." },
  },
};

export const adminEmailTemplateActivateRouteSchema = {
  tags: ["Admin email templates"],
  summary: "Activate an email template version",
  description: "Marks a specific version of an email template as the active version used for future rendering.",
  request: {
    params: emailTemplateKeyParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: adminEmailTemplateActivateSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": { description: "Template version activated successfully." },
    "400": { description: "Invalid activation payload." },
    "401": { description: "Admin authorization required." },
    "404": { description: "Template or version not found." },
  },
};

export const adminFormGetRouteSchema = {
  tags: ["Admin forms"],
  summary: "Get form configuration",
  description: "Returns editable form metadata and ordered field definitions for an admin-managed custom form.",
  request: {
    params: formKeyParamsSchema,
  },
  responses: {
    "200": { description: "Form metadata and fields." },
    "401": { description: "Admin authorization required." },
    "404": { description: "Form not found." },
  },
};

export const adminFormPatchRouteSchema = {
  tags: ["Admin forms"],
  summary: "Update form configuration",
  description: "Updates form metadata and optionally replaces all field definitions for a custom form.",
  request: {
    params: formKeyParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: adminFormUpdateSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": { description: "Updated form metadata and fields." },
    "400": { description: "Invalid form payload." },
    "401": { description: "Admin authorization required." },
    "404": { description: "Form not found." },
  },
};

export const adminFormDeleteRouteSchema = {
  tags: ["Admin forms"],
  summary: "Delete or archive form configuration",
  description:
    "Deletes an unused custom form, or archives it when submissions exist so historical submissions remain preserved.",
  request: {
    params: formKeyParamsSchema,
  },
  responses: {
    "200": { description: "Form deleted or archived successfully." },
    "401": { description: "Admin authorization required." },
    "404": { description: "Form not found." },
  },
};

export const adminUserHeadshotGetRouteSchema = {
  tags: ["Admin headshots"],
  summary: "Download a user headshot",
  description: "Returns the currently stored headshot image for a user, when one exists.",
  request: {
    params: adminUserIdParamsSchema,
  },
  responses: {
    "200": { description: "Binary headshot image." },
    "401": { description: "Admin authorization required." },
    "404": { description: "User or headshot not found." },
    "503": { description: "Uploads bucket is not configured." },
  },
};

export const adminUserHeadshotPutRouteSchema = {
  tags: ["Admin headshots"],
  summary: "Upload or replace a user headshot",
  description: "Uploads, resizes, stores, and activates a headshot image for a user from the admin console.",
  request: {
    params: adminUserIdParamsSchema,
    body: {
      content: {
        "multipart/form-data": {
          schema: registrationHeadshotUploadFormSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Headshot uploaded successfully.",
      content: {
        "application/json": {
          schema: adminHeadshotUploadResponseSchema,
        },
      },
    },
    "401": { description: "Admin authorization required." },
    "404": { description: "User not found." },
    "413": { description: "File exceeds the admin upload size limit." },
    "415": { description: "Unsupported image MIME type." },
    "503": { description: "Uploads bucket is not configured or upload failed." },
  },
};

export const adminUserHeadshotDeleteRouteSchema = {
  tags: ["Admin headshots"],
  summary: "Delete a user headshot",
  description: "Clears the active headshot reference for a user and records an admin audit event.",
  request: {
    params: adminUserIdParamsSchema,
  },
  responses: {
    "200": {
      description: "Headshot removed successfully.",
      content: {
        "application/json": {
          schema: successResponseSchema,
        },
      },
    },
    "401": { description: "Admin authorization required." },
    "404": { description: "User not found." },
  },
};

export const adminProposalOpenManageRouteSchema = {
  tags: ["Admin proposals"],
  summary: "Open proposal management view",
  description:
    "Refreshes the proposer management token and returns an admin-audited URL for inspecting the proposer workflow.",
  request: {
    params: proposalIdParamsSchema,
  },
  responses: {
    "200": {
      description: "Fresh proposal management URL.",
      content: {
        "application/json": {
          schema: z.object({ manageUrl: z.string().url() }),
        },
      },
    },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks proposal management permission." },
    "404": { description: "Proposal not found." },
  },
};

export const adminProposalPatchRouteSchema = {
  tags: ["Admin proposals"],
  summary: "Update proposal title or abstract",
  description: "Updates editable proposal text fields. Requires organizer-level access for the proposal's event.",
  request: {
    params: proposalIdParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: adminProposalPatchSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": { description: "Updated proposal details." },
    "400": { description: "Invalid proposal patch payload." },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks organizer permission for this proposal." },
    "404": { description: "Proposal not found." },
  },
};

export const adminProposalFinalizeRouteSchema = {
  tags: ["Admin proposals"],
  summary: "Finalize proposal decision",
  description:
    "Records a final proposal decision, queues speaker/proposer decision emails, and updates presentation reminder state when accepted.",
  request: {
    params: proposalIdParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: finalizeProposalSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": { description: "Proposal decision recorded and notifications queued." },
    "400": { description: "Invalid finalize payload or insufficient reviews." },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks finalize permission for this proposal." },
    "404": { description: "Proposal not found." },
  },
};

export const adminProposalFinalizePreviewRouteSchema = {
  tags: ["Admin proposals"],
  summary: "Preview proposal decision emails",
  description:
    "Renders the emails that would be sent for a proposal decision without recording the decision or queueing mail.",
  request: adminProposalFinalizeRouteSchema.request,
  responses: {
    "200": { description: "Rendered decision email preview messages." },
    "400": { description: "Invalid finalize payload." },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks finalize permission for this proposal." },
    "404": { description: "Proposal not found." },
  },
};

export const adminProposalAuditLogRouteSchema = {
  tags: ["Admin proposals"],
  summary: "List proposal audit log",
  description: "Returns recent audit events attached to a proposal, its reviews, and its speaker records.",
  request: {
    params: proposalIdParamsSchema,
  },
  responses: {
    "200": { description: "Proposal audit log entries." },
    "401": { description: "Admin authorization required." },
    "404": { description: "Proposal not found." },
  },
};

export const adminProposalSpeakersRouteSchema = {
  tags: ["Admin proposal speakers"],
  summary: "List proposal speakers",
  description:
    "Returns speaker participation status, profile completeness, headshot state, and presentation status for a proposal.",
  request: {
    params: proposalIdParamsSchema,
  },
  responses: {
    "200": { description: "Proposal speaker roster with completeness summary." },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks review permission for this proposal." },
    "404": { description: "Proposal not found." },
  },
};

export const eventProposalCreateRouteSchema = {
  tags: ["Proposals"],
  summary: "Submit an event proposal",
  description:
    "Creates a new proposal, proposer profile, optional speaker lineup, consent records, referral code, and transactional confirmation email.",
  request: {
    params: eventSlugParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: proposalCreateSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Proposal submitted successfully.",
      content: {
        "application/json": {
          schema: proposalCreateResponseSchema,
        },
      },
    },
    "400": { description: "Invalid proposal payload, invite, form answers, or required consent." },
    "404": { description: "Event not found." },
  },
};

export const proposalResendSpeakerManageLinkRouteSchema = {
  tags: ["Proposals"],
  summary: "Resend speaker management link",
  description:
    "Sends a fresh management link to a non-proposer speaker when the email matches an active proposal speaker record.",
  request: {
    params: eventSlugParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: proposalResendSpeakerManageLinkSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Request accepted. The response is intentionally generic to prevent account enumeration.",
      content: {
        "application/json": {
          schema: successResponseSchema,
        },
      },
    },
    "400": { description: "Invalid email payload." },
    "429": { description: "Rate limit exceeded." },
  },
};

export const registrationResendConfirmationRouteSchema = {
  tags: ["Registrations"],
  summary: "Resend registration confirmation email",
  description:
    "Rotates the confirmation token and resends the confirmation email for a pending registration using either a current token or recovery email.",
  request: {
    params: eventSlugParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: registrationResendConfirmationSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Resend request accepted.",
      content: {
        "application/json": {
          schema: okResponseSchema,
        },
      },
    },
    "400": { description: "Invalid recovery payload." },
    "404": { description: "No pending registration found for the provided token." },
  },
};

export const registrationConfirmEmailGetRouteSchema = {
  tags: ["Registrations"],
  summary: "Confirm registration by email link",
  description:
    "Confirms a pending registration using the token and optional registration id from a confirmation email link.",
  request: {
    params: eventSlugParamsSchema,
    query: registrationConfirmQuerySchema,
  },
  responses: {
    "200": {
      description: "Registration confirmed and management/share URLs returned.",
      content: {
        "application/json": {
          schema: registrationConfirmResponseSchema,
        },
      },
    },
    "400": { description: "Missing or invalid token." },
    "404": { description: "Registration confirmation token not found." },
  },
};

export const registrationConfirmEmailPostRouteSchema = {
  tags: ["Registrations"],
  summary: "Confirm registration",
  description:
    "Confirms a pending registration using a JSON body containing the confirmation token and optional registration id.",
  request: {
    params: eventSlugParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: registrationConfirmSchema,
        },
      },
      required: true,
    },
  },
  responses: registrationConfirmEmailGetRouteSchema.responses,
};

export const stripeWebhookPostRouteSchema = {
  tags: ["Webhooks"],
  summary: "Receive Stripe webhook events",
  description:
    "Processes signed Stripe checkout and payment events for donations, status updates, and promoter code generation.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.unknown(),
        },
      },
      required: true,
    },
  },
  responses: {
    "200": { description: "Webhook accepted and processed or intentionally ignored." },
    "400": { description: "Missing/invalid signature or invalid JSON payload." },
    "503": { description: "Stripe webhook secret is not configured." },
  },
};

export const sendgridWebhookPostRouteSchema = {
  tags: ["Webhooks"],
  summary: "Receive SendGrid event webhooks",
  description:
    "Processes SendGrid delivery, bounce, open, click, spam report, and unsubscribe events for email outbox observability.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.array(z.record(z.string(), z.unknown())),
        },
      },
      required: true,
    },
  },
  responses: {
    "200": { description: "Events accepted and processed." },
    "400": { description: "Invalid JSON or non-array payload." },
    "500": { description: "Database binding is not configured." },
  },
};
