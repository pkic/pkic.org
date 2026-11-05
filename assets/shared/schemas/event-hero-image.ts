import { EVENT_HERO_IMAGE_FILE_PATTERN, EVENT_HERO_VARIANT_WIDTHS } from "../event-hero-image-variants";
import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { eventManagementDetailResponseSchema, eventSettingsUpdateSchema } from "./event-management";
import { IMAGE_UPLOAD_ALLOWED_MIME_TYPES } from "./images";

export const EVENT_HERO_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const EVENT_HERO_IMAGE_WIDTH = 1200;
export const EVENT_HERO_IMAGE_HEIGHT = 675;
export const EVENT_HERO_IMAGE_GUIDANCE =
  "Choose an image to crop to 16:9, at least 1200 pixels wide and 675 pixels tall. JPEG, PNG, or WebP, up to 5 MB.";
const imageDimensionsSchema = z.object({ width: z.number(), height: z.number() });
export const eventHeroImageDimensionsSchema = imageDimensionsSchema
  .refine(({ width, height }) => width >= EVENT_HERO_IMAGE_WIDTH && height >= EVENT_HERO_IMAGE_HEIGHT, {
    message: "Choose an image at least 1200 × 675 pixels.",
  })
  .refine(({ width, height }) => Math.abs(width / height - 16 / 9) <= 0.01, {
    message: "Crop the image to 16:9.",
  });
export const eventHeroImageSaveSchema = eventSettingsUpdateSchema
  .pick({
    expectedUpdatedAt: true,
    name: true,
    slug: true,
    confirmSlugChange: true,
  })
  .extend({ groupId: databaseIdSchema.optional() });
export type EventHeroImageSave = z.infer<typeof eventHeroImageSaveSchema>;
export const eventHeroImageFormSchema = eventHeroImageSaveSchema
  .extend({
    file: z
      .file()
      .max(EVENT_HERO_IMAGE_MAX_BYTES, "Choose an image under 5 MB.")
      .mime([...IMAGE_UPLOAD_ALLOWED_MIME_TYPES], "Choose a JPEG, PNG, or WebP image."),
    dimensions: imageDimensionsSchema.nullable(),
  })
  .superRefine(({ dimensions }, context) => {
    if (!dimensions) {
      context.addIssue({ code: "custom", path: ["file"], message: "Wait for the image preview to load." });
      return;
    }
    const result = eventHeroImageDimensionsSchema.safeParse(dimensions);
    if (!result.success)
      for (const issue of result.error.issues)
        context.addIssue({ code: "custom", path: ["file"], message: issue.message });
  });

const imageBytes = z.any().describe("JPEG, PNG, or WebP image bytes, at most 5 MB");
export const eventHeroImageSaveRouteSchema = {
  tags: ["Events"],
  summary: "Upload an event hero image and save general settings",
  request: {
    params: eventSlugParamsSchema,
    query: eventHeroImageSaveSchema,
    body: {
      required: true,
      content: {
        "image/jpeg": { schema: imageBytes },
        "image/png": { schema: imageBytes },
        "image/webp": { schema: imageBytes },
        "application/octet-stream": { schema: imageBytes },
      },
    },
  },
  responses: {
    "200": {
      description: "Saved event.",
      content: { "application/json": { schema: eventManagementDetailResponseSchema } },
    },
    "403": jsonErrorResponse("Event editing permission is required."),
    "409": jsonErrorResponse("Event settings or editing authority changed."),
    "413": jsonErrorResponse("Image exceeds the supported size."),
    "415": jsonErrorResponse("Unsupported image."),
    "422": jsonErrorResponse("Image resolution or aspect ratio does not meet the requirements."),
  },
};

export const eventHeroImageGetRouteSchema = {
  tags: ["Events"],
  summary: "Read the current event hero image",
  request: {
    params: eventSlugParamsSchema.extend({ file: z.string().regex(EVENT_HERO_IMAGE_FILE_PATTERN) }),
    query: z.object({ width: z.enum(EVENT_HERO_VARIANT_WIDTHS).optional() }),
  },
  responses: {
    "200": {
      description: "Current image asset, or an optimized WebP rendition when a supported width is requested.",
      content: {
        "image/jpeg": { schema: imageBytes },
        "image/png": { schema: imageBytes },
        "image/webp": { schema: imageBytes },
      },
    },
    "404": jsonErrorResponse("Image is no longer current or does not exist."),
  },
};
