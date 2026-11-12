import { lazy, Suspense } from "preact/compat";
import { useState } from "preact/hooks";
import { Spinner } from "../../../../components/Spinner";
import { useHashQueryParam } from "../../../../hooks/useHashQueryParam";
import { eventMyAgendaPath } from "../../../../../shared/event-participation-link";
/** Event messages are composed on their own page under Communications. */
import { EventEmailCampaign } from "../../../../components/events/EventEmailCampaign";
import { ButtonLink } from "../../../../ui/Button";
import { EmptyState } from "../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { usePortalHashLocation } from "../../hash-location";
import { toast } from "../../ui";

import { NEW_CAMPAIGN_SEGMENT } from "./group-event-paths";
import { promotionMaterialFile } from "../events/detail/agenda/promotion-file-keys";

const PromotionMaterialsDialog = lazy(() =>
  import("../events/detail/agenda/PromotionMaterialsDialog").then((module) => ({
    default: module.PromotionMaterialsDialog,
  })),
);

export function GroupEventCommunications({
  groupId,
  eventId,
  eventSlug,
  composing = false,
  listPath,
}: {
  groupId: string;
  eventId: string;
  eventSlug: string;
  composing?: boolean;
  listPath: string;
}) {
  const [preset] = useHashQueryParam("campaignPreset", "");
  const planning = preset === "session-planning";
  const kits = preset === "speaker-kits";
  const [materialsUserId] = useHashQueryParam("materialsUserId", "");
  const [materialsFiles, setMaterialsFiles] = useHashQueryParam("materialsFiles", "");
  const [reviewing, setReviewing] = useState(false);
  const pickedKeys = materialsFiles.split(",").filter((key) => promotionMaterialFile(key));
  const pickedFiles = pickedKeys.flatMap((key) => promotionMaterialFile(key) ?? []);
  const materials =
    preset === "promotion-materials" && materialsUserId && pickedFiles.length
      ? { userId: materialsUserId, files: pickedFiles, onReview: () => setReviewing(true) }
      : undefined;
  const agendaUrl = new URL(eventMyAgendaPath(eventSlug), window.location.origin).href;
  const [, navigate] = usePortalHashLocation();
  const eventPath = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}`;

  if (composing && preset === "promotion-materials" && !materials) {
    // Never widen a one-person handoff into an audience message.
    return (
      <Panel aria-label="New event message">
        <PanelHeader title="New event message" breadcrumb />
        <PanelBody>
          <EmptyState
            title="These files could not be attached"
            body="The link is missing the person or the files. Open their promotion materials from Registrations and select the files again."
          />
        </PanelBody>
      </Panel>
    );
  }

  if (composing) {
    return (
      <div class="pk-stack">
        <Panel aria-label="New event message">
          <PanelHeader title="New event message" breadcrumb />
          <PanelBody>
            <EventEmailCampaign
              campaignsPath={`${eventPath}/email/campaigns`}
              daysPath={`${eventPath}/days`}
              initialAudience={kits ? "speakers" : "attendees"}
              initialAttachKits={kits}
              materials={materials}
              initialSubject={
                planning
                  ? "Plan your sessions"
                  : kits
                    ? "Your promotion kit for {{sessionTitle}}"
                    : materials
                      ? "Your promotion materials for {{eventName}}"
                      : undefined
              }
              initialBody={
                materials
                  ? `Hi {{firstName}},\n\nWe attached promotion files for {{eventName}} you can share with your network. They carry your personal registration link.\n\nWant another format or different wording? [Open your promotion materials]({{promotionKitUrl}}).`
                  : kits
                    ? `Hi {{firstName}},\n\nYour session {{sessionTitle}} is on the agenda for {{eventName}}. We attached promotion images you can share with your network. They carry your personal registration link.\n\nWant another format or different wording? [Open your promotion kit]({{promotionKitUrl}}).`
                    : planning
                      ? `Please plan the sessions you would like to attend.\n\nSave favorites to show your interest. A favorite does not register you or reserve a place. Register or request approval where the session indicates it; optional registration and invitation-only access remain separate.\n\n[Open My agenda](${agendaUrl})`
                      : undefined
              }
              notify={toast}
              cancelHref={usePortalHashLocation.hrefs(listPath)}
              onSent={() => navigate(listPath)}
            />
          </PanelBody>
        </Panel>
        {materials && reviewing && (
          <Suspense fallback={<Spinner />}>
            <PromotionMaterialsDialog
              slug={eventSlug}
              userId={materials.userId}
              initialSelected={pickedKeys}
              emailLabel="Attach selected"
              onClose={() => setReviewing(false)}
              onEmail={(keys) => {
                setMaterialsFiles(keys.join(","));
                setReviewing(false);
              }}
            />
          </Suspense>
        )}
      </div>
    );
  }

  return (
    <Panel aria-label="Event messages">
      <PanelHeader title="Event messages">
        <ButtonLink variant="primary" href={usePortalHashLocation.hrefs(`${listPath}/${NEW_CAMPAIGN_SEGMENT}`)}>
          New message
        </ButtonLink>
        <ButtonLink
          href={usePortalHashLocation.hrefs(`${listPath}/${NEW_CAMPAIGN_SEGMENT}?campaignPreset=session-planning`)}
        >
          Ask attendees to plan sessions
        </ButtonLink>
        <ButtonLink
          href={usePortalHashLocation.hrefs(`${listPath}/${NEW_CAMPAIGN_SEGMENT}?campaignPreset=speaker-kits`)}
        >
          Email speakers their kits
        </ButtonLink>
      </PanelHeader>
      <PanelBody>
        <EmptyState
          title="Email event participants"
          body="Choose an audience and its filters in the message form, then review the recipients before sending."
        />
      </PanelBody>
    </Panel>
  );
}
