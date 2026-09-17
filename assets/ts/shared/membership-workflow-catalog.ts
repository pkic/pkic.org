import type { z } from "zod";
import {
  membershipWorkflowsResponseSchema,
  type MembershipWorkflowVersion,
} from "../../shared/schemas/membership-workflows";
import type { ServerCatalog } from "./server-catalog";

export const MEMBERSHIP_WORKFLOWS_API = "/api/v1/membership/workflows/versions";
export const publishedMembershipWorkflowCatalog: ServerCatalog<
  MembershipWorkflowVersion,
  z.infer<typeof membershipWorkflowsResponseSchema>
> = {
  endpoint: MEMBERSHIP_WORKFLOWS_API,
  responseSchema: membershipWorkflowsResponseSchema,
  resolveItems: (response) => response.workflows,
  resolvePage: (response) => response.page,
  itemKey: (workflow) => workflow.id,
  itemLabel: (workflow) => `${workflow.definition.name} · version ${workflow.version}`,
  params: { status: "published" },
  sort: "name",
};
