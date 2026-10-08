import type {
  PublishedDocument,
  VerifiedPublishedDocument,
} from "../../functions/_lib/services/site-publication-documents";
export function verifyPublicDocuments(
  documents: readonly PublishedDocument[],
  getObject: (key: string) => Promise<{ size: number; etag: string; body: ReadableStream<Uint8Array> } | null>,
): Promise<VerifiedPublishedDocument[]>;
