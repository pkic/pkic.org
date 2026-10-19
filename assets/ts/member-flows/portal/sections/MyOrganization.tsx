/**
 * My Organization — content editor + moderation status + logo upload +
 * secondary-contact nomination + sponsorship view.
 * The organization profile resource is available to any
 * org-tied member (read-only for non-contacts); submitting a content
 * change or logo is restricted to the primary/secondary contact
 * (org.isOrgContact), secondary-contact nomination to the primary contact
 * alone (org.isPrimaryContact) — mirrors the 403s the backend already
 * enforces in the organization-content and member-organization services.
 */
import { Fragment } from "preact";
import { useId, useState } from "preact/hooks";
import { useData } from "../../../hooks/useData";
import { getJson } from "../../../shared/api-client";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { statusLabel } from "../../../components/Badge";
import { Badge, type BadgeTone } from "../../../ui/Badge";
import { Breadcrumb } from "../../../ui/Breadcrumb";
import { type Column } from "../../../components/Table";
import { EmptyState } from "../../../ui/EmptyState";
import { LinkList } from "../../../ui/LinkList";
import { PageHeader } from "../../../ui/PageHeader";
import { ProfileHeader } from "../../../ui/ProfileHeader";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { Spinner } from "../../../ui/Spinner";
import { ApiDataTable } from "../../../components/ApiDataTable";
import { PictureTile } from "../../../components/PictureTile";
import { usePortalHashLocation } from "../hash-location";
import { profile as profileSignal } from "../state";
import { toast, fmt } from "../ui";
import type { MyOrganizationProfile, MyOrganizationReview } from "../types";
import { uploadFile } from "../../../shared/file-upload";
import {
  ORGANIZATION_CONTENT_FIELD_LABELS,
  ORGANIZATION_URL_FIELD_ORDER,
  organizationPath,
} from "../../../shared/organization-content";
import {
  organizationContentReviewsListResponseSchema,
  organizationLogoReviewResponseSchema,
  organizationMemberProfileResponseSchema,
} from "../../../../shared/schemas/organization-self-service";
import { OrganizationGovernanceCard, OrganizationSponsorshipCard } from "./MyOrganizationGovernance";
import { ContentEditorCard } from "./MyOrganizationContentEditor";
import { ADD_REPRESENTATIVE_SEGMENT, OrganizationRepresentatives } from "./OrganizationRepresentatives";
import "../../../ui/Content.css";
import { ExternalLink } from "../../../ui/ExternalLink";
import { OrganizationPrivateContactDetails } from "./OrganizationPrivateContactDetails";
import { ProposedChanges, proposedChangeLabels } from "./OrganizationProposedChanges";
import { Button } from "../../../ui/Button";

/**
 * The review lifecycle as tones. Written out per status rather than derived
 * from a color name, so adding a status is a compile error here instead of a
 * silent fall-through to grey.
 */
const REVIEW_STATUS_TONE: Record<MyOrganizationReview["status"], BadgeTone> = {
  pending: "warn",
  approved: "ok",
  rejected: "danger",
  withdrawn: "neutral",
};

/**
 * The organization's logo, as the same tile staff see on the record. A
 * contact's replacement enters review rather than going live, so the tile
 * says so instead of "Logo uploaded", and there is no removal here: a
 * representative proposes a logo, they do not take the public one down.
 */
function OrganizationProfileLogo({
  organizationId,
  org,
  reload,
}: {
  organizationId: string;
  org: MyOrganizationProfile;
  reload: () => Promise<void>;
}) {
  return (
    <PictureTile
      size="mark"
      name={org.name}
      canChange={org.isOrgContact}
      imageUrl={org.logoUrl}
      alt={`${org.name} logo`}
      removeConfirmation="Remove this organization's logo?"
      accept="image/svg+xml"
      hint="SVG only. The new logo is reviewed before it replaces the public one."
      uploadedMessage="Logo submitted for review"
      onUpload={(file) =>
        uploadFile(
          `${organizationPath(organizationId)}/logo`,
          file,
          organizationLogoReviewResponseSchema,
          "Could not upload the organization logo.",
        )
      }
      onChanged={() => void reload()}
      toast={toast}
    />
  );
}

