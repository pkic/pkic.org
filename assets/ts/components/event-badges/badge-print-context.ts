import {
  badgePrintingResponseSchema,
  type BadgeLabelRequest,
  badgePrintResponseSchema,
  type BadgePrintRequest,
  type BadgePrintingContext,
} from "../../../shared/schemas/route-contracts-event-badges";
import type { z } from "zod";
import { getJson, postJson } from "../../shared/api-client";

/** Revision alone cannot detect an approved logo object rewritten under the same key. */
export async function verifyBadgePrintingContext(
  endpoint: string,
  expected: BadgePrintingContext,
  signal?: AbortSignal,
): Promise<void> {
  const current = await getJson(`${endpoint}/printing`, badgePrintingResponseSchema, { signal });
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw new Error("The badge design or sponsor artwork changed. Prepare the print document again.");
}

export async function verifyBadgePrintArtifact(
  endpoint: string,
  expected: z.infer<typeof badgePrintResponseSchema>,
  body: BadgePrintRequest,
): Promise<void> {
  const current = await postJson(
    `${endpoint}/${encodeURIComponent(expected.id)}/print`,
    body,
    badgePrintResponseSchema,
  );
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw new Error("This badge or its printed details changed. Prepare the print document again.");
}

/** The server checks live print access and profile details in the same request that returns the label. */
export async function verifyBadgeLabelArtifact(
  endpoint: string,
  expected: z.infer<typeof badgePrintResponseSchema>,
  body: BadgeLabelRequest,
): Promise<void> {
  const current = await postJson(`${endpoint}/labels`, body, badgePrintResponseSchema);
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw new Error("This badge or its printed details changed. Reload the labels.");
}
