import { eventSlugParamsSchema } from "./api-common";
import {
  eventLiveOverlayLayoutParamsSchema,
  eventLiveOverlayLayoutPutSchema,
  eventLiveOverlayLayoutsResponseSchema,
  eventLiveOverlayPositionsPutSchema,
} from "./live-overlay-layout";
import { authErrors, ok, requiresPermissions } from "./route-contract";

const common = {
  tags: ["Event live settings"],
  ...requiresPermissions("agenda:live_moderate"),
};

export const eventLiveOverlayLayoutsGetRouteSchema = {
  ...common,
  summary: "List the event's broadcast overlay layouts and shared element positions",
  description:
    "The built-in layouts, as saved for this event or as shipped, then the event's own, each element a layout " +
    "shares at the event's shared position, and those positions. A bounded configuration set, not a searchable listing.",
  request: { params: eventSlugParamsSchema },
  responses: {
    ...ok("The event's layouts", eventLiveOverlayLayoutsResponseSchema),
    ...authErrors({ notFound: "Event not found" }),
  },
};

export const eventLiveOverlayLayoutPutRouteSchema = {
  ...common,
  summary: "Create or replace one broadcast overlay layout",
  description:
    "Send a null expectedUpdatedAt to create a layout or to save a built-in one for the first time; otherwise send " +
    "the version being replaced. An element marked shared takes the event's shared position, whatever box is sent " +
    "for it; the shared positions change only through their own resource. Connected browser sources redraw on " +
    "their room's next refresh.",
  request: {
    params: eventLiveOverlayLayoutParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventLiveOverlayLayoutPutSchema } } },
  },
  responses: {
    ...ok("The event's layouts after the change", eventLiveOverlayLayoutsResponseSchema),
    ...authErrors({
      badRequest: "Invalid layout",
      notFound: "Event not found",
      conflict: "The layout exists, changed, or the event has its maximum of saved layouts",
    }),
  },
};

export const eventLiveOverlayLayoutDeleteRouteSchema = {
  ...common,
  summary: "Delete one of the event's own overlay layouts",
  description: "Built-in layouts, the default among them, cannot be deleted; reset one by saving its preset instead.",
  request: { params: eventLiveOverlayLayoutParamsSchema },
  responses: {
    ...ok("The event's layouts after the deletion", eventLiveOverlayLayoutsResponseSchema),
    ...authErrors({ notFound: "Event or layout not found", conflict: "Built-in layout" }),
  },
};

export const eventLiveOverlayPositionsPutRouteSchema = {
  ...common,
  summary: "Replace the event's shared element positions",
  description:
    "Every layout element that shares its position moves with it; an element a layout places itself stays where it " +
    "is. Send a null expectedUpdatedAt to save the positions for the first time; otherwise send the version being " +
    "replaced.",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventLiveOverlayPositionsPutSchema } } },
  },
  responses: {
    ...ok("The event's layouts and shared positions after the change", eventLiveOverlayLayoutsResponseSchema),
    ...authErrors({ badRequest: "Invalid positions", notFound: "Event not found", conflict: "The positions changed" }),
  },
};

export const eventLiveOverlayPositionsDeleteRouteSchema = {
  ...common,
  summary: "Reset the event's shared element positions to the built-in ones",
  description: "Layout elements that share their position move back to the built-in Full frame boxes.",
  request: { params: eventSlugParamsSchema },
  responses: {
    ...ok("The event's layouts and shared positions after the reset", eventLiveOverlayLayoutsResponseSchema),
    ...authErrors({ notFound: "Event not found" }),
  },
};
