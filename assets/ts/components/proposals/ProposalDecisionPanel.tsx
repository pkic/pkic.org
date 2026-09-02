import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import type { EventProposalDetailResponse } from "../../../shared/schemas/event-proposals";
import type { ProposalDecisionPreviewResponse } from "../../../shared/schemas/proposal-decisions";
import { finalizeProposalSchema } from "../../../shared/schemas/proposal-management";
import {
  isProposalDecisionTransitionAllowed,
  PROPOSAL_DECISION_STATUSES,
} from "../../../shared/schemas/proposal-status";
import { useContractForm } from "../../hooks/useContractForm";
import { Alert } from "../../ui/Alert";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Checkbox } from "../../ui/Checkbox";
import { Field } from "../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { Select, Textarea } from "../../ui/TextControl";
import { Tabs } from "../Tabs";
import { Markdown } from "../Markdown";
import { EMAIL_PREVIEW_TABS, type EmailPreviewTab } from "../../shared/email-preview-tabs";
import type { ToastType } from "../../shared/ui";
import "../../ui/Content.css";

type ProposalDecisionInput = z.infer<typeof finalizeProposalSchema>;
type ProposalDecisionRecord = Pick<
  EventProposalDetailResponse["proposal"],
  "status" | "decision_status" | "decision_note" | "decision_decided_at"
>;

function decisionEmailLabel(templateKey: string): string {
  switch (templateKey) {
    case "proposal_decision":
      return "Decision email";
    case "speaker_profile_request":
      return "Profile request";
    case "presentation_upload_request":
      return "Presentation upload request";
    default:
      return templateKey.replace(/_/g, " ");
  }
}

/**
 * Endpoint-agnostic final-decision workflow shared by every authorized proposal
 * surface. Callers supply the canonical transport adapter and their UI feedback.
 */
