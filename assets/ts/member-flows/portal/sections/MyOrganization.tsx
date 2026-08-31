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
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { getJson, postJson, deleteJson, ApiClientError } from "../../../shared/api-client";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { confirmAction } from "../../../components/ConfirmDialog";
import { Pager } from "../../../components/Pager";
import { useApiPage } from "../../../hooks/useApiPage";
import { profile as profileSignal } from "../state";
import { toast, fmt } from "../ui";
import type { MyOrganizationProfile, MyOrganizationReview } from "../types";
import { linksToText, textToLinks } from "../../../shared/links-text";
import type { z } from "zod";
import { uploadFile } from "../../../shared/file-upload";
import { ORGANIZATION_CONTENT_FIELD_LABELS } from "../../../shared/organization-content";
import { successResponseSchema } from "../../../../shared/schemas/api-common";
import {
  organizationContentReviewCreateResponseSchema,
  organizationContentReviewsListResponseSchema,
  organizationLogoReviewResponseSchema,
  organizationMemberProfileResponseSchema,
} from "../../../../shared/schemas/organization-self-service";
import { OrganizationGovernanceCard, OrganizationSponsorshipCard } from "./MyOrganizationGovernance";
import { Badge } from "../../../components/Badge";

export { RepresentativeSelect } from "./MyOrganizationGovernance";

const organizationPath = (organizationId: string) => `/api/v1/organizations/${encodeURIComponent(organizationId)}`;

const URL_FIELD_ORDER = ["website", "blogUrl", "blogFeedUrl", "pressUrl", "pressFeedUrl", "careersUrl"] as const;

