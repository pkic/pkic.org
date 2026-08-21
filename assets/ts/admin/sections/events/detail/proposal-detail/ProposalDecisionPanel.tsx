import { useEffect, useState } from "preact/hooks";
import { proposalDecisionPreviewResponseSchema } from "../../../../../../shared/schemas/admin-event-proposals";
import { Badge } from "../../../../../components/Badge";
import { Markdown } from "../../../../../components/Markdown";
import { Tabs } from "../../../../../components/Tabs";
import { api } from "../../../../api";
import { fmt, toast } from "../../../../ui";
import { isNeedsWorkDecision, type DecisionPreviewResponse, type ProposalDetailRecord } from "./model";
import {
  isProposalDecisionTransitionAllowed,
  PROPOSAL_DECISION_STATUSES,
} from "../../../../../../shared/schemas/proposal-status";
import { EMAIL_PREVIEW_TABS, type EmailPreviewTab } from "../../../../email-preview-tabs";

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

export function ProposalDecisionPanel({
  proposalId,
  proposal,
  reviewCount,
  minReviewsRequired,
  loading,
  onSaved,
}: {
  proposalId: string;
  proposal: ProposalDetailRecord;
  reviewCount: number;
  minReviewsRequired: number;
  loading: boolean;
  onSaved: () => void;
}) {
  const [decisionStatus, setDecisionStatus] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<DecisionPreviewResponse | null>(null);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [previewTab, setPreviewTab] = useState<EmailPreviewTab>("html");
  const [selectedPreviewId, setSelectedPreviewId] = useState("");

  const quorumMet = reviewCount >= minReviewsRequired;
  const availableDecisionStatuses = PROPOSAL_DECISION_STATUSES.filter((status) =>
    isProposalDecisionTransitionAllowed(proposal.status, proposal.decision_status, status),
  );
  const canRecordDecision = availableDecisionStatuses.length > 0;
  const needsWorkRequiresNote = isNeedsWorkDecision(decisionStatus) && !decisionNote.trim();
  const selectedPreview =
    preview?.messages.find((message) => message.id === selectedPreviewId) ?? preview?.messages[0] ?? null;

  useEffect(() => {
    setDecisionStatus("");
    setDecisionNote("");
  }, [proposal]);

  useEffect(() => {
    setPreview(null);
    setPreviewConfirmed(false);
    setSelectedPreviewId("");
    setPreviewTab("html");
  }, [decisionStatus, decisionNote]);

  useEffect(() => {
    if (!preview?.messages.length) return;
    setSelectedPreviewId((current) =>
      current && preview.messages.some((message) => message.id === current) ? current : preview.messages[0].id,
    );
  }, [preview]);

  async function handleDecision(event: Event) {
    event.preventDefault();
    if (!decisionStatus) return;
    if (!preview || !previewConfirmed) {
      toast("Preview and confirm the outgoing email first", "error");
      return;
    }
    setSaving(true);
    try {
      await api(`/api/v1/admin/proposals/${proposalId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ finalStatus: decisionStatus, decisionNote: decisionNote.trim() || undefined }),
      });
      toast("Decision saved", "success");
      onSaved();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handlePreviewDecision() {
    if (!decisionStatus) return;
    setPreviewing(true);
    try {
      setPreview(
        proposalDecisionPreviewResponseSchema.parse(
          await api<unknown>(`/api/v1/admin/proposals/${proposalId}/finalize-preview`, {
            method: "POST",
            body: JSON.stringify({ finalStatus: decisionStatus, decisionNote: decisionNote.trim() || undefined }),
          }),
        ),
      );
      setPreviewConfirmed(false);
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div class="card">
      <div class="card-header">
        <h6 class="mb-0">Final Decision</h6>
      </div>
      <div class="card-body">
        {proposal.decision_status && (
          <div class={`alert alert-info${canRecordDecision ? " mb-3" : " mb-0"}`}>
            <div class="d-flex gap-2 align-items-center mb-1">
              <strong>Decision recorded:</strong>
              <Badge status={proposal.decision_status} />
            </div>
            {proposal.decision_note && <Markdown markdown={proposal.decision_note} className="small mt-2 mb-0" />}
            {proposal.decision_decided_at && (
              <div class="small text-muted mt-2">Recorded {fmt(proposal.decision_decided_at)}</div>
            )}
          </div>
        )}
        {!canRecordDecision && !proposal.decision_status && (
          <div class="alert alert-warning mb-0">This proposal is not in a state that can receive a decision.</div>
        )}
        {canRecordDecision && (
          <>
            {!quorumMet && !loading && (
              <div class="alert alert-warning">
                <strong>Quorum not met.</strong> {reviewCount} of {minReviewsRequired} required review
                {minReviewsRequired !== 1 ? "s" : ""} completed. Add more reviews before finalizing.
              </div>
            )}
            <form onSubmit={(event) => void handleDecision(event)}>
              <div class="row g-3">
                <div class="col-md-4">
                  <label class="form-label fw-semibold">Decision</label>
                  <select
                    class="form-select"
                    value={decisionStatus}
                    onChange={(event) => setDecisionStatus((event.target as HTMLSelectElement).value)}
                  >
                    <option value="">— select —</option>
                    {availableDecisionStatuses.map((status) => (
                      <option key={status} value={status}>
                        {{ accepted: "Accepted", "needs-work": "Needs Work", rejected: "Rejected" }[status]}
                      </option>
                    ))}
                  </select>
                </div>
                <div class="col-12">
                  <label class="form-label fw-semibold">
                    Note to applicant
                    {isNeedsWorkDecision(decisionStatus) && <span class="text-danger ms-1">* required</span>}
                    <span class="text-muted fw-normal ms-2 small">Sent in decision email · Markdown supported</span>
                  </label>
                  <textarea
                    class={`form-control${needsWorkRequiresNote ? " is-invalid" : ""}`}
                    rows={4}
                    value={decisionNote}
                    onInput={(event) => setDecisionNote((event.target as HTMLTextAreaElement).value)}
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
                      disabled={previewing || !decisionStatus || needsWorkRequiresNote}
                    >
                      {previewing ? "Previewing…" : "Preview Emails"}
                    </button>
                    {preview && (
                      <span class="small text-muted">
                        {preview.emailCount} email{preview.emailCount === 1 ? "" : "s"} to {preview.recipientCount}{" "}
                        recipient{preview.recipientCount === 1 ? "" : "s"}
                        {(preview.layoutMissing || preview.missingTemplateKeys.length > 0) && (
                          <span class="text-warning ms-2">⚠ Configuration issues — see preview</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                {preview && selectedPreview && (
                  <div class="col-12">
                    <div class="card border">
                      <div class="card-header bg-light small fw-semibold">Email Preview</div>
                      <div class="card-body">
                        {preview.layoutMissing && (
                          <div class="alert alert-warning small py-2 mb-3">
                            <strong>Email layout template not configured.</strong> Emails will render without your
                            branded layout. Configure the <code>email_layout</code> template to fix this.
                          </div>
                        )}
                        {preview.missingTemplateKeys.length > 0 && (
                          <div class="alert alert-warning small py-2 mb-3">
                            <strong>Missing email template{preview.missingTemplateKeys.length > 1 ? "s" : ""}:</strong>{" "}
                            <code>{preview.missingTemplateKeys.join(", ")}</code>. These notifications will not be sent
                            until the templates are configured.
                          </div>
                        )}
                        <div class="row g-3">
                          <div class="col-lg-4">
                            <div class="small text-muted mb-2">Outgoing emails</div>
                            <div class="list-group">
                              {preview.messages.map((message) => (
                                <button
                                  key={message.id}
                                  type="button"
                                  class={`list-group-item list-group-item-action${message.id === selectedPreview.id ? " active" : ""}`}
                                  onClick={() => setSelectedPreviewId(message.id)}
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
                              {selectedPreview.recipientLabel} &lt;{selectedPreview.recipientEmail}&gt;
                            </div>
                            <div class="small text-muted">Subject</div>
                            <div class="fw-semibold mb-2">{selectedPreview.subject}</div>
                            <Tabs
                              items={EMAIL_PREVIEW_TABS}
                              active={previewTab}
                              onChange={(key) => setPreviewTab(key as EmailPreviewTab)}
                              className="mb-2"
                            />
                            {previewTab === "html" &&
                              (selectedPreview.templateMissing ? (
                                <div class="alert alert-warning small mb-0">
                                  Email template <code>{selectedPreview.templateKey}</code> is not configured. This
                                  notification will not be sent until the template is activated.
                                </div>
                              ) : (
                                <iframe srcdoc={selectedPreview.html} sandbox="" class="adm-email-preview-frame" />
                              ))}
                            {previewTab === "text" && (
                              <pre class="json-out adm-email-preview-text">{selectedPreview.text}</pre>
                            )}
                            <div class="form-check mt-2">
                              <input
                                class="form-check-input"
                                type="checkbox"
                                id="proposal-decision-preview-confirm"
                                checked={previewConfirmed}
                                onChange={(event) => setPreviewConfirmed((event.target as HTMLInputElement).checked)}
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
                      saving ||
                      !canRecordDecision ||
                      !decisionStatus ||
                      !quorumMet ||
                      needsWorkRequiresNote ||
                      !preview ||
                      !previewConfirmed
                    }
                    title={!quorumMet ? `Requires ${minReviewsRequired} reviews` : undefined}
                  >
                    {saving ? "Saving…" : "Record Decision"}
                  </button>
                </div>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
