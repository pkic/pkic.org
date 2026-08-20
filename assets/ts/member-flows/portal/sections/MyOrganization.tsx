/**
 * My Organization — content editor + moderation status + logo upload +
 * voting delegate + secondary-contact nomination + sponsorship view.
 * GET /api/v1/me/organization is available to any
 * org-tied member (read-only for non-contacts); submitting a content
 * change or logo is restricted to the primary/secondary contact
 * (org.isOrgContact), secondary-contact nomination to the primary contact
 * alone (org.isPrimaryContact) — mirrors the 403s the backend already
 * enforces in organization-content-reviews.ts / member-organization.ts.
 */
import { Fragment } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { getJson, patchJson, deleteJson, ApiClientError } from "../../../shared/api-client";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { profile as profileSignal } from "../state";
import { toast, fmt } from "../ui";
import type { MyOrganizationProfile, MyOrganizationReview, MyOrganizationSponsorship } from "../types";
import { linksToText, textToLinks } from "../../../shared/links-text";

const FIELD_LABELS: Record<string, string> = {
  slogan: "Slogan",
  description: "Description",
  contentMarkdown: "Long-form content",
  website: "Website",
  blogUrl: "Blog URL",
  blogFeedUrl: "Blog feed URL",
  pressUrl: "Press URL",
  pressFeedUrl: "Press feed URL",
  careersUrl: "Careers URL",
  links: "Links",
};

const URL_FIELD_ORDER = ["website", "blogUrl", "blogFeedUrl", "pressUrl", "pressFeedUrl", "careersUrl"] as const;

function reviewStatusBadgeClass(status: string): string {
  switch (status) {
    case "approved":
      return "text-bg-success";
    case "rejected":
      return "text-bg-danger";
    case "withdrawn":
      return "text-bg-secondary";
    default:
      return "text-bg-info";
  }
}

