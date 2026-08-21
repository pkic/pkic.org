import { z } from "zod";
import { proposalIdParamsSchema } from "./api-common";
import { adminProposalPatchSchema, finalizeProposalSchema } from "./proposal-management";
import { listQuerySchema } from "./pagination";
import { proposalDecisionPreviewResponseSchema } from "./admin-event-proposals";

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
    "200": {
      description: "Rendered decision email preview messages.",
      content: { "application/json": { schema: proposalDecisionPreviewResponseSchema } },
    },
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
    query: listQuerySchema(["createdAt", "action", "actor"] as const),
  },
  responses: {
    "200": { description: "Proposal audit log entries." },
    "401": { description: "Admin authorization required." },
    "404": { description: "Proposal not found." },
  },
};

export const adminProposalCommentsRouteSchema = {
  tags: ["Admin proposals"],
  summary: "List or add internal proposal comments",
  description: "Returns or appends private programme committee comments for a proposal.",
  request: {
    params: proposalIdParamsSchema,
  },
  responses: {
    "200": { description: "Proposal internal comments." },
    "400": { description: "Invalid comment payload." },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks review permission for this proposal." },
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
