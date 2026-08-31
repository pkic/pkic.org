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
import { friendlyErrorMessage } from "../../../components/ErrorAlert";
import { confirmAction } from "../../../components/ConfirmDialog";
import { statusLabel } from "../../../components/Badge";
import type { PagerProps as OffsetPagerProps } from "../../../components/Pager";
import { Alert } from "../../../ui/Alert";
import { Badge, type BadgeTone } from "../../../ui/Badge";
import { Button } from "../../../ui/Button";
import { DataTable, type DataTableColumn } from "../../../ui/DataTable";
import { EmptyState } from "../../../ui/EmptyState";
import { Field } from "../../../ui/Field";
import { Pager } from "../../../ui/Pager";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { Spinner } from "../../../ui/Spinner";
import { TextInput, Textarea } from "../../../ui/TextControl";
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

export { IdentitySelect } from "./MyOrganizationGovernance";

const organizationPath = (organizationId: string) => `/api/v1/organizations/${encodeURIComponent(organizationId)}`;

const URL_FIELD_ORDER = ["website", "blogUrl", "blogFeedUrl", "pressUrl", "pressFeedUrl", "careersUrl"] as const;

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
 * The canonical error sentence, rendered by the design system.
 * `friendlyErrorMessage` stays the one place transport phrasing becomes
 * English; only the surface that shows it moves here, because the shared
 * `ErrorAlert` is still Bootstrap markup.
 */
function ErrorNotice({ error }: { error: string | Error }) {
  return <Alert tone="danger">{friendlyErrorMessage(error instanceof Error ? error.message : error)}</Alert>;
}

/**
 * The shared offset-pager state, as the design system's Pager reads it. The
 * hook still speaks the older prev/next/page-size shape, so translating once
 * here keeps that conversion out of the markup.
 */
function pagerViewProps(props: OffsetPagerProps, label: string) {
  return {
    page: props.page,
    pageCount: props.total > 0 ? Math.max(1, Math.ceil(props.total / props.pageSize)) : props.page,
    total: props.total,
    rangeStart: props.rowCount === 0 ? 0 : props.offset + 1,
    rangeEnd: props.offset + props.rowCount,
    onSelect: props.onJump,
    label,
  };
}

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
    <div class="pk-stack pk-stack--tight">
      {/* The button is the control and the file input is opened through it, so
          there is one focusable thing carrying one accessible name — rather
          than a label wrapping an input that a utility class has hidden. */}
      <Button variant="secondary" size="sm" block loading={busy} onClick={() => fileRef.current?.click()}>
        {busy ? "Uploading…" : "Change logo (SVG)"}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/svg+xml"
        hidden
        disabled={busy}
        onChange={(e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) void upload(file);
        }}
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
  const links = URL_FIELD_ORDER.filter((key) => org[key]);

  return (
    <Panel>
      <PanelHeader title={org.name} />
      <PanelBody class="pk-grid pk-grid--tight">
        <div class="pk-stack pk-stack--snug">
          {org.logoUrl ? (
            <img src={org.logoUrl} alt={`${org.name} logo`} class="portal-organization-logo" />
          ) : (
            <div class="pk-framed pk-cluster pk-cluster--center pk-muted pk-small portal-organization-logo-placeholder">
              No logo
            </div>
          )}
          {org.isOrgContact && <LogoUploader organizationId={organizationId} org={org} reload={reload} />}
        </div>
        <div class="pk-stack pk-stack--snug">
          {org.slogan && <p class="pk-lede">{org.slogan}</p>}
          {org.description && <p>{org.description}</p>}
          {links.length > 0 && (
            <dl class="pk-datalist pk-small">
              {links.map((key) => (
                <Fragment key={key}>
                  <dt>{ORGANIZATION_CONTENT_FIELD_LABELS[key]}</dt>
                  <dd class="pk-break">
                    <a href={org[key] as string} target="_blank" rel="noreferrer">
                      {org[key]}
                    </a>
                  </dd>
                </Fragment>
              ))}
            </dl>
          )}
        </div>
      </PanelBody>
    </Panel>
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
    <Alert tone="info" title={`A content change is pending staff review — submitted ${fmt(review.submittedAt)}.`}>
      <div class="pk-stack pk-stack--snug">
        {review.hasLogoChange && <p class="pk-small">Includes a new logo.</p>}
        {fields.length > 0 && (
          <ul class="pk-stack pk-stack--tight pk-small">
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
        <div class="pk-cluster">
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void withdraw()}>
            {busy ? "Withdrawing…" : "Withdraw submission"}
          </Button>
        </div>
      </div>
    </Alert>
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
    <form onSubmit={(e) => void handleSubmit(e)} class="pk-stack">
      <p class="pk-muted pk-small">
        Changes are queued for staff review — your organization's public page won't update until they're approved.
      </p>
      <Field label="Slogan">
        {(control) => (
          <TextInput
            {...control}
            value={form.slogan}
            onInput={(e) => setField("slogan", (e.target as HTMLInputElement).value)}
            disabled={saving}
          />
        )}
      </Field>
      <Field label="Description">
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            value={form.description}
            onInput={(e) => setField("description", (e.target as HTMLTextAreaElement).value)}
            disabled={saving}
          />
        )}
      </Field>
      <Field label="Long-form content (Markdown)">
        {(control) => (
          <Textarea
            {...control}
            rows={6}
            value={form.contentMarkdown}
            onInput={(e) => setField("contentMarkdown", (e.target as HTMLTextAreaElement).value)}
            disabled={saving}
          />
        )}
      </Field>
      <div class="pk-grid">
        {URL_FIELD_ORDER.map((key) => (
          <Field key={key} label={ORGANIZATION_CONTENT_FIELD_LABELS[key]}>
            {(control) => (
              <TextInput
                {...control}
                type="url"
                placeholder="https://…"
                value={form[key]}
                onInput={(e) => setField(key, (e.target as HTMLInputElement).value)}
                disabled={saving}
              />
            )}
          </Field>
        ))}
      </div>
      <Field label="Links (X, LinkedIn, Facebook, etc — one URL per line)">
        {(control) => (
          <Textarea
            {...control}
            rows={4}
            placeholder="https://…"
            value={linksText}
            onInput={(e) => setLinksText((e.target as HTMLTextAreaElement).value)}
            disabled={saving}
          />
        )}
      </Field>

      {error && <ErrorNotice error={error} />}

      <div class="pk-cluster">
        <Button type="submit" variant="primary" loading={saving}>
          {saving ? "Submitting…" : "Submit for review"}
        </Button>
      </div>
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
    <Panel>
      <PanelHeader title="Edit organization content" />
      <PanelBody>
        {org.pendingReview ? (
          <PendingReviewBanner review={org.pendingReview} organizationId={organizationId} onWithdrawn={reload} />
        ) : (
          <ContentEditForm organizationId={organizationId} org={org} reload={reload} />
        )}
      </PanelBody>
    </Panel>
  );
}

