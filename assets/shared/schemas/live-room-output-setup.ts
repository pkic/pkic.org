import { z } from "zod";
import { liveOverlayLayoutSlugSchema } from "./live-overlay-layout";
import { liveProgramParamsSchema } from "./live-room-program";
import { authErrors, ok, requiresPermissions } from "./route-contract";

/**
 * The outputs a physical room sets up beside Program: each one a screen in
 * the room or a source in the production software, with a name, the short
 * code the studio shows, what it shows, and the scene it draws. Program is
 * built in and never listed here.
 */

/**
 * What an output shows. `exact`: only what an operator takes to it, from
 * Preview, with its own take button. `follow`: Program's question, poll and
 * timers, plus what an operator sends to it. `speaker`: the speaker's screen,
 * with the time, the next question and the messages to the speaker.
 */
export const LIVE_ROOM_OUTPUT_ROLES = ["exact", "follow", "speaker"] as const;
export type LiveRoomOutputRole = (typeof LIVE_ROOM_OUTPUT_ROLES)[number];

/** Names the room keeps for its own buses and streams; an added output never takes one. */
export const LIVE_RESERVED_OUTPUT_KEYS = ["program", "preview", "livestream", "stage-preview"] as const;

/** The speaker's screen keeps the key every speaker screen link already uses. */
export const LIVE_SPEAKER_OUTPUT_KEY = "stage-display";

/** An output's stable key: in its link, in the room's state and on the screens that show it. Never changes. */
export const liveRoomOutputKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,23}$/)
  .refine((key) => !(LIVE_RESERVED_OUTPUT_KEYS as readonly string[]).includes(key), "This name is reserved.");

export const LIVE_ROOM_OUTPUT_CODE_MAX = 5;
export const LIVE_ROOM_OUTPUT_NAME_MAX = 40;
/** As many outputs as the studio's Transition and monitors can show on a Full HD laptop. */
export const LIVE_ROOM_OUTPUTS_MAX = 8;

const outputFieldsSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(LIVE_ROOM_OUTPUT_NAME_MAX),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]+( [A-Z0-9]+)?$/, "Use letters and numbers, with at most one space.")
    .max(LIVE_ROOM_OUTPUT_CODE_MAX, `Use at most ${LIVE_ROOM_OUTPUT_CODE_MAX} characters.`),
  role: z.enum(LIVE_ROOM_OUTPUT_ROLES),
  /** The scene the output always draws; null for the scene it is given (from Preview, or Program's). */
  scene: liveOverlayLayoutSlugSchema.nullable(),
});

export const liveRoomOutputSchema = outputFieldsSchema.extend({ key: liveRoomOutputKeySchema }).strict();
export type LiveRoomOutput = z.infer<typeof liveRoomOutputSchema>;

const PROGRAM_CODE = "PGM";

/** The rules every list of outputs keeps, wherever it is written or read. */
function checkOutputs(
  outputs: ReadonlyArray<{ code: string; role: LiveRoomOutputRole; key?: string }>,
  ctx: z.RefinementCtx,
) {
  const codes = new Set<string>([PROGRAM_CODE]);
  outputs.forEach((output, index) => {
    if (codes.has(output.code))
      ctx.addIssue({ code: "custom", path: [index, "code"], message: "Another screen already uses this code." });
    codes.add(output.code);
  });
  if (outputs.filter((output) => output.role === "speaker").length > 1)
    ctx.addIssue({ code: "custom", path: [], message: "A room has one speaker screen." });
  const keys = outputs.flatMap((output) => (output.key ? [output.key] : []));
  if (new Set(keys).size !== keys.length)
    ctx.addIssue({ code: "custom", path: [], message: "Each screen is listed once." });
}

export const liveRoomOutputsSchema = z.array(liveRoomOutputSchema).max(LIVE_ROOM_OUTPUTS_MAX).superRefine(checkOutputs);

/** The room's outputs until anyone sets them up: the projector and the speaker's screen it always had. */
export const DEFAULT_LIVE_ROOM_OUTPUTS: readonly LiveRoomOutput[] = [
  { key: "projector", name: "Projector", code: "PRJ", role: "follow", scene: null },
  { key: LIVE_SPEAKER_OUTPUT_KEY, name: "Stage display", code: "DSP", role: "speaker", scene: null },
];

/** One output as saved: an existing one names its key, a new one leaves it out and the room makes one. */
export const liveRoomOutputInputSchema = outputFieldsSchema
  .extend({ key: liveRoomOutputKeySchema.optional() })
  .strict();
export type LiveRoomOutputInput = z.infer<typeof liveRoomOutputInputSchema>;

/** The whole list, in the order the studio shows it; an output left out is removed. */
export const liveRoomOutputsRequestSchema = z
  .object({
    outputs: z
      .array(liveRoomOutputInputSchema)
      .min(1, "Keep at least one screen besides Program.")
      .max(LIVE_ROOM_OUTPUTS_MAX, `A room has at most ${LIVE_ROOM_OUTPUTS_MAX} screens besides Program.`)
      .superRefine(checkOutputs),
  })
  .strict();
export type LiveRoomOutputsRequest = z.infer<typeof liveRoomOutputsRequestSchema>;

export const liveRoomOutputsResponseSchema = z.object({ outputs: liveRoomOutputsSchema }).strict();
export type LiveRoomOutputsResponse = z.infer<typeof liveRoomOutputsResponseSchema>;

export const liveRoomOutputsGetRouteSchema = {
  ...requiresPermissions("agenda:live_moderate"),
  tags: ["Events"],
  summary: "List the outputs a physical room sets up beside Program",
  request: { params: liveProgramParamsSchema },
  responses: {
    ...ok("The room's outputs, in order", liveRoomOutputsResponseSchema),
    ...authErrors({ notFound: "The physical room does not exist." }),
  },
};

export const liveRoomOutputsPutRouteSchema = {
  ...requiresPermissions("agenda:live_moderate"),
  tags: ["Events"],
  summary: "Replace the outputs a physical room sets up beside Program",
  request: {
    params: liveProgramParamsSchema,
    body: { required: true, content: { "application/json": { schema: liveRoomOutputsRequestSchema } } },
  },
  responses: {
    ...ok("The room's outputs, in order", liveRoomOutputsResponseSchema),
    ...authErrors({ notFound: "The physical room does not exist." }),
  },
};
