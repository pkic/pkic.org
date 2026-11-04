import type { HeadshotVariantWidth } from "../../../assets/shared/headshot-variants";
import type { ImagesBinding } from "../types";
import { storedRasterRenditionResponse } from "./raster-image-renditions";

export interface HeadshotRenditionRequest {
  bucket: R2Bucket;
  storedKey: string;
  userId: string;
  width: HeadshotVariantWidth;
  /** Absent in local tooling without the binding; the stored portrait is served instead. */
  images?: ImagesBinding;
  /** Origin the internal cache key is placed under. */
  origin: string;
  /** The browser-facing policy, identical to the full image's. */
  cacheControl: string;
}

/** The caller checks the current portrait before a cached rendition can be released. */
export function userHeadshotRenditionResponse(request: HeadshotRenditionRequest): Promise<Response> {
  return storedRasterRenditionResponse({
    ...request,
    ownerId: request.userId,
    namespace: "headshot-renditions",
    width: Number(request.width),
    height: Number(request.width),
    fit: "cover",
    notFound: { notFoundCode: "NOT_FOUND", notFoundMessage: "Headshot not found" },
  });
}
