import { eventSlugParamsSchema } from "./api-common";
import { eventLiveStudioSetupPutSchema, eventLiveStudioSetupResponseSchema } from "./live-studio-setup";
import { authErrors, ok, requiresPermissions } from "./route-contract";

const tags = ["Event live settings"];

export const eventLiveStudioSetupGetRouteSchema = {
  tags,
  ...requiresPermissions("agenda:live_studio"),
  summary: "Read the event's studio setup",
  description:
    "How each graphic looks when it goes on air and the panel arrangement each studio workspace starts from, as " +
    "the event saved them. A graphic or workspace it has not saved is absent and uses the built-in setup.",
  request: { params: eventSlugParamsSchema },
  responses: {
    ...ok("The event's studio setup", eventLiveStudioSetupResponseSchema),
    ...authErrors({ notFound: "Event not found" }),
  },
};

export const eventLiveStudioSetupPutRouteSchema = {
  tags,
  ...requiresPermissions("agenda:live_setup"),
  summary: "Replace the event's studio setup",
  description:
    "Send a null expectedUpdatedAt to save the setup for the first time; otherwise send the version being " +
    "replaced. Every room shares it and picks it up on its next refresh; nothing on air changes.",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventLiveStudioSetupPutSchema } } },
  },
  responses: {
    ...ok("The event's studio setup after the change", eventLiveStudioSetupResponseSchema),
    ...authErrors({ badRequest: "Invalid setup", notFound: "Event not found", conflict: "The setup changed" }),
  },
};