function OrganizationProfileCard({ org }: { org: MyOrganizationProfile }) {
  const addressRows = ORGANIZATION_URL_FIELD_ORDER.filter((key) => org[key]);
  /* The logo and the slogan are the hero's; the panel carries the rest of the
     public profile and is shown only when there is any. */
  if (!org.description && addressRows.length === 0 && org.links.length === 0) return null;

  return (
    <Panel>
      <PanelHeader title="Public profile" />
      <PanelBody>
        <div class="pk-stack pk-stack--snug">
          {org.description && <p>{org.description}</p>}
          {addressRows.length > 0 && (
            <dl class="pk-datalist pk-small">
              {addressRows.map((key) => (
                <Fragment key={key}>
                  <dt>{ORGANIZATION_CONTENT_FIELD_LABELS[key]}</dt>
                  <dd class="pk-break">
                    <ExternalLink href={org[key] as string} external>
                      {(org[key] as string).replace(/^https?:\/\//, "")}
                    </ExternalLink>
                  </dd>
                </Fragment>
              ))}
            </dl>
          )}
          {/* The profile links were editable here and shown nowhere: a
                member could not see what their own public page carries, while
                staff saw the same set as marked badges. Same list, same
                marks. */}
          <LinkList links={org.links} />
        </div>
      </PanelBody>
    </Panel>
  );
}

function ReviewHistoryCard({ organizationId }: { organizationId: string }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const detailId = useId();
  function toggle(id: string): void {
    const next = new Set(expanded);
    if (!next.delete(id)) next.add(id);
    setExpanded(next);
  }
  const columns: Array<Column<MyOrganizationReview>> = [
    {
      header: "Changes",
      width: "primary",
      cell: (review) => (
        <div class="pk-stack pk-stack--tight">
          <span>{proposedChangeLabels(review).join(", ") || "No field changes"}</span>
          <div>
            <Button
              variant="ghost"
              aria-expanded={expanded.has(review.id)}
              aria-controls={expanded.has(review.id) ? `${detailId}-${review.id}` : undefined}
              onClick={() => toggle(review.id)}
            >
              {expanded.has(review.id) ? "Hide changes" : "Show changes"}
            </Button>
          </div>
        </div>
      ),
    },
    {
      header: "Status",
      width: "fit",
      cell: (review) => <Badge tone={REVIEW_STATUS_TONE[review.status]}>{statusLabel(review.status)}</Badge>,
    },
    { header: "Submitted", width: "fit", cell: (review) => fmt(review.submittedAt) },
    { header: "Reviewer note", cell: (review) => review.reviewerNote ?? "—" },
  ];
  return (
    <Panel>
      <PanelHeader title="Profile change history" />
      <ApiDataTable
        urlState="organization-submissions"
        caption="Changes submitted to the organization profile"
        endpoint={`${organizationPath(organizationId)}/content/reviews`}
        params={{ status: "history" }}
        responseSchema={organizationContentReviewsListResponseSchema}
        resolve={(data) => data.reviews}
        resolvePage={(data) => data.page}
        paginate
        initialSort="-submittedAt"
        columns={columns}
        rowKey={(review) => review.id}
        detailRow={(review) =>
          expanded.has(review.id) ? (
            <PanelBody id={`${detailId}-${review.id}`}>
              <ProposedChanges review={review} />
            </PanelBody>
          ) : null
        }
        empty={<EmptyState title="No profile changes submitted yet" />}
      />
    </Panel>
  );
}

export function MyOrganization({
  organizationId: requestedOrganizationId,
  representativeSegment,
}: { organizationId?: string; representativeSegment?: string } = {}) {
  // Any organization the user actively represents may be requested; the
  // backend authorizes by representation and 404s everything else.
  const organizationId = requestedOrganizationId ?? profileSignal.value?.organizationId ?? null;
  const {
    data: org,
    loading,
    error,
    reload,
  } = useData(async () => {
    if (!organizationId) return null;
    const response = await getJson(
      `${organizationPath(organizationId)}/profile`,
      organizationMemberProfileResponseSchema,
    );
    return response.organization;
  }, [organizationId, profileSignal.value?.identityId]);

  if (loading) {
    return (
      <div class="pk">
        <Spinner label="Loading your organization…" />
      </div>
    );
  }
  if (error || !organizationId) {
    return (
      <div class="pk pk-stack">
        <PageHeader title="My organization" />
        {!organizationId ? (
          <EmptyState
            title="Your membership is individual."
            body="You participate in the consortium in your own name rather than for an organization, and everything works just the same. If your organization joins later, its page appears here."
          />
        ) : (
          <ErrorAlert error={error ?? "Could not load your organization."} />
        )}
      </div>
    );
  }
  if (!org || !organizationId) return null;

  const addingRepresentative =
    representativeSegment === ADD_REPRESENTATIVE_SEGMENT &&
    org.isOrgContact &&
    profileSignal.value?.isOrgContact &&
    profileSignal.value.organizationId === organizationId;

  return (
    <div class="pk pk-stack content-width-lg">
      {/*
        The way back, which this page had none of (issue #9). A representative
        arrives here from the list of the organizations they represent, and
        the Organizations sidebar entry is a staff destination they do not
        have — so without the trail this record was where navigation stopped.
        It is the same trail the staff twin of this route renders
        (system-organizations/OrganizationDetail), pointing at the same list.
      */}
      <Breadcrumb
        items={[
          { label: "Organizations", href: usePortalHashLocation.hrefs("/organizations") },
          {
            label: org.name,
            ...(addingRepresentative
              ? { href: usePortalHashLocation.hrefs(`/organizations/${encodeURIComponent(organizationId)}`) }
              : {}),
          },
          ...(addingRepresentative ? [{ label: "Add a coworker" }] : []),
        ]}
      />
      {/* The same hero as the staff record, so this page and every page under
          it (a representative's record) say whose they are. */}
      <ProfileHeader
        media={<OrganizationProfileLogo organizationId={organizationId} org={org} reload={reload} />}
        title={org.name}
        lede={org.slogan ?? undefined}
        facts={org.pendingReview?.hasLogoChange ? ["New logo pending review"] : undefined}
      />
      {addingRepresentative ? (
        <OrganizationRepresentatives organizationId={organizationId} representativeSegment={representativeSegment} />
      ) : (
        <>
          <OrganizationProfileCard org={org} />
          {org.isOrgContact && <ContentEditorCard organizationId={organizationId} org={org} reload={reload} />}
          {org.isOrgContact && (
            <ReviewHistoryCard
              organizationId={organizationId}
              key={`${organizationId}:${org.pendingReview?.id ?? "no-pending-review"}`}
            />
          )}
          {/* Who acts for this organization, on the organization's own page: the
          roster used to sit on the reader's profile, which is a page about a
          person. */}
          <OrganizationRepresentatives organizationId={organizationId} representativeSegment={representativeSegment} />
          <OrganizationGovernanceCard key={organizationId} organizationId={organizationId} org={org} reload={reload} />
          {org.isOrgContact && <OrganizationPrivateContactDetails organizationId={organizationId} canWrite />}
          <OrganizationSponsorshipCard organizationId={organizationId} />
        </>
      )}
    </div>
  );
}
