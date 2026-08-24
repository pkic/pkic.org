import type { OpenAPIRouteSchema } from "chanfana";
import type { z } from "zod";
import { requireUserBackedAdminFromRequest } from "../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import {
  grantResourceToGroup,
  listResourceGroupGrants,
  revokeResourceGroupGrant,
  type ResourceGrantCapability,
  type ResourceGrantKind,
  type ResourceGrantListQuery,
  type ResourceGrantMutationInput,
} from "../../../_lib/services/resource-grants";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";

interface ResourceGrantRouteSchemaSet {
  list: OpenAPIRouteSchema;
  create: OpenAPIRouteSchema;
  revoke: OpenAPIRouteSchema;
  listResponseSchema: z.ZodType;
  mutationResponseSchema: z.ZodType;
}

interface ListData<K extends ResourceGrantKind> {
  params: Record<string, string>;
  query: ResourceGrantListQuery<K>;
}

interface CreateData<K extends ResourceGrantKind> {
  params: Record<string, string>;
  body: ResourceGrantMutationInput<K>;
}

interface RevokeData<K extends ResourceGrantKind> {
  params: Record<string, string> & { granteeGroupId: string; capability: ResourceGrantCapability<K> };
}

/** Builds identical thin HTTP adapters while domain schemas retain exact capabilities. */
export function createResourceGrantRoutes<K extends ResourceGrantKind>(
  kind: K,
  resourceIdParam: string,
  schemas: ResourceGrantRouteSchemaSet,
) {
  const list = openApiRoute(schemas.list, async (c: AdminContext, validated) => {
    const data = validated as unknown as ListData<K>;
    const db = requestDb(c);
    const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
    const result = await listResourceGroupGrants(
      db,
      actor,
      data.params.groupId,
      kind,
      data.params[resourceIdParam],
      data.query,
    );
    return json(
      schemas.listResponseSchema.parse({
        grants: result.grants,
        page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.grants.length),
      }),
    );
  });

  const create = openApiRoute(schemas.create, async (c: AdminContext, validated) => {
    const data = validated as unknown as CreateData<K>;
    const db = requestDb(c);
    const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
    const result = await grantResourceToGroup(
      db,
      actor,
      data.params.groupId,
      kind,
      data.params[resourceIdParam],
      data.body,
    );
    return json(schemas.mutationResponseSchema.parse({ success: true, ...result }), result.created ? 201 : 200);
  });

  const revoke = openApiRoute(schemas.revoke, async (c: AdminContext, validated) => {
    const data = validated as unknown as RevokeData<K>;
    const db = requestDb(c);
    const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
    await revokeResourceGroupGrant(db, actor, data.params.groupId, kind, data.params[resourceIdParam], {
      granteeGroupId: data.params.granteeGroupId,
      capability: data.params.capability,
    });
    return json({ success: true });
  });

  return { list, create, revoke };
}
