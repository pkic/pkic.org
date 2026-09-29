import {
  eventGrantRoutes,
  formPlacementGrantRoutes,
  mailingListGrantRoutes,
  voteGrantRoutes,
} from "./resource-grant-handlers";

type GroupResourceGrantRouter = {
  get(path: string, route: unknown): unknown;
  post(path: string, route: unknown): unknown;
  delete(path: string, route: unknown): unknown;
};

export function registerGroupResourceGrantRoutes(openapi: unknown): void {
  const router = openapi as GroupResourceGrantRouter;
  router.get("/:groupId/forms/:placementId/grants", formPlacementGrantRoutes.list);
  router.post("/:groupId/forms/:placementId/grants", formPlacementGrantRoutes.create);
  router.delete("/:groupId/forms/:placementId/grants/:granteeGroupId/:capability", formPlacementGrantRoutes.revoke);
  router.get("/:groupId/events/:eventId/grants", eventGrantRoutes.list);
  router.post("/:groupId/events/:eventId/grants", eventGrantRoutes.create);
  router.delete("/:groupId/events/:eventId/grants/:granteeGroupId/:capability", eventGrantRoutes.revoke);
  router.get("/:groupId/votes/:voteId/grants", voteGrantRoutes.list);
  router.post("/:groupId/votes/:voteId/grants", voteGrantRoutes.create);
  router.delete("/:groupId/votes/:voteId/grants/:granteeGroupId/:capability", voteGrantRoutes.revoke);
  router.get("/:groupId/mailing-lists/:listId/grants", mailingListGrantRoutes.list);
  router.post("/:groupId/mailing-lists/:listId/grants", mailingListGrantRoutes.create);
  router.delete("/:groupId/mailing-lists/:listId/grants/:granteeGroupId/:capability", mailingListGrantRoutes.revoke);
}
