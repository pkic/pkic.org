import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { eventSlugParamsSchema } from "./api-common";
import { authErrors, ok, requiresPermissions } from "./route-contract";
/** A physical room normally has six browser sources; keep fanout and fresh operator checks bounded. */
export const LIVE_PROGRAM_MAX_CONNECTIONS = 128;
export const LIVE_PROGRAM_PROTOCOL = "pkic-live-program.v1";
export const liveProgramParamsSchema = eventSlugParamsSchema.extend({ roomId: databaseIdSchema });
export const liveProgramSelectionSchema = z
  .object({
    roomId: databaseIdSchema,
    occurrenceId: databaseIdSchema.nullable(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type LiveProgramSelection = z.infer<typeof liveProgramSelectionSchema>;
export const liveProgramSelectSchema = z
  .object({ occurrenceId: databaseIdSchema.nullable(), expectedRevision: z.number().int().nonnegative() })
  .strict();
export const liveProgramMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("program.snapshot"), selection: liveProgramSelectionSchema }).strict(),
  z.object({ type: z.literal("program.changed"), selection: liveProgramSelectionSchema }).strict(),
]);
export const liveProgramReadRouteSchema = {
  ...requiresPermissions("agenda:live_moderate"),
  tags: ["Events"],
  summary: "Read the physical room's active broadcast session",
  request: { params: liveProgramParamsSchema },
  responses: {
    ...ok("Active program selection", liveProgramSelectionSchema),
    ...authErrors({ notFound: "The room is not on the approved agenda." }),
  },
};
export const liveProgramSelectRouteSchema = {
  ...liveProgramReadRouteSchema,
  summary: "Select the physical room's active broadcast session",
  request: {
    params: liveProgramParamsSchema,
    body: { content: { "application/json": { schema: liveProgramSelectSchema } }, required: true },
  },
};

/** Domain refusals cross Durable Object RPC as data; infrastructure failures remain rejected calls. */
export const liveProgramSelectResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), selection: liveProgramSelectionSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      status: z.union([z.literal(401), z.literal(403), z.literal(404), z.literal(409)]),
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .strict(),
]);
export type LiveProgramSelectResult = z.infer<typeof liveProgramSelectResultSchema>;
