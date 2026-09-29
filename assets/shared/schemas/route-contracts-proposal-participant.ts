import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { requiresSession } from "./route-contract";
import * as publicRoutes from "./route-contracts-public-proposals";
import {
  proposalAccessSpeakerHeadshotDeleteRouteSchema,
  proposalAccessSpeakerHeadshotGetRouteSchema,
  proposalAccessSpeakerHeadshotPutRouteSchema,
  proposalSpeakerHeadshotDeleteRouteSchema,
  proposalSpeakerHeadshotGetRouteSchema,
  proposalSpeakerHeadshotPutRouteSchema,
} from "./route-contracts-headshots";
import { speakerPresentationDownloadRouteSchema, speakerPresentationUploadRouteSchema } from "./speaker-self-service";

const proposalParams = z.object({ proposalId: databaseIdSchema });
const speakerParams = proposalParams.extend({ userId: databaseIdSchema });

function sessionRoute<Schema extends { request: { params: z.ZodObject } }, Params extends z.ZodObject>(
  schema: Schema,
  params: Params,
) {
  return { ...schema, ...requiresSession(), request: { ...schema.request, params } };
}

export const participantSubmissionRead = sessionRoute(publicRoutes.proposalAccessReadRouteSchema, proposalParams);
export const participantSubmissionUpdate = sessionRoute(publicRoutes.proposalAccessPatchRouteSchema, proposalParams);
export const participantSpeakerInvite = sessionRoute(
  publicRoutes.proposalAccessCoSpeakerCreateRouteSchema,
  proposalParams,
);
export const participantSpeakerUpdate = sessionRoute(publicRoutes.proposalAccessSpeakerPatchRouteSchema, speakerParams);
export const participantSpeakerRemove = sessionRoute(
  publicRoutes.proposalAccessSpeakerDeleteRouteSchema,
  speakerParams,
);
export const participantSpeakerRemind = sessionRoute(
  publicRoutes.proposalAccessSpeakerReminderCreateRouteSchema,
  speakerParams,
);
export const participantSpeakerPhotoRead = sessionRoute(proposalAccessSpeakerHeadshotGetRouteSchema, speakerParams);
export const participantSpeakerPhotoUpdate = sessionRoute(proposalAccessSpeakerHeadshotPutRouteSchema, speakerParams);
export const participantSpeakerPhotoDelete = sessionRoute(
  proposalAccessSpeakerHeadshotDeleteRouteSchema,
  speakerParams,
);
export const participantRead = sessionRoute(publicRoutes.proposalSpeakerSelfServiceReadRouteSchema, proposalParams);
export const participantRespond = sessionRoute(publicRoutes.proposalSpeakerParticipationRouteSchema, proposalParams);
export const participantProfileUpdate = sessionRoute(
  publicRoutes.proposalSpeakerProfileUpdateRouteSchema,
  proposalParams,
);
export const participantPhotoRead = sessionRoute(proposalSpeakerHeadshotGetRouteSchema, proposalParams);
export const participantPhotoUpdate = sessionRoute(proposalSpeakerHeadshotPutRouteSchema, proposalParams);
export const participantPhotoDelete = sessionRoute(proposalSpeakerHeadshotDeleteRouteSchema, proposalParams);
export const participantPresentationRead = sessionRoute(speakerPresentationDownloadRouteSchema, proposalParams);
export const participantPresentationUpdate = sessionRoute(speakerPresentationUploadRouteSchema, proposalParams);
