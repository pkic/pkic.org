import { useState } from "preact/hooks";
import type { z } from "zod";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import {
  speakerProfileApprovalSchema,
  speakerProfileApprovalResponseSchema,
  speakerProfileReviewsResponseSchema,
  speakerProfileReviewQuerySchema,
  type SpeakerProfileReview,
} from "../../../../../../../shared/schemas/event-speaker-profile-reviews";
import { formatNumber } from "../../../../../../../shared/format-number";
import type { Column } from "../../../../../../components/Table";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { Dialog } from "../../../../../../ui/Dialog";
import { PersonCell } from "../../../../../../ui/PersonCell";
import { Markdown } from "../../../../../../ui/Markdown";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { RowActions } from "../../../../../../ui/RowActions";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Badge } from "../../../../../../ui/Badge";
import { ExternalLink } from "../../../../../../ui/ExternalLink";

export function speakerProfileReviewColumns(
  canReview: boolean,
  onReview: (profile: SpeakerProfileReview) => void,
): Column<SpeakerProfileReview>[] {
  return [
    {
      header: "Speaker",
      sort: { asc: "displayName", desc: "-displayName" },
      cell: (profile) => (
        <PersonCell
          name={profile.displayName}
          title={profile.jobTitle}
          organization={profile.organizationName}
          avatarSrc={profile.photoUrl}
        />
      ),
    },
    {
      header: "Sessions",
      align: "end",
      width: "fit",
      cell: (profile) => formatNumber(profile.sessionCount),
    },
    {
      header: "Review",
      filter: {
        param: "status",
        options: speakerProfileReviewQuerySchema.shape.status.unwrap().options.map((value) => ({
          value,
          label: { all: "All profiles", pending: "Needs review", approved: "Approved" }[value],
        })),
      },
      cell: (profile) =>
        profile.reviewedAt ? (
          "Approved"
        ) : (
          <Badge tone="warn">{profile.available ? "Needs review" : "Identity unavailable"}</Badge>
        ),
    },
    {
      header: "",
      width: "fit",
      cell: (profile) =>
        canReview && (
          <RowActions
            subject={profile.displayName}
            actions={[
              {
                id: "review",
                label: "Review profile",
                disabled: !profile.available,
                onSelect: () => onReview(profile),
              },
            ]}
          />
        ),
    },
  ];
}

export function ProfileReviewDialog({
  profile,
  snapshot,
  onSaved,
  onClose,
}: {
  profile: SpeakerProfileReview;
  snapshot: AgendaSnapshot;
  onSaved: (snapshot: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const form = useContractForm(speakerProfileApprovalSchema, {
    expectedRevision: snapshot.revision,
    userId: profile.userId,
    identityId: profile.identityId,
    profileDigest: profile.profileDigest,
  });
  async function approve() {
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await postJson(
        `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/speakers/profiles/reviews`,
        checked.data,
        speakerProfileApprovalResponseSchema,
      );
      onSaved(result.agenda);
      onClose();
    } catch (failure) {
      setError(form.refuse(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={`Review speaker profile · ${profile.displayName}`}
      confirmLabel="Approve profile"
      confirmDisabled={busy || !profile.available}
      onConfirm={() => void approve()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      {error && <ErrorAlert error={error} />}
      <div class="pk-stack">
        <PersonCell
          name={profile.displayName}
          title={profile.jobTitle}
          organization={profile.organizationName}
          avatarSrc={profile.photoUrl}
        />
        <DescriptionList
          items={[
            { term: "Sessions", value: formatNumber(profile.sessionCount) },
            {
              term: "Links",
              value: profile.links.length ? (
                <ul>
                  {profile.links.map((link) => (
                    <li key={link}>
                      <ExternalLink href={link}>{link}</ExternalLink>
                    </li>
                  ))}
                </ul>
              ) : null,
            },
          ]}
        />
        {profile.biography ? <Markdown markdown={profile.biography} /> : <p class="pk-muted">No biography provided.</p>}
        <p class="pk-muted">
          Approval covers this profile across the event. Profile changes require another review. Presentations and
          speaker participation are reviewed separately.
        </p>
      </div>
    </Dialog>
  );
}

/** The same server-paged review queue appears beside the agenda's publication action. */
export function SpeakerProfileReviews({
  snapshot,
  onSaved,
}: {
  snapshot: AgendaSnapshot;
  onSaved: (snapshot: AgendaSnapshot) => void;
}) {
  const [selected, setSelected] = useState<SpeakerProfileReview | null>(null),
    [canReview, setCanReview] = useState(false);
  return (
    <>
      <Panel>
        <PanelHeader title="Speaker profiles" />
        <PanelBody>
          <p>
            Review names, affiliations, photos, and biographies once per speaker identity for this event. Changes need
            another review; the published agenda stays unchanged until you approve a replacement.
          </p>
          <ApiDataTable<SpeakerProfileReview, z.infer<typeof speakerProfileReviewsResponseSchema>>
            key={snapshot.revision}
            urlState="speaker-profiles"
            caption="Speaker profile reviews"
            endpoint={`/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/speakers/profiles`}
            responseSchema={speakerProfileReviewsResponseSchema}
            resolve={(response) => response.profiles}
            resolvePage={(response) => response.page}
            onData={(response) => setCanReview(response.canReview)}
            paginate
            initialSort="displayName"
            initialFilters={{ status: "pending" }}
            rowKey={(profile) => `${profile.userId}:${profile.identityId}`}
            searchPlaceholder="Search speakers…"
            columns={speakerProfileReviewColumns(canReview, setSelected)}
          />
        </PanelBody>
      </Panel>
      {selected && (
        <ProfileReviewDialog
          profile={selected}
          snapshot={snapshot}
          onSaved={onSaved}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
