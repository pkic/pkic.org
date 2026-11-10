import {
  GroupEventEmailCampaignCreate,
  GroupEventEmailCampaignPreviewCreate,
  GroupSpeakerKitDeliveriesList,
  GroupSpeakerKitTestCreate,
} from "./[groupId]/events/[eventId]/email-campaigns";

type GroupEventEmailCampaignRouter = {
  get(path: string, route: unknown): unknown;
  post(path: string, route: unknown): unknown;
};

export function registerGroupEventEmailCampaignRoutes(openapi: unknown): void {
  const router = openapi as GroupEventEmailCampaignRouter;
  router.post("/:groupId/events/:eventId/email/campaigns/previews", GroupEventEmailCampaignPreviewCreate);
  router.post("/:groupId/events/:eventId/email/campaigns/tests", GroupSpeakerKitTestCreate);
  router.get("/:groupId/events/:eventId/email/campaigns/kits", GroupSpeakerKitDeliveriesList);
  router.post("/:groupId/events/:eventId/email/campaigns", GroupEventEmailCampaignCreate);
}
