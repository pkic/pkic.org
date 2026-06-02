import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Badge } from "../../../../components/Badge";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Markdown } from "../../../../components/Markdown";
import { ProfileLinksInput, type ProfileLinksHandle } from "../../../../components/ProfileLinksInput";
import { DataTable } from "../../../../components/Table";
import { Tabs } from "../../../../components/Tabs";
import { api } from "../../../api";
import { authEmail } from "../../../state";
import { AdminHeadshotManager, ADMIN_HEADSHOT_DISCLAIMER } from "../../../../shared/headshot/AdminHeadshotManager";
import { fmt, toast } from "../../../ui";
import { useData } from "../../../../hooks/useData";
import type {
  ProposalSummary,
  ProposalAccess,
  ProposalReview,
  ProposalSpeaker,
  AdminFormDetailField,
} from "../../../types";
import { FormAnswerTable } from "./FormResponses";
import { normalizeProfileLinks } from "../../profile-links";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProposalDetailRecord extends ProposalSummary {
  details?: Record<string, unknown> | null;
}

interface ProposalFormSummary {
  id: string;
  title: string;
  description: string | null;
  fields: AdminFormDetailField[];
}

interface ProposalResponse {
  proposal: ProposalDetailRecord;
  access: ProposalAccess;
  form: ProposalFormSummary | null;
  minReviewsRequired: number;
}

type DetailTab = "submission" | "speakers" | "reviews" | "audit-log" | "decision";

interface ProposalAuditLogEntry {
  id: string;
  created_at: string;
  actor_type: string;
  actor_display?: string;
  actor_id?: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  details?: Record<string, unknown> | null;
}

interface ProposalInternalComment {
  id: string;
  proposal_id: string;
  author_user_id: string;
  comment: string;
  created_at: string;
  updated_at: string;
  author_email: string | null;
  author_first_name: string | null;
  author_last_name: string | null;
}

interface DecisionPreviewMessage {
  id: string;
  templateKey: string;
  recipientEmail: string;
  recipientLabel: string;
  subject: string;
  html: string;
  text: string;
}

interface DecisionPreviewResponse {
  recipientCount: number;
  emailCount: number;
  messages: DecisionPreviewMessage[];
}

interface AuditDelta {
  from: unknown;
  to: unknown;
}

function isNeedsWorkDecision(value: string): boolean {
  return value === "needs-work";
}

function isAuditDelta(value: unknown): value is AuditDelta {
  return (
    Boolean(value) && typeof value === "object" && "from" in (value as AuditDelta) && "to" in (value as AuditDelta)
  );
}

function auditDeltaMap(details: Record<string, unknown> | null | undefined): Array<[string, AuditDelta]> {
  if (!details) return [];
  return Object.entries(details).filter((entry): entry is [string, AuditDelta] => isAuditDelta(entry[1]));
}

function formatAuditValue(value: unknown): string {
  if (value == null || value === "") return "empty";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((entry) => formatAuditValue(entry)).join(", ") : "empty";
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function renderAuditDetailsMap(details: Record<string, unknown>) {
  const entries = Object.entries(details);
  if (!entries.length) return null;

  return (
    <div class="small text-body-secondary d-flex flex-column gap-1">
      {entries.map(([key, value]) => (
        <div key={key} class="adm-pre-wrap">
          <strong>{key}</strong>
          {": "}
          {isAuditDelta(value)
            ? `${formatAuditValue(value.from)} → ${formatAuditValue(value.to)}`
            : formatAuditValue(value)}
        </div>
      ))}
    </div>
  );
}

function formatProposalAuditAction(entry: ProposalAuditLogEntry): string {
  switch (entry.action) {
    case "proposal_internal_comment_added":
      return "Internal comment added";
    case "proposal_review_upserted": {
      const deltas = auditDeltaMap(entry.details);
      const recommendation = deltas.find(([key]) => key === "recommendation")?.[1];
      const score = deltas.find(([key]) => key === "score")?.[1];
      const created = deltas.length > 0 && deltas.every(([, delta]) => delta.from == null);
      const recommendationLabel =
        typeof recommendation?.to === "string" ? recommendation.to.replace(/-/g, " ") : undefined;
      const scoreLabel = typeof score?.to === "number" ? ` (${score.to}/10)` : "";
      if (recommendationLabel) {
        return `Review ${created ? "created" : "updated"}: ${recommendationLabel}${scoreLabel}`;
      }
      return `Review ${created ? "created" : "updated"}`;
    }
    case "proposal_edited": {
      const deltaFields = auditDeltaMap(entry.details)
        .map(([key]) => key)
        .join(", ");
      const fields = deltaFields || (Array.isArray(entry.details?.fields) ? entry.details.fields.join(", ") : null);
      return fields ? `Proposal updated: ${fields}` : "Proposal updated";
    }
    case "proposal_decision_recorded": {
      const finalStatusDelta = entry.details?.finalStatus;
      const status = isAuditDelta(finalStatusDelta) ? finalStatusDelta.to : finalStatusDelta;
      return typeof status === "string" ? `Decision recorded: ${status.replace(/[_-]/g, " ")}` : "Decision recorded";
    }
    case "proposal_decision_email_queued": {
      const templateDelta = entry.details?.templateKey;
      const template = isAuditDelta(templateDelta) ? templateDelta.to : templateDelta;
      return typeof template === "string"
        ? `Decision email queued: ${template.replace(/_/g, " ")}`
        : "Decision email queued";
    }
    case "speaker_bio_updated":
      return "Speaker bio updated";
    case "speaker_profile_updated":
      return "Speaker profile updated";
    case "speaker_confirmed":
      return "Speaker confirmed participation";
    case "speaker_declined":
      return "Speaker declined participation";
    case "speaker_profile_request_resent":
      return "Speaker profile request resent";
    case "admin_opened_proposal_manage_page":
      return "Opened proposer manage page";
    default:
      return entry.action.replace(/_/g, " ");
  }
}

function renderProposalAuditDetails(entry: ProposalAuditLogEntry) {
  if (!entry.details) return null;
  return renderAuditDetailsMap(entry.details);
}

function AuditLogSection({ proposalId }: { proposalId: string }) {
  const { data: entries, loading } = useData(
    () =>
      api<{ auditLog: ProposalAuditLogEntry[] }>(`/api/v1/admin/proposals/${proposalId}/audit-log`).then(
        (d) => d.auditLog ?? [],
      ),
    [proposalId],
  );

  if (loading) return <Spinner />;
  if (!entries?.length) return <p class="small text-body-secondary mb-0">No audit log entries.</p>;

  return (
    <DataTable
      columns={[
        {
          header: "When",
          cell: (entry) =>
            new Date(entry.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "medium" }),
          className: "text-nowrap small text-muted",
        },
        {
          header: "Actor",
          cell: (entry) => {
            if (entry.actor_type === "system") return <span class="text-muted">System</span>;
            if (entry.actor_display) return entry.actor_display;
            if (entry.actor_id) return <span class="text-muted small">{entry.actor_id}</span>;
            return <span class="text-muted">{entry.actor_type}</span>;
          },
          className: "small",
        },
        {
          header: "Action",
          cell: (entry) => <span class="small">{formatProposalAuditAction(entry)}</span>,
        },
        {
          header: "Details",
          cell: (entry) => renderProposalAuditDetails(entry),
        },
      ]}
      data={entries}
      className="align-middle"
      rowKey={(entry) => entry.id}
    />
  );
}

