import { sha256Hex } from "../utils/crypto";
import {
  sitePublicationSnapshotSchema,
  sitePublicationContentSchema,
  type SitePublicationSnapshot,
} from "../../../assets/shared/schemas/site-publication";

/** Public bytes identify content; operational highwater does not change that identity. */
export async function createSitePublicationSnapshot(
  value: unknown,
  sourceSequence: number | null = null,
): Promise<SitePublicationSnapshot> {
  const content = sitePublicationContentSchema.parse(value);
  return sitePublicationSnapshotSchema.parse({
    ...content,
    sourceSequence,
    snapshotId: await sha256Hex(JSON.stringify(content)),
  });
}

/** Media URLs change the content hash while retaining the native extraction fence. */
export function createRemappedSitePublicationSnapshot(source: SitePublicationSnapshot, value: unknown) {
  return createSitePublicationSnapshot(value, source.sourceSequence);
}

export function assertSitePublicationSourceUnchanged(
  source: SitePublicationSnapshot,
  verified: SitePublicationSnapshot,
) {
  if (verified.snapshotId !== source.snapshotId || verified.sourceSequence !== source.sourceSequence)
    throw new Error("Public content or publication highwater changed during export; rebuild the publication");
}