export function ProposalDecisionPanel({
  proposal,
  reviewCount,
  minReviewsRequired,
  loading = false,
  onPreview,
  onFinalize,
  onFinalized,
  formatDate,
  notify,
}: {
  proposal: ProposalDecisionRecord;
  reviewCount: number;
  minReviewsRequired: number;
  loading?: boolean;
  onPreview: (input: ProposalDecisionInput) => Promise<ProposalDecisionPreviewResponse>;
  onFinalize: (input: ProposalDecisionInput) => Promise<void>;
  onFinalized: () => void;
  formatDate: (value: string | null | undefined) => string;
  notify: (message: string, type: ToastType) => void;
}) {
  const [decisionStatus, setDecisionStatus] = useState<ProposalDecisionInput["finalStatus"] | "">("");
  const [decisionNote, setDecisionNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ProposalDecisionPreviewResponse | null>(null);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [previewTab, setPreviewTab] = useState<EmailPreviewTab>("html");
  const [selectedPreviewId, setSelectedPreviewId] = useState("");
  // One basis for validation: the finalize contract the route parses decides
  // what each field shows — a needs-work decision without a note is refused
  // on the note — and what Preview and Record may send.
  const form = useContractForm(finalizeProposalSchema, {
    finalStatus: decisionStatus || undefined,
    decisionNote: decisionNote.trim() || undefined,
  });

  const quorumMet = reviewCount >= minReviewsRequired;
  const availableDecisionStatuses = PROPOSAL_DECISION_STATUSES.filter((status) =>
    isProposalDecisionTransitionAllowed(proposal.status, proposal.decision_status, status),
  );
  const canRecordDecision = availableDecisionStatuses.length > 0;
  const selectedPreview =
    preview?.messages.find((message) => message.id === selectedPreviewId) ?? preview?.messages[0] ?? null;

  useEffect(() => {
    setDecisionStatus("");
    setDecisionNote("");
    form.reset();
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

  async function handlePreview(): Promise<void> {
    const checked = form.submit();
    if (!checked.data) return;
    setPreviewing(true);
    try {
      setPreview(await onPreview(checked.data));
      setPreviewConfirmed(false);
    } catch (error) {
      notify(form.refuse(error), "error");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleDecision(event: Event): Promise<void> {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) return;
    if (!preview || !previewConfirmed) {
      notify("Preview and confirm the outgoing email first", "error");
      return;
    }
    setSaving(true);
    try {
      await onFinalize(checked.data);
      notify("Decision saved", "success");
      onFinalized();
    } catch (error) {
      // A server refusal names its fields the same way the contract does.
      notify(form.refuse(error), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Final decision" headingLevel={2} />
        <PanelBody>
          {proposal.decision_status && (
            <Alert tone="info">
              <div class="pk-stack">
                <div class="pk-cluster">
                  <strong>Decision recorded:</strong>
                  <Badge
                    tone={
                      proposal.decision_status === "accepted"
                        ? "ok"
                        : proposal.decision_status === "needs-work"
                          ? "warn"
                          : "danger"
                    }
                  >
                    {{ accepted: "Accepted", "needs-work": "Needs work", rejected: "Rejected" }[
                      proposal.decision_status
                    ] || proposal.decision_status}
                  </Badge>
                </div>
                {proposal.decision_note && <Markdown markdown={proposal.decision_note} className="pk-small" />}
                {proposal.decision_decided_at && (
                  <div class="pk-small">Recorded {formatDate(proposal.decision_decided_at)}</div>
                )}
              </div>
            </Alert>
          )}
          {!canRecordDecision && !proposal.decision_status && (
            <Alert tone="warn">This proposal is not in a state that can receive a decision.</Alert>
          )}
          {canRecordDecision && (
            <>
              {!quorumMet && !loading && (
                <Alert tone="warn">
                  <strong>Quorum not met.</strong> {reviewCount} of {minReviewsRequired} required review
                  {minReviewsRequired !== 1 ? "s" : ""} completed. Add more reviews before finalizing.
                </Alert>
              )}
              <form noValidate onSubmit={(event) => void handleDecision(event)} class="pk-stack" {...form.handlers}>
                <Field label="Decision" {...form.of("finalStatus")}>
                  {(c) => (
                    <Select
                      {...c}
                      name="finalStatus"
                      value={decisionStatus}
                      onChange={(event) =>
                        setDecisionStatus(
                          (event.target as HTMLSelectElement).value as ProposalDecisionInput["finalStatus"],
                        )
                      }
                    >
                      <option value="">— select —</option>
                      {availableDecisionStatuses.map((status) => (
                        <option key={status} value={status}>
                          {{ accepted: "Accepted", "needs-work": "Needs work", rejected: "Rejected" }[status]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {/* The note is required exactly when the contract requires it,
                    and the contract is what says so — on this field. */}
                <Field
                  label="Note to applicant"
                  required={decisionStatus === "needs-work"}
                  help="Sent in the decision email · Markdown supported"
                  {...form.of("decisionNote")}
                >
                  {(c) => (
                    <Textarea
                      {...c}
                      name="decisionNote"
                      value={decisionNote}
                      onInput={(event) => setDecisionNote((event.target as HTMLTextAreaElement).value)}
                      placeholder={
                        decisionStatus === "needs-work"
                          ? "Describe the changes or clarifications needed…"
                          : "Optional feedback for the proposer…"
                      }
                    />
                  )}
                </Field>
                <div class="pk-cluster">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void handlePreview()}
                    disabled={previewing || !form.valid}
                    loading={previewing}
                  >
                    {previewing ? "Previewing…" : "Preview emails"}
                  </Button>
                  {preview && (
                    <span class="pk-small">
                      {preview.emailCount} email{preview.emailCount === 1 ? "" : "s"} to {preview.recipientCount}{" "}
                      recipient
                      {preview.recipientCount === 1 ? "" : "s"}
                      {(preview.layoutMissing || preview.missingTemplateKeys.length > 0) && (
                        <span class="pk-warning-note">Configuration issues — see preview</span>
                      )}
                    </span>
                  )}
                </div>
                {preview && selectedPreview && (
                  <Panel>
                    <PanelHeader title="Email preview" headingLevel={3} />
                    <PanelBody class="pk-stack">
                      {preview.layoutMissing && (
                        <Alert tone="warn">
                          <strong>Email layout template not configured.</strong> Emails will render without the branded
                          layout until the <code>email_layout</code> template is configured.
                        </Alert>
                      )}
                      {preview.missingTemplateKeys.length > 0 && (
                        <Alert tone="warn">
                          <strong>Missing email template{preview.missingTemplateKeys.length > 1 ? "s" : ""}:</strong>{" "}
                          <code>{preview.missingTemplateKeys.join(", ")}</code>. Those notifications will not be sent
                          until the templates are configured.
                        </Alert>
                      )}
                      <div class="pk-grid">
                        <div>
                          <div class="pk-small pk-muted">Outgoing emails</div>
                          <div class="pk-stack pk-stack--tight">
                            {preview.messages.map((message) => (
                              <button
                                key={message.id}
                                type="button"
                                class={`list-group-item list-group-item-action${message.id === selectedPreview.id ? " active" : ""}`}
                                onClick={() => setSelectedPreviewId(message.id)}
                              >
                                <div class="pk-strong pk-small">{decisionEmailLabel(message.templateKey)}</div>
                                <div class="pk-small">{message.recipientLabel}</div>
                                <div class="pk-small pk-break">{message.recipientEmail}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div class="pk-small pk-muted">To</div>
                          <div class="pk-strong">
                            {selectedPreview.recipientLabel} &lt;{selectedPreview.recipientEmail}&gt;
                          </div>
                          <div class="pk-small pk-muted">Subject</div>
                          <div class="pk-strong">{selectedPreview.subject}</div>
                          <Tabs
                            items={EMAIL_PREVIEW_TABS}
                            active={previewTab}
                            onChange={(key) => setPreviewTab(key as EmailPreviewTab)}
                          />
                          {previewTab === "html" &&
                            (selectedPreview.templateMissing ? (
                              <Alert tone="warn">
                                Email template <code>{selectedPreview.templateKey}</code> is not configured. This
                                notification will not be sent until the template is activated.
                              </Alert>
                            ) : (
                              <iframe
                                title="Decision email preview"
                                srcdoc={selectedPreview.html}
                                sandbox=""
                                class="pk-framed"
                                height={420}
                              />
                            ))}
                          {previewTab === "text" && <pre class="pk-code-block pk-small">{selectedPreview.text}</pre>}
                          <Checkbox
                            id="proposal-decision-preview-confirm"
                            class="pk-small"
                            label="I reviewed the outgoing email preview and confirm this decision send."
                            checked={previewConfirmed}
                            onChange={(event) => setPreviewConfirmed((event.target as HTMLInputElement).checked)}
                          />
                        </div>
                      </div>
                    </PanelBody>
                  </Panel>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  disabled={saving || !canRecordDecision || !form.valid || !quorumMet || !preview || !previewConfirmed}
                  loading={saving}
                  title={!quorumMet ? `Requires ${minReviewsRequired} reviews` : undefined}
                >
                  {saving ? "Saving…" : "Record Decision"}
                </Button>
              </form>
            </>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
