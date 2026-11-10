import { SCREEN_MANAGE_PERMISSION, SCREEN_STATUS_PERMISSIONS } from "../event-screen-permissions";
import { jsonErrorResponse } from "./api-common";
import {
  eventScreenPairingCreateSchema,
  eventScreensListSchema,
  eventScreensParamsSchema,
  eventScreensQuerySchema,
  screenPairingResponseSchema,
  screenParamsSchema,
  screenReadResponseSchema,
  screenRecordSchema,
  screenSessionPollResponseSchema,
  screenUpdateSchema,
} from "./event-screens";
import {
  authErrors,
  created,
  noContent,
  ok,
  publicErrors,
  publicOperation,
  requiresAnyPermissions,
  requiresPermissions,
} from "./route-contract";

const tags = ["Event screens"];
const statusPermissions = SCREEN_STATUS_PERMISSIONS.map((permission) => [permission]);

export const screenPairingCreateRouteSchema = {
  tags,
  ...publicOperation(),
  summary: "Start pairing an unpaired screen",
  description:
    "Returns the code the screen shows and sets a short-lived, signed challenge cookie that only this browser holds. " +
    "Nothing is stored until staff approve the code.",
  request: { params: screenParamsSchema },
  responses: {
    ...created("The pairing code and when it expires", screenPairingResponseSchema),
    ...publicErrors({
      badRequest: "Invalid screen ID",
      tooManyRequests: "Too many pairing requests from this network",
    }),
    "503": jsonErrorResponse("Pairing is unavailable because rate limiting could not be enforced."),
  },
};

export const screenSessionCreateRouteSchema = {
  tags,
  ...publicOperation(),
  summary: "Sign a screen in once staff approved its pairing code",
  description:
    "The pairing page polls this with its challenge cookie. 201 sets the screen's sign-in cookie and revokes its " +
    "older sign-ins; 202 means staff have not approved the code yet; 410 means the code expired or was already used.",
  request: { params: screenParamsSchema },
  responses: {
    "201": {
      description: "The screen is signed in.",
      content: { "application/json": { schema: screenSessionPollResponseSchema } },
    },
    "202": {
      description: "Staff have not approved the code yet.",
      content: { "application/json": { schema: screenSessionPollResponseSchema } },
    },
    "401": jsonErrorResponse("The challenge is missing, invalid, or for another screen."),
    "410": jsonErrorResponse("The pairing code expired or was already used; start pairing again."),
  },
};

export const screenSessionDeleteRouteSchema = {
  tags,
  ...requiresPermissions(SCREEN_MANAGE_PERMISSION),
  summary: "Revoke a screen's sign-in",
  description: "The screen shows a new pairing code on its next request.",
  request: { params: screenParamsSchema },
  responses: {
    ...noContent("Every sign-in of the screen is revoked."),
    ...authErrors({ notFound: "Screen not found", conflict: "Your permission changed; try again." }),
  },
};

export const screenGetRouteSchema = {
  tags,
  ...requiresAnyPermissions(...statusPermissions),
  summary: "Read a screen",
  description:
    "A paired screen, with its own sign-in cookie, receives what to show, the server's clock and, while assigned, " +
    "15 minutes of read-only access to its room's overlay. Staff who manage screens or operate the event's rooms " +
    "receive the screen's record instead. A screen that must pair again receives 401 with a SCREEN_SESSION_* code.",
  request: { params: screenParamsSchema },
  responses: {
    ...ok("The screen as its viewer may see it", screenReadResponseSchema),
    ...authErrors({ notFound: "Screen not found" }),
  },
};

export const screenUpdateRouteSchema = {
  tags,
  ...requiresPermissions(SCREEN_MANAGE_PERMISSION),
  summary: "Rename or reassign a screen",
  request: {
    params: screenParamsSchema,
    body: { required: true, content: { "application/json": { schema: screenUpdateSchema } } },
  },
  responses: {
    ...ok("The screen after the change", screenRecordSchema),
    ...authErrors({
      badRequest: "Invalid change",
      notFound: "Screen not found",
      conflict: "The screen changed since it was read, or it belongs to no event",
      unprocessable: "The room is not in the screen's event",
    }),
  },
};

export const eventScreenPairingRouteSchema = {
  tags,
  ...requiresPermissions(SCREEN_MANAGE_PERMISSION),
  summary: "Approve a screen's pairing code for this event",
  description:
    "Adds or moves the screen to this event under its name, optionally assigns it, and holds the approval until " +
    "the screen collects it with its challenge, within the code's lifetime.",
  request: {
    params: eventScreensParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventScreenPairingCreateSchema } } },
  },
  responses: {
    ...created("The screen, waiting for its sign-in", screenRecordSchema),
    ...authErrors({
      badRequest: "Invalid pairing",
      notFound: "Event not found",
      conflict: "The screen changed while pairing it; try again",
      unprocessable: "The room is not in this event",
    }),
  },
};

export const eventScreensGetRouteSchema = {
  tags,
  ...requiresAnyPermissions(...statusPermissions),
  summary: "List the event's screens",
  request: { params: eventScreensParamsSchema, query: eventScreensQuerySchema },
  responses: {
    ...ok("The event's screens", eventScreensListSchema),
    ...authErrors({ badRequest: "Invalid screen query", notFound: "Event not found" }),
  },
};