function LogoUploader({ org, reload }: { org: MyOrganizationProfile; reload: () => Promise<void> }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/v1/me/organization/logo", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
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
        {busy ? "Uploading…" : "Change logo"}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
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

function OrganizationProfileCard({ org, reload }: { org: MyOrganizationProfile; reload: () => Promise<void> }) {
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
            {org.isOrgContact && <LogoUploader org={org} reload={reload} />}
          </div>
          <div class="col-md-9">
            {org.slogan && <p class="fst-italic text-muted mb-2">{org.slogan}</p>}
            {org.description && <p class="mb-2">{org.description}</p>}
            {links.length > 0 && (
              <dl class="row small mb-0">
                {links.map((key) => (
                  <Fragment key={key}>
                    <dt class="col-sm-3">{FIELD_LABELS[key]}</dt>
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
  onWithdrawn,
}: {
  review: MyOrganizationReview;
  onWithdrawn: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const fields = Object.entries(review.proposedChanges);

  async function withdraw(): Promise<void> {
    if (!confirm("Withdraw this pending submission?")) return;
    setBusy(true);
    try {
      await deleteJson(`/api/v1/me/organization/reviews/${review.id}`);
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
              <strong>{FIELD_LABELS[field] ?? field}:</strong>{" "}
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

function ContentEditForm({ org, reload }: { org: MyOrganizationProfile; reload: () => Promise<void> }) {
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
      await patchJson("/api/v1/me/organization", changes);
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
            <label class="form-label fw-semibold small">{FIELD_LABELS[key]}</label>
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

function ContentEditorCard({ org, reload }: { org: MyOrganizationProfile; reload: () => Promise<void> }) {
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Edit organization content</div>
      <div class="card-body">
        {org.pendingReview ? (
          <PendingReviewBanner review={org.pendingReview} onWithdrawn={reload} />
        ) : (
          <ContentEditForm org={org} reload={reload} />
        )}
      </div>
    </div>
  );
}

function ReviewHistoryCard({ reviews }: { reviews: MyOrganizationReview[] | null }) {
  const past = (reviews ?? []).filter((r) => r.status !== "pending");

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Submission history</div>
      <div class="card-body">
        {reviews === null ? (
          <Spinner />
        ) : past.length === 0 ? (
          <p class="text-muted small mb-0">No past submissions.</p>
        ) : (
          <ul class="list-group list-group-flush">
            {past.map((r) => (
              <li key={r.id} class="list-group-item px-0">
                <div class="d-flex justify-content-between align-items-center">
                  <span class={`badge text-capitalize ${reviewStatusBadgeClass(r.status)}`}>{r.status}</span>
                  <span class="text-muted small">{fmt(r.submittedAt)}</span>
                </div>
                {r.reviewerNote && <p class="small text-muted mb-0 mt-1">{r.reviewerNote}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function VotingDelegateSection({ org, reload }: { org: MyOrganizationProfile; reload: () => Promise<void> }) {
  const reps = profileSignal.value?.organizationRepresentatives ?? [];
  const [value, setValue] = useState(org.votingDelegateUserId ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(org.votingDelegateUserId ?? ""), [org.votingDelegateUserId]);

  async function handleChange(next: string): Promise<void> {
    setValue(next);
    setSaving(true);
    try {
      await patchJson("/api/v1/me/organization/voting-delegate", { userId: next || null });
      toast("Voting delegate updated", "success");
      await reload();
    } catch (e) {
      setValue(org.votingDelegateUserId ?? "");
      toast(e instanceof ApiClientError ? e.message : "Could not update voting delegate.", "error");
    } finally {
      setSaving(false);
    }
  }

  const current = reps.find((r) => r.userId === org.votingDelegateUserId);

  return (
    <div>
      <h3 class="h6">Forum vote delegate</h3>
      <p class="text-muted small">
        The member who casts your organization's ballot in forum votes. Defaults to the primary contact if unset.
      </p>
      {org.isOrgContact ? (
        <select
          class="form-select form-select-sm portal-category-select"
          value={value}
          disabled={saving}
          onChange={(e) => void handleChange((e.target as HTMLSelectElement).value)}
        >
          <option value="">Primary contact (default)</option>
          {reps.map((r) => (
            <option key={r.userId} value={r.userId}>
              {r.name ?? r.email}
            </option>
          ))}
        </select>
      ) : (
        <p class="mb-0">{current ? (current.name ?? current.email) : "Primary contact (default)"}</p>
      )}
    </div>
  );
}

function SecondaryContactSection({ org, reload }: { org: MyOrganizationProfile; reload: () => Promise<void> }) {
  const reps = (profileSignal.value?.organizationRepresentatives ?? []).filter((r) => !r.isPrimaryContact);
  const [value, setValue] = useState(org.pendingSecondaryContactUserId ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(org.pendingSecondaryContactUserId ?? ""), [org.pendingSecondaryContactUserId]);

  async function handleChange(next: string): Promise<void> {
    setValue(next);
    setSaving(true);
    try {
      await patchJson("/api/v1/me/organization/secondary-contact", { userId: next || null });
      toast(next ? "Secondary contact nominated — pending staff confirmation" : "Nomination withdrawn", "success");
      await reload();
    } catch (e) {
      setValue(org.pendingSecondaryContactUserId ?? "");
      toast(e instanceof ApiClientError ? e.message : "Could not update nomination.", "error");
    } finally {
      setSaving(false);
    }
  }

  const nominee = reps.find((r) => r.userId === org.pendingSecondaryContactUserId);

  return (
    <div>
      <h3 class="h6">Secondary contact</h3>
      <p class="text-muted small">
        A second representative who can manage the organization profile and forum vote delegate. Nominations are held
        until confirmed by staff.
      </p>
      {org.isPrimaryContact ? (
        <select
          class="form-select form-select-sm portal-representative-select"
          value={value}
          disabled={saving}
          onChange={(e) => void handleChange((e.target as HTMLSelectElement).value)}
        >
          <option value="">None</option>
          {reps.map((r) => (
            <option key={r.userId} value={r.userId}>
              {r.name ?? r.email}
            </option>
          ))}
        </select>
      ) : (
        <p class="mb-0 small">
          {org.pendingSecondaryContactUserId
            ? `Pending: ${nominee?.name ?? nominee?.email ?? "a representative"}`
            : "None pending"}
        </p>
      )}
    </div>
  );
}

function GovernanceCard({ org, reload }: { org: MyOrganizationProfile; reload: () => Promise<void> }) {
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Governance</div>
      <div class="card-body d-flex flex-column gap-4">
        <VotingDelegateSection org={org} reload={reload} />
        <SecondaryContactSection org={org} reload={reload} />
      </div>
    </div>
  );
}

function SponsorshipCard() {
  const [sponsorship, setSponsorship] = useState<MyOrganizationSponsorship | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<MyOrganizationSponsorship>("/api/v1/me/organization/sponsorship")
      .then(setSponsorship)
      .catch((e: unknown) => setError(e instanceof ApiClientError ? e.message : "Could not load sponsorship."));
  }, []);

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Sponsorship</div>
      <div class="card-body">
        {error && <ErrorAlert error={error} />}
        {!sponsorship && !error ? (
          <Spinner />
        ) : sponsorship?.tier ? (
          <p class="mb-0">
            Active <span class="fw-semibold text-capitalize">{sponsorship.tier}</span> sponsor
            {sponsorship.startDate && <> since {new Date(sponsorship.startDate).toLocaleDateString()}</>}.
          </p>
        ) : (
          <p class="text-muted mb-0">Your organization is not currently a consortium sponsor.</p>
        )}
      </div>
    </div>
  );
}

export function MyOrganization() {
  const [org, setOrg] = useState<MyOrganizationProfile | null>(null);
  const [reviews, setReviews] = useState<MyOrganizationReview[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [orgData, reviewsData] = await Promise.all([
        getJson<MyOrganizationProfile>("/api/v1/me/organization"),
        getJson<{ reviews: MyOrganizationReview[] }>("/api/v1/me/organization/reviews"),
      ]);
      setOrg(orgData);
      setReviews(reviewsData.reviews);
      setError(null);
      setErrorCode(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load your organization.");
      setErrorCode(e instanceof ApiClientError ? e.code : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) return <Spinner />;
  if (error) {
    return errorCode === "NO_ORGANIZATION" ? <div class="alert alert-info">{error}</div> : <ErrorAlert error={error} />;
  }
  if (!org) return null;

  return (
    <div class="d-flex flex-column gap-3 content-width-lg">
      <OrganizationProfileCard org={org} reload={reload} />
      {org.isOrgContact && <ContentEditorCard org={org} reload={reload} />}
      {org.isOrgContact && <ReviewHistoryCard reviews={reviews} />}
      <GovernanceCard org={org} reload={reload} />
      <SponsorshipCard />
    </div>
  );
}
