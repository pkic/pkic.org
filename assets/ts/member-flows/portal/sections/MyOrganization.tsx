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
import { useCallback, useEffect, useState } from "preact/hooks";
import { getJson, ApiClientError } from "../../../shared/api-client";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { statusLabel } from "../../../components/Badge";
import { Badge, type BadgeTone } from "../../../ui/Badge";
import { Breadcrumb } from "../../../ui/Breadcrumb";
import { type Column } from "../../../components/Table";
import { EmptyState } from "../../../ui/EmptyState";
import { LinkList } from "../../../ui/LinkList";
import { PageHeader } from "../../../ui/PageHeader";
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
import { OrganizationRepresentatives } from "./OrganizationRepresentatives";
import "../../../ui/Content.css";

export { IdentitySelect } from "./MyOrganizationGovernance";

/**
 * The review lifecycle as tones. Written out per status rather than derived
 * from a colour name, so adding a status is a compile error here instead of a
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
    <div class="pk-stack pk-stack--tight">
      <PictureTile
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
      {org.pendingReview?.hasLogoChange && <p class="pk-small pk-warning-note">New logo pending review</p>}
    </div>
  );
}

function OrganizationProfileCard({
  organizationId,
  org,
  reload,
}: {
  organizationId: string;
  org: MyOrganizationProfile;
  reload: () => Promise<void>;
}) {
  const addressRows = ORGANIZATION_URL_FIELD_ORDER.filter((key) => org[key]);
  const hasWords = Boolean(org.slogan || org.description || addressRows.length > 0 || org.links.length > 0);

  return (
    <Panel>
      <PanelHeader title="Public profile" />
      {/* Two columns only when there are words to fill the second one — a
          grid cell holding nothing beside the logo read as a half-empty
          layout, which the anatomy forbids. */}
      <PanelBody class={hasWords ? "pk-grid pk-grid--tight" : undefined}>
        <OrganizationProfileLogo organizationId={organizationId} org={org} reload={reload} />
        {hasWords && (
          <div class="pk-stack pk-stack--snug">
            {org.slogan && <p class="pk-lede">{org.slogan}</p>}
            {org.description && <p>{org.description}</p>}
            {addressRows.length > 0 && (
              <dl class="pk-datalist pk-small">
                {addressRows.map((key) => (
                  <Fragment key={key}>
                    <dt>{ORGANIZATION_CONTENT_FIELD_LABELS[key]}</dt>
                    <dd class="pk-break">
                      <a href={org[key] as string} target="_blank" rel="noreferrer">
                        {(org[key] as string).replace(/^https?:\/\//, "")}
                      </a>
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
        )}
      </PanelBody>
    </Panel>
  );
}

const REVIEW_HISTORY_COLUMNS: Array<Column<MyOrganizationReview>> = [
  {
    header: "Status",
    cell: (review) => <Badge tone={REVIEW_STATUS_TONE[review.status]}>{statusLabel(review.status)}</Badge>,
  },
  { header: "Submitted", cell: (review) => fmt(review.submittedAt) },
  { header: "Reviewer note", cell: (review) => review.reviewerNote ?? "—" },
];

function ReviewHistoryCard({ organizationId }: { organizationId: string }) {
  return (
    <Panel>
      <PanelHeader title="Submission history" />
      <ApiDataTable
        caption="Organization content submissions"
        endpoint={`${organizationPath(organizationId)}/content/reviews`}
        params={{ status: "history" }}
        responseSchema={organizationContentReviewsListResponseSchema}
        resolve={(data) => data.reviews}
        resolvePage={(data) => data.page}
        paginate
        initialSort="-submittedAt"
        columns={REVIEW_HISTORY_COLUMNS}
        rowKey={(review) => review.id}
        empty={<EmptyState title="No submissions found" />}
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
  const [org, setOrg] = useState<MyOrganizationProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!organizationId) {
      setOrg(null);
      setError("Your active membership is not tied to an organization.");
      setErrorCode("NO_ORGANIZATION");
      setLoading(false);
      return;
    }
    try {
      const response = await getJson(
        `${organizationPath(organizationId)}/profile`,
        organizationMemberProfileResponseSchema,
      );
      setOrg(response.organization);
      setError(null);
      setErrorCode(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load your organization.");
      setErrorCode(e instanceof ApiClientError ? e.code : null);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) {
    return (
      <div class="pk">
        <Spinner label="Loading your organization…" />
      </div>
    );
  }
  if (error) {
    return (
      <div class="pk pk-stack">
        <PageHeader title="My organization" />
        {errorCode === "NO_ORGANIZATION" ? (
          <EmptyState
            title="Your membership is individual."
            body="You participate in the consortium in your own name rather than for an organization, and everything works just the same. If your organization joins later, its page appears here."
          />
        ) : (
          <ErrorAlert error={error} />
        )}
      </div>
    );
  }
  if (!org || !organizationId) return null;

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
        items={[{ label: "Organizations", href: usePortalHashLocation.hrefs("/organizations") }, { label: org.name }]}
      />
      <PageHeader title={org.name} />
      <OrganizationProfileCard organizationId={organizationId} org={org} reload={reload} />
      {org.isOrgContact && <ContentEditorCard organizationId={organizationId} org={org} reload={reload} />}
      {org.isOrgContact && (
        <ReviewHistoryCard organizationId={organizationId} key={org.pendingReview?.id ?? "no-pending-review"} />
      )}
      {/* Who acts for this organization, on the organization's own page: the
          roster used to sit on the reader's profile, which is a page about a
          person. */}
      <OrganizationRepresentatives organizationId={organizationId} representativeSegment={representativeSegment} />
      <OrganizationGovernanceCard organizationId={organizationId} org={org} reload={reload} />
      <OrganizationSponsorshipCard organizationId={organizationId} />
    </div>
  );
}
