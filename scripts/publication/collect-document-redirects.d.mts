import type { SitePublicationSnapshot } from "../../assets/shared/schemas/site-publication";
import type {
  SitePublicationDocumentRoutes,
  SitePublicationRelease,
} from "../../assets/shared/schemas/site-publication-release";
import type {
  RetainedPublishedDocument,
  VerifiedPublishedDocument,
} from "../../functions/_lib/services/site-publication-documents";

import type { PublishedRecording } from "../../functions/_lib/services/site-publication-recordings";

export function documentFilePath(url: unknown): string;
export function collectDocumentRedirects(
  snapshot: SitePublicationSnapshot,
  documents: readonly VerifiedPublishedDocument[],
  retained?: readonly RetainedPublishedDocument[],
  recordings?: readonly PublishedRecording[],
): SitePublicationDocumentRoutes;
export function assertDocumentRoutesSnapshot(
  snapshot: SitePublicationSnapshot,
  value: unknown,
  retained?: readonly RetainedPublishedDocument[],
): SitePublicationDocumentRoutes;
export function validateDocumentRoutes(value: unknown, release?: SitePublicationRelease): SitePublicationDocumentRoutes;
export function boundDocumentRedirect(
  routes: SitePublicationDocumentRoutes | null | undefined,
  url: string | null,
): SitePublicationDocumentRoutes["redirects"][number] | null;
export function validateDocumentRedirectRules(
  entries: readonly SitePublicationRelease["redirects"][number][],
  routes: SitePublicationDocumentRoutes,
  retained?: string,
): void;
export function prepareDocumentRetirement(
  roots: readonly string[],
  routes: SitePublicationDocumentRoutes,
): Promise<() => Promise<void>>;
export function readReleaseDocumentRoutes(
  root: string,
  release: SitePublicationRelease,
): Promise<SitePublicationDocumentRoutes>;