function LogoUploader({
  organizationId,
  org,
  reload,
}: {
  organizationId: string;
  org: MyOrganizationProfile;
  reload: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File): Promise<void> {
    setBusy(true);
    try {
      await uploadFile(
        `${organizationPath(organizationId)}/logo`,
        file,
        organizationLogoReviewResponseSchema,
        "Could not upload the organization logo.",
      );
      toast("Logo submitted for review", "success");
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <label class="btn btn-sm btn-outline-primary w-100 mb-1">
        {busy ? "Uploading…" : "Change logo (SVG)"}
        <input
          ref={fileRef}
          type="file"
          accept="image/svg+xml"
          class="d-none"
          disabled={busy}
          onChange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
      {org.pendingReview?.hasLogoChange && <div class="form-text text-warning mb-0">New logo pending review</div>}
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
  const links = URL_FIELD_ORDER.filter((key) => org[key]);

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">{org.name}</div>
      <div class="card-body">
        <div class="row g-4">
          <div class="col-md-3 text-center">
            {org.logoUrl ? (
              <img
                src={org.logoUrl}
                alt={`${org.name} logo`}
                class="img-fluid border rounded p-2 bg-white mb-2 portal-organization-logo"
              />
            ) : (
              <div class="d-flex align-items-center justify-content-center border rounded bg-light text-muted mb-2 portal-organization-logo-placeholder">
                No logo
              </div>
            )}
            {org.isOrgContact && <LogoUploader organizationId={organizationId} org={org} reload={reload} />}
          </div>
          <div class="col-md-9">
            {org.slogan && <p class="fst-italic text-muted mb-2">{org.slogan}</p>}
            {org.description && <p class="mb-2">{org.description}</p>}
            {links.length > 0 && (
              <dl class="row small mb-0">
                {links.map((key) => (
                  <Fragment key={key}>
                    <dt class="col-sm-3">{ORGANIZATION_CONTENT_FIELD_LABELS[key]}</dt>
                    <dd class="col-sm-9">
                      <a href={org[key] as string} target="_blank" rel="noreferrer">
                        {org[key]}
                      </a>
                    </dd>
                  </Fragment>
                ))}
              </dl>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PendingReviewBanner({
  review,
  organizationId,
  onWithdrawn,
}: {
  review: MyOrganizationReview;
  organizationId: string;
  onWithdrawn: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const fields = Object.entries(review.proposedChanges);

  async function withdraw(): Promise<void> {
    const confirmed = await confirmAction({
      title: "Withdraw this pending submission?",
      body: `Submitted ${fmt(review.submittedAt)}, still awaiting staff review.`,
      consequences: ["The proposed changes are discarded", "You can submit new changes at any time"],
      confirmLabel: "Withdraw submission",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await deleteJson(
        `${organizationPath(organizationId)}/content/reviews/${encodeURIComponent(review.id)}`,
        successResponseSchema,
      );
      toast("Submission withdrawn", "success");
      await onWithdrawn();
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Could not withdraw.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="alert alert-info mb-0">
      <p class="mb-2 fw-semibold">A content change is pending staff review — submitted {fmt(review.submittedAt)}.</p>
      {review.hasLogoChange && <p class="mb-2 small">Includes a new logo.</p>}
      {fields.length > 0 && (
        <ul class="small mb-3">
          {fields.map(([field, value]) => (
            <li key={field}>
              <strong>{ORGANIZATION_CONTENT_FIELD_LABELS[field] ?? field}:</strong>{" "}
              {value === null || value === "" || (Array.isArray(value) && value.length === 0) ? (
                <em>(cleared)</em>
              ) : Array.isArray(value) ? (
                value.join(", ")
              ) : (
                String(value)
              )}
            </li>
          ))}
        </ul>
      )}
      <button type="button" class="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => void withdraw()}>
        {busy ? "Withdrawing…" : "Withdraw submission"}
      </button>
    </div>
  );
}

type EditableField = (typeof URL_FIELD_ORDER)[number] | "slogan" | "description" | "contentMarkdown";

function ContentEditForm({
  organizationId,
  org,
  reload,
}: {
  organizationId: string;
  org: MyOrganizationProfile;
  reload: () => Promise<void>;
}) {
  const initial = useMemo<Record<EditableField, string>>(
    () => ({
      slogan: org.slogan ?? "",
      description: org.description ?? "",
      contentMarkdown: org.contentMarkdown ?? "",
      website: org.website ?? "",
      blogUrl: org.blogUrl ?? "",
      blogFeedUrl: org.blogFeedUrl ?? "",
      pressUrl: org.pressUrl ?? "",
      pressFeedUrl: org.pressFeedUrl ?? "",
      careersUrl: org.careersUrl ?? "",
    }),
    [org],
  );
  const initialLinksText = useMemo(() => linksToText(org.links), [org]);
  const [form, setForm] = useState(initial);
  const [linksText, setLinksText] = useState(initialLinksText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setForm(initial), [initial]);
  useEffect(() => setLinksText(initialLinksText), [initialLinksText]);

  function setField(key: EditableField, value: string): void {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    setError(null);

    const changes: Record<string, string | string[] | null> = {};
    for (const key of Object.keys(initial) as EditableField[]) {
      const next = form[key].trim();
      const prev = initial[key].trim();
      if (next !== prev) changes[key] = next === "" ? null : next;
    }
    if (linksText.trim() !== initialLinksText.trim()) {
      changes.links = textToLinks(linksText);
    }
    if (Object.keys(changes).length === 0) {
      setError("No changes to submit.");
      return;
    }

    setSaving(true);
    try {
      await postJson(
        `${organizationPath(organizationId)}/content/reviews`,
        changes,
        organizationContentReviewCreateResponseSchema,
      );
      toast("Submitted for staff review", "success");
      await reload();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not submit your changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <p class="text-muted small">
        Changes are queued for staff review — your organization's public page won't update until they're approved.
      </p>
      <div class="row g-3">
        <div class="col-12">
          <label class="form-label fw-semibold small">Slogan</label>
          <input
            class="form-control"
            value={form.slogan}
            onInput={(e) => setField("slogan", (e.target as HTMLInputElement).value)}
            disabled={saving}
          />
        </div>
        <div class="col-12">
          <label class="form-label fw-semibold small">Description</label>
          <textarea
            class="form-control"
            rows={3}
            value={form.description}
            onInput={(e) => setField("description", (e.target as HTMLTextAreaElement).value)}
            disabled={saving}
          />
        </div>
        <div class="col-12">
          <label class="form-label fw-semibold small">Long-form content (Markdown)</label>
          <textarea
            class="form-control"
            rows={6}
            value={form.contentMarkdown}
            onInput={(e) => setField("contentMarkdown", (e.target as HTMLTextAreaElement).value)}
            disabled={saving}
          />
        </div>
        {URL_FIELD_ORDER.map((key) => (
          <div class="col-sm-6" key={key}>
            <label class="form-label fw-semibold small">{ORGANIZATION_CONTENT_FIELD_LABELS[key]}</label>
            <input
              type="url"
              class="form-control"
              placeholder="https://…"
              value={form[key]}
              onInput={(e) => setField(key, (e.target as HTMLInputElement).value)}
              disabled={saving}
            />
          </div>
        ))}
        <div class="col-12">
          <label class="form-label fw-semibold small">Links (X, LinkedIn, Facebook, etc — one URL per line)</label>
          <textarea
            class="form-control"
            rows={4}
            placeholder="https://…"
            value={linksText}
            onInput={(e) => setLinksText((e.target as HTMLTextAreaElement).value)}
            disabled={saving}
          />
        </div>
      </div>

      {error && <ErrorAlert error={error} />}

      <button type="submit" class="btn btn-success mt-3" disabled={saving}>
        {saving ? "Submitting…" : "Submit for review"}
      </button>
    </form>
  );
}

function ContentEditorCard({
  organizationId,
  org,
  reload,
}: {
  organizationId: string;
  org: MyOrganizationProfile;
  reload: () => Promise<void>;
}) {
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Edit organization content</div>
      <div class="card-body">
        {org.pendingReview ? (
          <PendingReviewBanner review={org.pendingReview} organizationId={organizationId} onWithdrawn={reload} />
        ) : (
          <ContentEditForm organizationId={organizationId} org={org} reload={reload} />
        )}
      </div>
    </div>
  );
}

function ReviewHistoryCard({ organizationId }: { organizationId: string }) {
  const history = useApiPage<z.infer<typeof organizationContentReviewsListResponseSchema>>(
    `${organizationPath(organizationId)}/content/reviews`,
    { status: "history", sort: "-submittedAt" },
    organizationContentReviewsListResponseSchema,
    (data) => data.reviews,
  );
  const reviews = history.data?.reviews ?? [];

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Submission history</div>
      <div class="card-body">
        {history.loading ? (
          <Spinner label="Loading submission history…" />
        ) : history.error ? (
          <ErrorAlert
            error={history.error instanceof Error ? history.error.message : "Could not load submission history."}
          />
        ) : reviews.length === 0 ? (
          <p class="text-muted small mb-0">No past submissions.</p>
        ) : (
          <>
            <ul class="list-group list-group-flush">
              {reviews.map((review: MyOrganizationReview) => (
                <li key={review.id} class="list-group-item px-0">
                  <div class="d-flex justify-content-between align-items-center">
                    <Badge status={review.status} />
                    <span class="text-muted small">{fmt(review.submittedAt)}</span>
                  </div>
                  {review.reviewerNote && <p class="small text-muted mb-0 mt-1">{review.reviewerNote}</p>}
                </li>
              ))}
            </ul>
            {history.pagerProps && <Pager {...history.pagerProps} />}
          </>
        )}
      </div>
    </div>
  );
}

export function MyOrganization({ organizationId: requestedOrganizationId }: { organizationId?: string } = {}) {
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

  if (loading) return <Spinner label="Loading your organization…" />;
  if (error) {
    return errorCode === "NO_ORGANIZATION" ? <div class="alert alert-info">{error}</div> : <ErrorAlert error={error} />;
  }
  if (!org || !organizationId) return null;

  return (
    <div class="d-flex flex-column gap-3 content-width-lg">
      <OrganizationProfileCard organizationId={organizationId} org={org} reload={reload} />
      {org.isOrgContact && <ContentEditorCard organizationId={organizationId} org={org} reload={reload} />}
      {org.isOrgContact && (
        <ReviewHistoryCard organizationId={organizationId} key={org.pendingReview?.id ?? "no-pending-review"} />
      )}
      <OrganizationGovernanceCard organizationId={organizationId} org={org} reload={reload} />
      <OrganizationSponsorshipCard organizationId={organizationId} />
    </div>
  );
}
