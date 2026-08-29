import {
  GroupEventEmailCampaignCreate,
  GroupEventEmailCampaignPreviewCreate,
} from "./[groupId]/events/[eventId]/email-campaigns";

type GroupEventEmailCampaignRouter = {
  post(path: string, route: unknown): unknown;
};

export function registerGroupEventEmailCampaignRoutes(openapi: unknown): void {
  const router = openapi as GroupEventEmailCampaignRouter;
  router.post("/:groupId/events/:eventId/email/campaigns/previews", GroupEventEmailCampaignPreviewCreate);
  router.post("/:groupId/events/:eventId/email/campaigns", GroupEventEmailCampaignCreate);
}
