import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { liveProgramParamsSchema } from "./live-room-program";
import { authErrors, created, requiresPermissions } from "./route-contract";

/** Read-only, expiring access a browser source or screen presents to draw a physical room's outputs. */
export const liveOverlayAccessResponseSchema = z
  .object({ token: z.string().min(1).max(2000), expiresAt: utcInstantSchema })
  .strict();

export const liveOverlayAccessRouteSchema = {
  ...requiresPermissions("agenda:live_moderate"),
  tags: ["Events"],
  summary: "Issue read-only, expiring sources for a physical room's complete broadcast program",
  request: { params: liveProgramParamsSchema },
  responses: {
    ...created("Overlay access for broadcast browser sources", liveOverlayAccessResponseSchema),
    ...authErrors({ notFound: "The physical room is not on the approved agenda." }),
  },
};
