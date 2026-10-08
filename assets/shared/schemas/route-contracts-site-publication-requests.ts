import { eventSlugParamsSchema } from "./api-common";
import {
  sitePublicationResourceSchema,
  sitePublicationRequestQuerySchema,
  sitePublicationRequestListSchema,
  sitePublicationActivationSchema,
  sitePublicationDeliverySchema,
} from "./site-publication-requests";
import { requiresPermissions, authErrors, ok } from "./route-contract";
export const sitePublicationRequestsRouteSchema = {
  tags: ["Site publication"],
  summary: "List authorized publication requests for one canonical resource",
  ...requiresPermissions("agenda:read"),
  request: { params: sitePublicationResourceSchema, query: sitePublicationRequestQuerySchema },
  responses: {
    ...ok("Publication requests", sitePublicationRequestListSchema),
    ...authErrors({ notFound: "Resource not found" }),
  },
};
export const sitePublicationActivationRouteSchema = {
  tags: ["Site publication"],
  summary: "Record a verified deployment activation receipt",
  ...requiresPermissions("scheduler:manage"),
  request: { body: { content: { "application/json": { schema: sitePublicationActivationSchema } } } },
  responses: {
    ...ok("Current actual delivery", sitePublicationDeliverySchema),
    ...authErrors({ conflict: "Delivery changed or activation receipt does not match the built release" }),
  },
};

export const eventPublicationRequestsRouteSchema = {
  tags: ["Event agenda"],
  summary: "List website delivery requests for this event agenda",
  ...requiresPermissions("agenda:read"),
  request: { params: eventSlugParamsSchema, query: sitePublicationRequestQuerySchema },
  responses: {
    ...ok("Publication requests", sitePublicationRequestListSchema),
    ...authErrors({ notFound: "Event not found" }),
  },
};