const REVIEW_HISTORY_COLUMNS: ReadonlyArray<DataTableColumn<MyOrganizationReview>> = [
  {
    id: "status",
    header: "Status",
    cell: (review) => <Badge tone={REVIEW_STATUS_TONE[review.status]}>{statusLabel(review.status)}</Badge>,
  },
  { id: "submittedAt", header: "Submitted", cell: (review) => fmt(review.submittedAt) },
  { id: "reviewerNote", header: "Reviewer note", cell: (review) => review.reviewerNote ?? "—" },
];

function ReviewHistoryCard({ organizationId }: { organizationId: string }) {
  const history = useApiPage<z.infer<typeof organizationContentReviewsListResponseSchema>>(
    `${organizationPath(organizationId)}/content/reviews`,
    { status: "history", sort: "-submittedAt" },
    organizationContentReviewsListResponseSchema,
    (data) => data.reviews,
  );
  const reviews = history.data?.reviews ?? [];

  return (
    <Panel>
      <PanelHeader title="Submission history" />
      <PanelBody class="pk-stack pk-stack--snug">
        {history.error ? (
          <ErrorNotice error={history.error instanceof Error ? history.error : "Could not load submission history."} />
        ) : (
          <>
            <DataTable
              caption="Organization content submissions"
              columns={REVIEW_HISTORY_COLUMNS}
              rows={reviews}
              rowKey={(review) => review.id}
              loading={history.loading}
              empty={
                <EmptyState
                  title="No past submissions."
                  body="Content changes submitted for staff review are listed here once they have been decided."
                />
              }
            />
            {history.pagerProps && reviews.length > 0 && (
              <Pager {...pagerViewProps(history.pagerProps, "Submission history pages")} />
            )}
          </>
        )}
      </PanelBody>
    </Panel>
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

  if (loading) {
    return (
      <div class="pk">
        <Spinner label="Loading your organization…" />
      </div>
    );
  }
  if (error) {
    return (
      <div class="pk">
        {errorCode === "NO_ORGANIZATION" ? <Alert tone="info">{error}</Alert> : <ErrorNotice error={error} />}
      </div>
    );
  }
  if (!org || !organizationId) return null;

  return (
    <div class="pk pk-stack content-width-lg">
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
