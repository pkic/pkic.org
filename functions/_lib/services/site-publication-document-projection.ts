import {
  publicationDocumentAllowSchema,
  publicationDocumentDenialSchema,
  publicationDocumentStorageKey,
  publicationDocumentGrantId,
  type PublicationDocumentAllow,
  type PublicationDocumentEffect,
} from "../../../assets/shared/schemas/site-publication-documents";

async function readProjection(bucket: R2Bucket, key: string) {
  const object = await bucket.get(key);
  if (!object) return null;
  if (object.size > 16384) {
    await object.body.cancel();
    throw new Error("PUBLICATION_DOCUMENT_PROJECTION_INVALID");
  }
  return { value: JSON.parse(await object.text()), etag: object.etag };
}
function identical(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
/** Separate terminal objects prevent even a late allow writer from overwriting a denial. */
export async function writePublicationDocumentDenial(bucket: R2Bucket, effect: PublicationDocumentEffect) {
  const expected = publicationDocumentDenialSchema.parse({ ...effect, version: 1 });
  const key = publicationDocumentStorageKey(effect.grantId, "deny");
  const existing = await readProjection(bucket, key);
  if (!existing)
    await bucket.put(key, JSON.stringify(expected), {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
    });
  const verified = await readProjection(bucket, key);
  if (!verified || !identical(publicationDocumentDenialSchema.parse(verified.value), expected))
    throw new Error("PUBLICATION_DOCUMENT_DENIAL_NOT_VERIFIED");
  return { etag: verified.etag };
}
/** An immutable approved selection can be staged early, but a terminal denial always wins. */
export async function writePublicationDocumentAllow(bucket: R2Bucket, input: PublicationDocumentAllow) {
  const expected = publicationDocumentAllowSchema.parse(input);
  if ((await publicationDocumentGrantId(expected)) !== expected.grantId)
    throw new Error("PUBLICATION_DOCUMENT_GRANT_MISMATCH");
  const denied = publicationDocumentStorageKey(expected.grantId, "deny");
  if (await bucket.head(denied)) throw new Error("PUBLICATION_DOCUMENT_DENIED");
  const key = publicationDocumentStorageKey(expected.grantId, "allow");
  const existing = await readProjection(bucket, key);
  if (!existing)
    await bucket.put(key, JSON.stringify(expected), {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
    });
  const verified = await readProjection(bucket, key);
  if (!verified || !identical(publicationDocumentAllowSchema.parse(verified.value), expected))
    throw new Error("PUBLICATION_DOCUMENT_ALLOW_NOT_VERIFIED");
  if (await bucket.head(denied)) throw new Error("PUBLICATION_DOCUMENT_DENIED");
}
/** Each request checks private storage directly; Workers Cache is never authority. */
export async function readPublicationDocumentAllow(bucket: R2Bucket, grantId: string) {
  if (await bucket.head(publicationDocumentStorageKey(grantId, "deny"))) return null;
  const projection = await readProjection(bucket, publicationDocumentStorageKey(grantId, "allow"));
  if (!projection) return null;
  const allow = publicationDocumentAllowSchema.parse(projection.value);
  if (
    allow.grantId !== grantId ||
    (await publicationDocumentGrantId(allow)) !== grantId ||
    (await bucket.head(publicationDocumentStorageKey(grantId, "deny")))
  )
    return null;
  return allow;
}
