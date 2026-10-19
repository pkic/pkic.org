import type { PublicationRepairAlias } from "../../assets/shared/schemas/site-publication-repair-aliases";
export function readDocumentRepairAliases(
  path: string | undefined,
  protectedTrees: readonly string[],
): Promise<PublicationRepairAlias[]>;
