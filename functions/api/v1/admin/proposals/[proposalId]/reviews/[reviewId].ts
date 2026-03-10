import { parseJsonBody } from "../../../../../../_lib/validation";
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { updateReviewById } from "../../../../../../_lib/services/proposals";
import type { PagesContext } from "../../../../../../_lib/types";
import { reviewPatchSchema } from "../../../../../../../shared/schemas/api";

export async function onRequestPatch(
  context: PagesContext<{ proposalId: string; reviewId: string }>,
): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request);
  const body = await parseJsonBody(context.request, reviewPatchSchema);

  const review = await updateReviewById(context.env.DB, context.params.reviewId, body);
  return json({ success: true, review });
}

export async function onRequest(
  context: PagesContext<{ proposalId: string; reviewId: string }>,
): Promise<Response> {
  if (context.request.method !== "PATCH") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPatch(context);
}