// ─── Speaker card ─────────────────────────────────────────────────────────────

function SpeakerCard({
  speaker,
  proposalId,
  canEdit,
  onSaved,
}: {
  speaker: ProposalSpeaker;
  proposalId: string;
  canEdit: boolean;
  onSaved: (userId: string, patch: Partial<ProposalSpeaker>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(speaker.firstName ?? "");
  const [lastName, setLastName] = useState(speaker.lastName ?? "");
  const [organizationName, setOrganizationName] = useState(speaker.organizationName ?? "");
  const [jobTitle, setJobTitle] = useState(speaker.jobTitle ?? "");
  const [bio, setBio] = useState(speaker.biography ?? "");
  const [role, setRole] = useState(speaker.role);
  const [saving, setSaving] = useState(false);
  const [headshotStatus, setHeadshotStatus] = useState("");
  const linksRef = useRef<ProfileLinksHandle>(null);

  const name = [speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || speaker.email;

  useEffect(() => {
    setHeadshotStatus("");
    setRole(speaker.role);
    setFirstName(speaker.firstName ?? "");
    setLastName(speaker.lastName ?? "");
    setOrganizationName(speaker.organizationName ?? "");
    setJobTitle(speaker.jobTitle ?? "");
    setBio(speaker.biography ?? "");
    linksRef.current?.setLinks(normalizeProfileLinks(speaker.links));
  }, [speaker.userId, speaker.headshotUrl, speaker.links]);

  useEffect(() => {
    if (!editing) return;
    linksRef.current?.setLinks(normalizeProfileLinks(speaker.links));
  }, [editing, speaker.links]);

  async function uploadHeadshotFile(file: Blob) {
    const headers: Record<string, string> = { "Content-Type": file.type || "image/jpeg" };
    const res = await fetch(`/api/v1/admin/users/${speaker.userId}/headshot`, {
      method: "PUT",
      credentials: "same-origin",
      headers,
      body: file,
    });
    const data = (await res.json().catch(() => ({}))) as {
      headshotUrl?: string;
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);

    const userData = await api<{ user: { headshotUrl: string | null } }>(`/api/v1/admin/users/${speaker.userId}`);
    return { headshotUrl: userData.user.headshotUrl ?? null };
  }

  async function deleteHeadshotFile() {
    await api(`/api/v1/admin/users/${speaker.userId}/headshot`, { method: "DELETE" });
  }

  async function fetchGravatar() {
    setHeadshotStatus("Looking up Gravatar...");
    try {
      await api(`/api/v1/admin/users/${speaker.userId}/gravatar`, { method: "POST" });
      const userData = await api<{ user: { headshotUrl: string | null } }>(`/api/v1/admin/users/${speaker.userId}`);
      toast("Gravatar imported successfully", "success");
      onSaved(speaker.userId, {
        headshotUrl: userData.user.headshotUrl,
        hasHeadshot: Boolean(userData.user.headshotUrl),
      });
      setHeadshotStatus("Gravatar imported");
    } catch (e) {
      const message = (e as Error).message;
      toast(message, "error");
      setHeadshotStatus(`Error: ${message}`);
    }
  }

  async function handleSave(e: Event) {
    e.preventDefault();
    setSaving(true);
    try {
      await api(`/api/v1/admin/proposals/${proposalId}/speakers/${speaker.userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          organizationName: organizationName.trim() || null,
          jobTitle: jobTitle.trim() || null,
          biography: bio.trim() || null,
          links: linksRef.current?.getLinks() ?? [],
          role,
        }),
      });
      const links = linksRef.current?.getLinks() ?? [];
      onSaved(speaker.userId, {
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        organizationName: organizationName.trim() || null,
        jobTitle: jobTitle.trim() || null,
        biography: bio.trim() || null,
        links,
        hasBio: Boolean(bio.trim()),
        role,
      });
      setEditing(false);
      toast("Speaker profile updated", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  const profileLinks = normalizeProfileLinks(speaker.links);

  return (
    <div class="card mb-3">
      <div class="card-body">
        <div class="d-flex gap-3 align-items-start">
          <div class="flex-shrink-0">
            <AdminHeadshotManager
              initialUrl={speaker.headshotUrl ?? null}
              alt={name}
              emptyLabel="User"
              statusText={headshotStatus}
              uploadHeadshot={uploadHeadshotFile}
              deleteHeadshot={deleteHeadshotFile}
              onFetchGravatar={fetchGravatar}
              disclaimerTexts={ADMIN_HEADSHOT_DISCLAIMER}
              onUploaded={(headshotUrl) => {
                onSaved(speaker.userId, { headshotUrl: headshotUrl ?? null, hasHeadshot: Boolean(headshotUrl) });
                toast("Headshot uploaded", "success");
              }}
              onDeleted={() => {
                onSaved(speaker.userId, { headshotUrl: null, hasHeadshot: false });
                toast("Headshot removed", "success");
              }}
              onError={(message) => toast(message, "error")}
              confirmDeleteMessage="Remove this user's headshot?"
            />
          </div>

          {/* Details */}
          <div class="flex-fill min-w-0">
            <div class="d-flex gap-2 align-items-center flex-wrap mb-1">
              <strong>{name}</strong>
              {name !== speaker.email && <span class="text-muted small">{speaker.email}</span>}
              <span class="badge text-bg-secondary text-capitalize">{speaker.role.replace(/_/g, " ")}</span>
              <Badge status={speaker.status} />
            </div>
            {(speaker.organizationName || speaker.jobTitle) && (
              <div class="small text-muted mb-1">
                {[speaker.jobTitle, speaker.organizationName].filter(Boolean).join(" · ")}
              </div>
            )}
            <div class="d-flex gap-2 flex-wrap">
              {speaker.confirmedAt && <span class="small text-success">✓ Confirmed {fmt(speaker.confirmedAt)}</span>}
              {speaker.declinedAt && <span class="small text-danger">✗ Declined {fmt(speaker.declinedAt)}</span>}
            </div>
            {speaker.declineReason && <div class="small text-muted mt-1">Decline reason: {speaker.declineReason}</div>}
            {!editing && speaker.biography && (
              <p class="small text-muted mt-2 mb-0 adm-pre-wrap">{speaker.biography}</p>
            )}
            {!editing && profileLinks.length > 0 && (
              <div class="small mt-2 d-flex flex-column gap-1">
                {profileLinks.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div class="flex-shrink-0 d-flex flex-column gap-1 align-items-end">
            {!speaker.hasBio && <span class="badge text-bg-warning">No bio</span>}
            {!speaker.hasHeadshot && <span class="badge text-bg-warning">No headshot</span>}
            {canEdit && (
              <button class="btn btn-sm btn-outline-secondary" onClick={() => setEditing((v) => !v)}>
                {editing ? "Cancel" : "Edit profile"}
              </button>
            )}
          </div>
        </div>

        {editing && (
          <form onSubmit={(e) => void handleSave(e)} class="mt-3 border-top pt-3">
            <div class="row g-3">
              <div class="col-sm-6">
                <label class="form-label fw-semibold">First name</label>
                <input
                  class="form-control"
                  value={firstName}
                  onInput={(e) => setFirstName((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class="col-sm-6">
                <label class="form-label fw-semibold">Last name</label>
                <input
                  class="form-control"
                  value={lastName}
                  onInput={(e) => setLastName((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class="col-sm-6">
                <label class="form-label fw-semibold">Organisation</label>
                <input
                  class="form-control"
                  value={organizationName}
                  onInput={(e) => setOrganizationName((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class="col-sm-6">
                <label class="form-label fw-semibold">Job title</label>
                <input
                  class="form-control"
                  value={jobTitle}
                  onInput={(e) => setJobTitle((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class="col-12">
                <label class="form-label fw-semibold">Role</label>
                <select
                  class="form-select"
                  value={role}
                  onChange={(e) => setRole((e.target as HTMLSelectElement).value)}
                >
                  <option value="proposer">Proposer</option>
                  <option value="speaker">Speaker</option>
                  <option value="co_speaker">Co-speaker</option>
                  <option value="moderator">Moderator</option>
                  <option value="panelist">Panelist</option>
                </select>
              </div>
              <div class="col-12">
                <label class="form-label fw-semibold">Biography</label>
                <textarea
                  class="form-control"
                  rows={4}
                  value={bio}
                  onInput={(e) => setBio((e.target as HTMLTextAreaElement).value)}
                  placeholder="Speaker biography…"
                />
              </div>
              <div class="col-12">
                <label class="form-label fw-semibold">Profile links</label>
                <ProfileLinksInput ref={linksRef} fieldName={`speakerProfileLink.${speaker.userId}`} max={15} />
              </div>
              <div class="col-12">
                <button type="submit" class="btn btn-primary" disabled={saving}>
                  {saving ? "Saving…" : "Save profile"}
                </button>
                <button type="button" class="btn btn-outline-secondary ms-2" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Review card ──────────────────────────────────────────────────────────────

function ReviewCard({ review }: { review: ProposalReview }) {
  const recColour =
    { accept: "success", reject: "danger", "needs-work": "warning" }[review.recommendation] ?? "secondary";
  const reviewer =
    [review.reviewer_first_name, review.reviewer_last_name].filter(Boolean).join(" ") ||
    review.reviewer_email ||
    review.reviewer_user_id;

  return (
    <div class="card mb-2">
      <div class="card-body py-2 px-3">
        <div class="d-flex gap-2 align-items-center mb-2 flex-wrap">
          <span class={`badge text-bg-${recColour}`}>{review.recommendation}</span>
          {review.score != null && <span class="badge text-bg-light border text-body">Score {review.score}/10</span>}
          <span class="small text-muted">{reviewer}</span>
          <span class="small text-muted ms-auto">{fmt(review.updated_at)}</span>
        </div>
        {review.reviewer_comment && (
          <div class="mb-2">
            <div class="small text-muted fw-semibold mb-1">Internal review notes</div>
            <Markdown markdown={review.reviewer_comment} className="small mb-0" />
          </div>
        )}
        {review.applicant_note && (
          <div class="adm-applicant-note">
            <div class="small fw-semibold mb-1">Suggested note to applicant</div>
            <Markdown markdown={review.applicant_note} className="small mb-0" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ProposalDetailPage({ slug, proposalId }: { slug: string; proposalId: string }) {
  const [, navigate] = useHashLocation();
  const [activeTab, setActiveTab] = useState<DetailTab>("submission");

  const { data, loading, error, reload } = useData<ProposalResponse>(
    () => api<ProposalResponse>(`/api/v1/admin/proposals/${proposalId}`),
    [proposalId],
  );

  const [reviews, setReviews] = useState<ProposalReview[]>([]);
  const [speakers, setSpeakers] = useState<ProposalSpeaker[]>([]);
  const [comments, setComments] = useState<ProposalInternalComment[]>([]);
  const [loadingSub, setLoadingSub] = useState(true);

  // Abstract editing
  const [editingAbstract, setEditingAbstract] = useState(false);
  const [abstractDraft, setAbstractDraft] = useState("");
  const [savingAbstract, setSavingAbstract] = useState(false);

  // Review form
  const [reviewRec, setReviewRec] = useState<"accept" | "reject" | "needs-work">("accept");
  const [reviewScore, setReviewScore] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewApplicantNote, setReviewApplicantNote] = useState("");
  const [savingReview, setSavingReview] = useState(false);

  // Internal comments
  const [commentDraft, setCommentDraft] = useState("");
  const [savingComment, setSavingComment] = useState(false);

  // Sync review form from the admin's own review whenever reviews load
  useEffect(() => {
    const mine = reviews.find((r) => r.reviewer_email === authEmail.value);
    if (mine) {
      setReviewRec(mine.recommendation as typeof reviewRec);
      setReviewScore(mine.score != null ? String(mine.score) : "");
      setReviewComment(mine.reviewer_comment ?? "");
      setReviewApplicantNote(mine.applicant_note ?? "");
    }
  }, [reviews]);

  // Decision form
  const [decisionStatus, setDecisionStatus] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [savingDecision, setSavingDecision] = useState(false);
  const [previewingDecision, setPreviewingDecision] = useState(false);
  const [decisionPreview, setDecisionPreview] = useState<DecisionPreviewResponse | null>(null);
  const [decisionPreviewConfirmed, setDecisionPreviewConfirmed] = useState(false);
  const [decisionPreviewTab, setDecisionPreviewTab] = useState<"html" | "text">("html");
  const [selectedDecisionPreviewId, setSelectedDecisionPreviewId] = useState("");
  const decisionPreviewFrameRef = useRef<HTMLIFrameElement>(null);

  const loadSubData = useCallback(async () => {
    setLoadingSub(true);
    try {
      const [r, s, c] = await Promise.all([
        api<{ reviews: ProposalReview[] }>(`/api/v1/admin/proposals/${proposalId}/reviews`).catch(() => ({
          reviews: [],
        })),
        api<{ speakers: ProposalSpeaker[] }>(`/api/v1/admin/proposals/${proposalId}/speakers`).catch(() => ({
          speakers: [],
        })),
        api<{ comments: ProposalInternalComment[] }>(`/api/v1/admin/proposals/${proposalId}/comments`).catch(() => ({
          comments: [],
        })),
      ]);
      setReviews(r.reviews ?? []);
      setSpeakers(s.speakers ?? []);
      setComments(c.comments ?? []);
    } catch {
      // non-fatal
    } finally {
      setLoadingSub(false);
    }
  }, [proposalId]);

  useEffect(() => {
    void loadSubData();
  }, [loadSubData]);

  // Sync decision/abstract form state when proposal data (re)loads
  useEffect(() => {
    if (data?.proposal) {
      setDecisionStatus(
        isNeedsWorkDecision(data.proposal.decision_status ?? "") ? "needs-work" : (data.proposal.decision_status ?? ""),
      );
      setDecisionNote(data.proposal.decision_note ?? "");
      setAbstractDraft(data.proposal.abstract);
    }
  }, [data]);

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;

  const { proposal, access, form, minReviewsRequired } = data;
  const proposer =
    [proposal.proposer_first_name, proposal.proposer_last_name].filter(Boolean).join(" ") || proposal.proposer_email;
  const quorumMet = reviews.length >= minReviewsRequired;
  const needsWorkRequiresNote = isNeedsWorkDecision(decisionStatus) && !decisionNote.trim();
  const selectedDecisionPreview =
    decisionPreview?.messages.find((message) => message.id === selectedDecisionPreviewId) ??
    decisionPreview?.messages[0] ??
    null;
  const scoredReviews = reviews.filter((review) => review.score != null);
  const averageScore =
    scoredReviews.length > 0
      ? scoredReviews.reduce((sum, review) => sum + (review.score ?? 0), 0) / scoredReviews.length
      : null;
  const recommendationCounts = reviews.reduce(
    (counts, review) => {
      if (review.recommendation in counts) {
        counts[review.recommendation] += 1;
      }
      return counts;
    },
    { accept: 0, "needs-work": 0, reject: 0 } as Record<ProposalReview["recommendation"], number>,
  );

  useEffect(() => {
    setDecisionPreview(null);
    setDecisionPreviewConfirmed(false);
    setSelectedDecisionPreviewId("");
    setDecisionPreviewTab("html");
  }, [decisionStatus, decisionNote]);

  useEffect(() => {
    if (!decisionPreview?.messages.length) return;
    setSelectedDecisionPreviewId((current) =>
      current && decisionPreview.messages.some((message) => message.id === current)
        ? current
        : decisionPreview.messages[0].id,
    );
  }, [decisionPreview]);

  useEffect(() => {
    if (decisionPreviewTab !== "html" || !selectedDecisionPreview || !decisionPreviewFrameRef.current) return;
    decisionPreviewFrameRef.current.srcdoc = selectedDecisionPreview.html;
  }, [decisionPreviewTab, selectedDecisionPreview]);

  const tabItems = [
    { key: "submission", label: "Submission" },
    { key: "speakers", label: `Speakers (${loadingSub ? "…" : speakers.length})` },
    { key: "reviews", label: `Reviews (${loadingSub ? "…" : reviews.length})` },
    { key: "audit-log", label: "Audit Log" },
    ...(access.canFinalize ? [{ key: "decision", label: "Decision" }] : []),
  ];

  async function handleOpenManage() {
    try {
      const { manageUrl } = await api<{ manageUrl: string }>(`/api/v1/admin/proposals/${proposalId}/open-manage`, {
        method: "POST",
        body: "{}",
      });
      window.open(manageUrl, "_blank", "noopener");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function handleSaveAbstract(e: Event) {
    e.preventDefault();
    setSavingAbstract(true);
    try {
      await api(`/api/v1/admin/proposals/${proposalId}`, {
        method: "PATCH",
        body: JSON.stringify({ abstract: abstractDraft }),
      });
      setEditingAbstract(false);
      toast("Abstract updated", "success");
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSavingAbstract(false);
    }
  }

  async function handleReview(e: Event) {
    e.preventDefault();
    setSavingReview(true);
    try {
      const score = parseInt(reviewScore, 10);
      const body: Record<string, unknown> = { recommendation: reviewRec, score };
      if (reviewComment.trim()) body.reviewerComment = reviewComment.trim();
      if (reviewApplicantNote.trim()) body.applicantNote = reviewApplicantNote.trim();
      const result = await api<{ review: ProposalReview }>(`/api/v1/admin/proposals/${proposalId}/reviews`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setReviews((prev) => {
        const idx = prev.findIndex((r) => r.reviewer_user_id === result.review.reviewer_user_id);
        return idx >= 0 ? prev.map((r, i) => (i === idx ? result.review : r)) : [...prev, result.review];
      });
      toast("Review saved", "success");
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSavingReview(false);
    }
  }

  async function handleComment(e: Event) {
    e.preventDefault();
    const comment = commentDraft.trim();
    if (!comment) return;
    setSavingComment(true);
    try {
      const result = await api<{ comment: ProposalInternalComment }>(`/api/v1/admin/proposals/${proposalId}/comments`, {
        method: "POST",
        body: JSON.stringify({ comment }),
      });
      if (result.comment) {
        setComments((prev) => [result.comment, ...prev]);
      }
      setCommentDraft("");
      toast("Comment added", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSavingComment(false);
    }
  }

  async function handleDecision(e: Event) {
    e.preventDefault();
    if (!decisionStatus) return;
    if (!decisionPreview || !decisionPreviewConfirmed) {
      toast("Preview and confirm the outgoing email first", "error");
      return;
    }
    setSavingDecision(true);
    try {
      await api(`/api/v1/admin/proposals/${proposalId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ finalStatus: decisionStatus, decisionNote: decisionNote.trim() || undefined }),
      });
      toast("Decision saved", "success");
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSavingDecision(false);
    }
  }

  async function handlePreviewDecision() {
    if (!decisionStatus) return;
    setPreviewingDecision(true);
    try {
      const preview = await api<DecisionPreviewResponse>(`/api/v1/admin/proposals/${proposalId}/finalize-preview`, {
        method: "POST",
        body: JSON.stringify({ finalStatus: decisionStatus, decisionNote: decisionNote.trim() || undefined }),
      });
      setDecisionPreview(preview);
      setDecisionPreviewConfirmed(false);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setPreviewingDecision(false);
    }
  }

  function decisionEmailLabel(templateKey: string): string {
    switch (templateKey) {
      case "proposal_decision":
        return "Decision Email";
      case "speaker_profile_request":
        return "Profile Request";
      case "presentation_upload_request":
        return "Presentation Upload";
      default:
        return templateKey.replace(/_/g, " ");
    }
  }

  return (
    <div>
      {/* ── Header ── */}
      <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <button class="btn btn-sm btn-outline-secondary" onClick={() => navigate(`/events/${slug}/proposals`)}>
          ← Back
        </button>
        <h5 class="mb-0 me-1">{proposal.title}</h5>
        <Badge status={proposal.status} />
        {proposal.decision_status && <Badge status={proposal.decision_status} />}
        <span class="text-muted small ms-1">{proposer}</span>
        <span class="text-muted small">·</span>
        <span class="mono small text-muted">{fmt(proposal.submitted_at)}</span>
        <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void reload()}>
          ↺ Refresh
        </button>
      </div>

      {/* ── Stat cards ── */}
      <div class="row g-2 mb-3">
        <div class="col-sm-6 col-md-3">
          <div class="card card-body p-3 h-100">
            <div class="small text-muted mb-1">Proposer</div>
            <div class="fw-semibold">{proposer}</div>
            <div class="small text-muted">{proposal.proposer_email}</div>
          </div>
        </div>
        <div class="col-sm-6 col-md-3">
          <div class="card card-body p-3 h-100">
            <div class="small text-muted mb-1">Type</div>
            <div class="text-capitalize">{proposal.proposal_type.replace(/_/g, " ")}</div>
            <div class="small text-muted">Submitted {fmt(proposal.submitted_at)}</div>
          </div>
        </div>
        <div class="col-sm-6 col-md-3">
          <div class="card card-body p-3 h-100">
            <div class="small text-muted mb-1">Reviews</div>
            <div>
              {loadingSub ? "…" : reviews.length} / {minReviewsRequired} required
            </div>
            <div class={`small ${quorumMet ? "text-success" : "text-warning"}`}>
              {quorumMet ? "Quorum met ✓" : "Quorum not met"}
            </div>
          </div>
        </div>
        <div class="col-sm-6 col-md-3">
          <div class="card card-body p-3 h-100">
            <div class="small text-muted mb-1">Decision</div>
            <div class="text-capitalize">
              {proposal.decision_status ? proposal.decision_status.replace(/[_-]/g, " ") : "Pending"}
            </div>
            <div class="small text-muted">
              {proposal.decision_decided_at ? `Recorded ${fmt(proposal.decision_decided_at)}` : "No final decision yet"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Two-column layout ── */}
      <div class="row g-3">
        {/* Main content */}
        <div class="col-lg-8">
          <Tabs
            items={tabItems}
            active={activeTab}
            onChange={(key) => setActiveTab(key as DetailTab)}
            className="mb-3"
          />

          {/* ── Submission tab ── */}
          {activeTab === "submission" && (
            <div class="card">
              <div class="card-header d-flex align-items-center gap-2">
                <h6 class="mb-0">Abstract</h6>
                {access.canFinalize && !editingAbstract && (
                  <button
                    class="btn btn-sm btn-outline-secondary ms-auto"
                    onClick={() => {
                      setAbstractDraft(proposal.abstract);
                      setEditingAbstract(true);
                    }}
                  >
                    Edit
                  </button>
                )}
              </div>
              <div class="card-body">
                {editingAbstract ? (
                  <form onSubmit={(e) => void handleSaveAbstract(e)}>
                    <textarea
                      class="form-control mb-3"
                      rows={8}
                      value={abstractDraft}
                      onInput={(e) => setAbstractDraft((e.target as HTMLTextAreaElement).value)}
                    />
                    <div class="d-flex gap-2">
                      <button type="submit" class="btn btn-primary" disabled={savingAbstract}>
                        {savingAbstract ? "Saving…" : "Save"}
                      </button>
                      <button type="button" class="btn btn-outline-secondary" onClick={() => setEditingAbstract(false)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div class="adm-pre-wrap">{proposal.abstract || "—"}</div>
                )}
              </div>

              {proposal.details && Object.keys(proposal.details).length > 0 && (
                <>
                  <div class="card-header border-top">
                    <h6 class="mb-0 small">
                      Submission Answers
                      {form?.title && <span class="text-muted fw-normal ms-2">— {form.title}</span>}
                    </h6>
                  </div>
                  <div class="card-body p-0">
                    <FormAnswerTable answers={proposal.details} fields={form?.fields} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Speakers tab ── */}
          {activeTab === "speakers" && (
            <div>
              {loadingSub ? (
                <Spinner />
              ) : speakers.length === 0 ? (
                <p class="text-muted fst-italic">No speakers assigned yet.</p>
              ) : (
                speakers.map((s) => (
                  <SpeakerCard
                    key={s.userId}
                    speaker={s}
                    proposalId={proposalId}
                    canEdit={access.canReview}
                    onSaved={(userId, patch) =>
                      setSpeakers((prev) => prev.map((sp) => (sp.userId === userId ? { ...sp, ...patch } : sp)))
                    }
                  />
                ))
              )}
            </div>
          )}

          {/* ── Reviews tab ── */}
          {activeTab === "reviews" && (
            <div>
              <div class="card mb-3">
                <div class="card-body py-2 px-3">
                  <div class="d-flex align-items-center gap-3 flex-wrap">
                    <span class="text-muted small">Review progress</span>
                    <strong class="small">
                      {loadingSub ? "…" : reviews.length} / {minReviewsRequired}
                    </strong>
                    {quorumMet ? (
                      <span class="badge text-bg-success">Quorum met</span>
                    ) : (
                      <span class="badge text-bg-warning">
                        {minReviewsRequired - (loadingSub ? 0 : reviews.length)} more needed
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {loadingSub ? (
                <Spinner />
              ) : reviews.length === 0 ? (
                <p class="text-muted fst-italic">No reviews yet.</p>
              ) : (
                reviews.map((r) => <ReviewCard key={r.id} review={r} />)
              )}

              {access.canReview && !loadingSub && (
                <div class="card mt-3">
                  <div class="card-header">
                    <h6 class="mb-0">
                      {reviews.some((r) => r.reviewer_email === authEmail.value) ? "Edit My Review" : "Add Review"}
                    </h6>
                  </div>
                  <div class="card-body">
                    <form onSubmit={(e) => void handleReview(e)}>
                      <div class="row g-3">
                        <div class="col-md-5">
                          <label class="form-label fw-semibold">Recommendation</label>
                          <select
                            class="form-select"
                            value={reviewRec}
                            required
                            onChange={(e) => setReviewRec((e.target as HTMLSelectElement).value as typeof reviewRec)}
                          >
                            <option value="accept">Accept</option>
                            <option value="needs-work">Needs Work</option>
                            <option value="reject">Reject</option>
                          </select>
                        </div>
                        <div class="col-md-3">
                          <label class="form-label fw-semibold">Score (1–10)</label>
                          <input
                            class="form-control"
                            type="number"
                            min="1"
                            max="10"
                            required
                            value={reviewScore}
                            onInput={(e) => setReviewScore((e.target as HTMLInputElement).value)}
                            placeholder="1–10"
                          />
                        </div>
                        <div class="col-12">
                          <label class="form-label fw-semibold">
                            Internal review notes
                            <span class="text-muted fw-normal ms-2 small">Private · Markdown supported</span>
                          </label>
                          <textarea
                            class="form-control"
                            rows={3}
                            value={reviewComment}
                            onInput={(e) => setReviewComment((e.target as HTMLTextAreaElement).value)}
                            placeholder="Private notes for the organizing team…"
                          />
                        </div>
                        <div class="col-12">
                          <hr class="my-2" />
                          <label class="form-label fw-semibold">
                            Suggested note to applicant
                            <span class="text-muted fw-normal ms-2 small">
                              Optional · private draft · Markdown supported
                            </span>
                          </label>
                          <textarea
                            class="form-control"
                            rows={3}
                            value={reviewApplicantNote}
                            onInput={(e) => setReviewApplicantNote((e.target as HTMLTextAreaElement).value)}
                            placeholder="Feedback or clarification request for the applicant…"
                          />
                        </div>
                        <div class="col-12">
                          <button type="submit" class="btn btn-primary" disabled={savingReview}>
                            {savingReview ? "Saving…" : "Submit Review"}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Audit log tab ── */}
          {activeTab === "audit-log" && (
            <div class="card">
              <div class="card-header">
                <h6 class="mb-0">Audit Log</h6>
              </div>
              <div class="card-body p-0">
                <AuditLogSection proposalId={proposalId} />
              </div>
            </div>
          )}

          {/* ── Decision tab (finalizers only) ── */}
          {activeTab === "decision" && access.canFinalize && (
            <div class="card">
              <div class="card-header">
                <h6 class="mb-0">Final Decision</h6>
              </div>
              <div class="card-body">
                {proposal.decision_status ? (
                  <div class="alert alert-info mb-0">
                    <div class="d-flex gap-2 align-items-center mb-1">
                      <strong>Decision recorded:</strong>
                      <Badge status={proposal.decision_status} />
                    </div>
                    {proposal.decision_note && (
                      <Markdown markdown={proposal.decision_note} className="small mt-2 mb-0" />
                    )}
                    {proposal.decision_decided_at && (
                      <div class="small text-muted mt-2">Recorded {fmt(proposal.decision_decided_at)}</div>
                    )}
                  </div>
                ) : (
                  <>
                    {!quorumMet && !loadingSub && (
                      <div class="alert alert-warning">
                        <strong>Quorum not met.</strong> {reviews.length} of {minReviewsRequired} required review
                        {minReviewsRequired !== 1 ? "s" : ""} completed. Add more reviews before finalizing.
                      </div>
                    )}
                    <form onSubmit={(e) => void handleDecision(e)}>
                      <div class="row g-3">
                        <div class="col-md-4">
                          <label class="form-label fw-semibold">Decision</label>
                          <select
                            class="form-select"
                            value={decisionStatus}
                            onChange={(e) => setDecisionStatus((e.target as HTMLSelectElement).value)}
                          >
                            <option value="">— select —</option>
                            <option value="accepted">Accepted</option>
                            <option value="needs-work">Needs Work</option>
                            <option value="rejected">Rejected</option>
                          </select>
                        </div>
                        <div class="col-12">
                          <label class="form-label fw-semibold">
                            Note to applicant
                            {isNeedsWorkDecision(decisionStatus) && <span class="text-danger ms-1">* required</span>}
                            <span class="text-muted fw-normal ms-2 small">
                              Sent in decision email · Markdown supported
                            </span>
                          </label>
                          <textarea
                            class={`form-control${needsWorkRequiresNote ? " is-invalid" : ""}`}
                            rows={4}
                            value={decisionNote}
                            onInput={(e) => setDecisionNote((e.target as HTMLTextAreaElement).value)}
                            placeholder={
                              isNeedsWorkDecision(decisionStatus)
                                ? "Describe what changes or clarifications are needed…"
                                : "Optional feedback for the proposer…"
                            }
                          />
                          {needsWorkRequiresNote && (
                            <div class="invalid-feedback">A note is required when requesting work.</div>
                          )}
                        </div>
                        <div class="col-12">
                          <div class="d-flex gap-2 align-items-center flex-wrap">
                            <button
                              type="button"
                              class="btn btn-outline-primary"
                              onClick={() => void handlePreviewDecision()}
                              disabled={previewingDecision || !decisionStatus || needsWorkRequiresNote}
                            >
                              {previewingDecision ? "Previewing…" : "Preview Emails"}
                            </button>
                            {decisionPreview && (
                              <span class="small text-muted">
                                {decisionPreview.emailCount} email{decisionPreview.emailCount === 1 ? "" : "s"} to{" "}
                                {decisionPreview.recipientCount} recipient
                                {decisionPreview.recipientCount === 1 ? "" : "s"}
                              </span>
                            )}
                          </div>
                        </div>
                        {decisionPreview && selectedDecisionPreview && (
                          <div class="col-12">
                            <div class="card border">
                              <div class="card-header bg-light small fw-semibold">Email Preview</div>
                              <div class="card-body">
                                <div class="row g-3">
                                  <div class="col-lg-4">
                                    <div class="small text-muted mb-2">Outgoing emails</div>
                                    <div class="list-group">
                                      {decisionPreview.messages.map((message) => (
                                        <button
                                          key={message.id}
                                          type="button"
                                          class={`list-group-item list-group-item-action${message.id === selectedDecisionPreview.id ? " active" : ""}`}
                                          onClick={() => setSelectedDecisionPreviewId(message.id)}
                                        >
                                          <div class="fw-semibold small">{decisionEmailLabel(message.templateKey)}</div>
                                          <div class="small">{message.recipientLabel}</div>
                                          <div class="small text-break">{message.recipientEmail}</div>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  <div class="col-lg-8">
                                    <div class="small text-muted">To</div>
                                    <div class="fw-semibold mb-2">
                                      {selectedDecisionPreview.recipientLabel} &lt;
                                      {selectedDecisionPreview.recipientEmail}&gt;
                                    </div>
                                    <div class="small text-muted">Subject</div>
                                    <div class="fw-semibold mb-2">{selectedDecisionPreview.subject}</div>
                                    <Tabs
                                      items={[
                                        { key: "html", label: "HTML" },
                                        { key: "text", label: "Text" },
                                      ]}
                                      active={decisionPreviewTab}
                                      onChange={(key) => setDecisionPreviewTab(key as "html" | "text")}
                                      className="mb-2"
                                    />
                                    {decisionPreviewTab === "html" && (
                                      <iframe
                                        ref={decisionPreviewFrameRef}
                                        sandbox=""
                                        class="adm-email-preview-frame"
                                      />
                                    )}
                                    {decisionPreviewTab === "text" && (
                                      <pre class="json-out adm-email-preview-text">{selectedDecisionPreview.text}</pre>
                                    )}
                                    <div class="form-check mt-2">
                                      <input
                                        class="form-check-input"
                                        type="checkbox"
                                        id="proposal-decision-preview-confirm"
                                        checked={decisionPreviewConfirmed}
                                        onChange={(e) =>
                                          setDecisionPreviewConfirmed((e.target as HTMLInputElement).checked)
                                        }
                                      />
                                      <label class="form-check-label small" for="proposal-decision-preview-confirm">
                                        I reviewed the outgoing email preview and confirm this decision send.
                                      </label>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        <div class="col-12">
                          <button
                            type="submit"
                            class="btn btn-primary"
                            disabled={
                              savingDecision ||
                              !decisionStatus ||
                              !quorumMet ||
                              needsWorkRequiresNote ||
                              !decisionPreview ||
                              !decisionPreviewConfirmed
                            }
                            title={!quorumMet ? `Requires ${minReviewsRequired} reviews` : undefined}
                          >
                            {savingDecision ? "Saving…" : "Record Decision"}
                          </button>
                        </div>
                      </div>
                    </form>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Sidebar ── */}
        <div class="col-lg-4">
          <div class="card mb-3">
            <div class="card-header">
              <h6 class="mb-0">Operator Actions</h6>
            </div>
            <div class="card-body d-grid gap-2">
              <button class="btn btn-primary" onClick={() => void handleOpenManage()}>
                Open Proposer Manage Page ↗
              </button>
              <a class="btn btn-outline-secondary" href={`mailto:${proposal.proposer_email}`}>
                Email Proposer
              </a>
              <button
                class="btn btn-outline-secondary"
                onClick={() => void navigator.clipboard.writeText(proposal.proposer_email)}
              >
                Copy Proposer Email
              </button>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <h6 class="mb-0">Status</h6>
            </div>
            <div class="card-body">
              <dl class="small mb-0">
                <dt>Workflow status</dt>
                <dd class="mb-2">
                  <Badge status={proposal.status} />
                </dd>
                <dt>Decision</dt>
                <dd class="mb-2">
                  {proposal.decision_status ? (
                    <Badge status={proposal.decision_status} />
                  ) : (
                    <span class="text-muted">Pending</span>
                  )}
                </dd>
                <dt>Reviews</dt>
                <dd class="mb-2">
                  {loadingSub ? "…" : reviews.length} / {minReviewsRequired} required
                  <div class={`small ${quorumMet ? "text-success" : "text-warning"}`}>
                    {quorumMet ? "Quorum met" : "Quorum not met"}
                  </div>
                  {!loadingSub && reviews.length > 0 && (
                    <div class="small text-muted mt-1">
                      Avg score {averageScore == null || Number.isNaN(averageScore) ? "—" : averageScore.toFixed(1)}
                    </div>
                  )}
                  {!loadingSub && reviews.length > 0 && (
                    <div class="d-flex gap-1 flex-wrap mt-1">
                      {recommendationCounts.accept > 0 && (
                        <Badge status="accept" label={`Accept ${recommendationCounts.accept}`} />
                      )}
                      {recommendationCounts["needs-work"] > 0 && (
                        <Badge status="needs-work" label={`Needs work ${recommendationCounts["needs-work"]}`} />
                      )}
                      {recommendationCounts.reject > 0 && (
                        <Badge status="reject" label={`Reject ${recommendationCounts.reject}`} />
                      )}
                    </div>
                  )}
                </dd>
                <dt>Last updated</dt>
                <dd class="mb-0">{fmt(proposal.updated_at)}</dd>
              </dl>
            </div>
          </div>

          {access.canReview && (
            <div class="card mt-3">
              <div class="card-header">
                <h6 class="mb-0">Internal Comments</h6>
              </div>
              <div class="card-body">
                <form onSubmit={(e) => void handleComment(e)} class="mb-3">
                  <textarea
                    class="form-control"
                    rows={3}
                    value={commentDraft}
                    onInput={(e) => setCommentDraft((e.target as HTMLTextAreaElement).value)}
                    placeholder="Add a private committee comment…"
                  />
                  <div class="d-flex justify-content-between align-items-center gap-2 mt-2">
                    <span class="small text-muted">Markdown supported</span>
                    <button
                      type="submit"
                      class="btn btn-sm btn-primary"
                      disabled={savingComment || !commentDraft.trim()}
                    >
                      {savingComment ? "Adding…" : "Add Comment"}
                    </button>
                  </div>
                </form>
                {comments.length === 0 ? (
                  <p class="small text-muted mb-0">No internal comments yet.</p>
                ) : (
                  <div class="d-flex flex-column gap-2">
                    {comments.map((comment) => {
                      const author =
                        [comment.author_first_name, comment.author_last_name].filter(Boolean).join(" ") ||
                        comment.author_email ||
                        "Admin";
                      return (
                        <div class="adm-internal-comment" key={comment.id}>
                          <div class="d-flex gap-2 align-items-center mb-1">
                            <strong class="small">{author}</strong>
                            <span class="small text-muted ms-auto">{fmt(comment.created_at)}</span>
                          </div>
                          <Markdown markdown={comment.comment} className="small mb-0" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
