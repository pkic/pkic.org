import type { ApplicationUpdate } from "../../../../../shared/schemas/membership-application-management";
import { useEffect, useState } from "preact/hooks";
import { Badge } from "../../../../components/Badge";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { fmt } from "../../ui";
import { type MembershipCategoryCatalogEntry } from "../../../../../shared/schemas/membership-categories";
import type { MembershipApplicationDetail } from "../../../../../shared/schemas/membership-application-management";
import { asString, asBool, asStringArray } from "./helpers";
import { ApplicationEditForm, type ApplicationEditFormValue } from "./ApplicationEditForm";
// `pk-datalist` and `pk-mono` are written here as class names rather than
// reached through a component, so this module has to pull their stylesheet
// into its own chunk. Without the import the summary renders unstyled and
// nothing complains.
import "../../../../ui/Content.css";

/**
 * Read-only application summary. Editing — correcting applicant-submitted
 * data without transitioning the stage — is a command in the record's own
 * actions menu (#109); the record tells the card when it is editing and the
 * card shows the editor in place of the summary, never by default.
 *
 * The summary is a description list. It was a two-column `<table>` with no
 * caption, which is announced as an unnamed grid sitting among the other
 * cards; these are label-and-value once each, which is what a `dl` is for.
 */
export function ApplicationOverviewCard({
  detail,
  categories,
  editing = false,
  onEditingChange,
  onSave,
}: {
  detail: MembershipApplicationDetail;
  categories: readonly MembershipCategoryCatalogEntry[];
  /** Whether the record has asked for the editor; the card never opens it on its own. */
  editing?: boolean;
  /** The record's way of learning that the editor closed — saved or cancelled. */
  onEditingChange?: (editing: boolean) => void;
  onSave: (edits: ApplicationUpdate) => Promise<void>;
}) {
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [editForm, setEditForm] = useState<ApplicationEditFormValue | null>(null);

  function setEditing(next: boolean) {
    onEditingChange?.(next);
  }

  // The draft is built from the record the moment the editor is asked for,
  // so it always starts from what is on screen.
  useEffect(() => {
    if (!editing) return;
    const answers = detail.answers;
    setEditForm({
      applicantName: detail.applicantName,
      applicantEmail: detail.applicantEmail,
      organizationName: detail.organizationName ?? "",
      membershipCategory: detail.membershipCategory,
      jobTitle: asString(answers.job_title),
      linkedin: asString(answers.linkedin),
      organizationWebsite: asString(answers.organization_website),
      aboutYourself: asString(answers.about_yourself),
      aboutOrganization: asString(answers.about_organization),
      reason: asString(answers.reason),
      extraAnswers: {
        contribution_type: asString(answers.contribution_type ?? answers.contributionType) || null,
        wants_to_present: asBool(answers.wants_to_present ?? answers.wantsToPresent),
        interested_in_sponsoring: asBool(answers.interested_in_sponsoring ?? answers.interestedInSponsoring),
        agrees_bylaws: asBool(answers.agrees_bylaws),
        agrees_code_of_conduct: asBool(answers.agrees_code_of_conduct),
        agrees_ipr_policy: asBool(answers.agrees_ipr_policy),
        warranted_authority: asBool(answers.warranted_authority ?? answers.warrantedAuthority),
        working_groups: asStringArray(answers.working_groups),
      },
    });
    setEditError("");
    // Only the opening matters: the record is what the draft is read from.
  }, [editing]);

  async function saveEdit(body: ApplicationUpdate) {
    if (!editForm) return;
    setEditSaving(true);
    setEditError("");
    try {
      await onSave(body);
      setEditing(false);
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div class="pk">
      <Panel aria-label="Application">
        <PanelHeader title="Application" />
        <PanelBody>
          {!editing ? (
            <dl class="pk-datalist pk-small">
              <dt>Applicant name</dt>
              <dd>{detail.applicantName}</dd>

              <dt>Email</dt>
              <dd class="pk-break">{detail.applicantEmail}</dd>

              <dt>Organization</dt>
              <dd>{detail.organizationName ?? "Individual — no organization"}</dd>

              <dt>Category</dt>
              <dd>
                {detail.membershipCategoryLabel} <span class="pk-mono">({detail.membershipCategory})</span>
              </dd>

              <dt>Stage</dt>
              <dd>
                <Badge status={detail.stage} />
              </dd>

              {detail.onHoldSubtype && (
                <>
                  <dt>On-hold reason</dt>
                  <dd>{detail.onHoldSubtype}</dd>
                </>
              )}

              <dt>Stage entered</dt>
              <dd class="pk-mono">{fmt(detail.stageEnteredAt)}</dd>

              <dt>Submitted</dt>
              <dd class="pk-mono">{fmt(detail.createdAt)}</dd>
            </dl>
          ) : (
            editForm && (
              <>
                <p class="pk-small">
                  Corrections cannot reuse completed reviews or existing payment checkouts. If review evidence exists,
                  first preview a restart under “Restart or change workflow.” The application category remains fixed.
                </p>
                <ApplicationEditForm
                  form={editForm}
                  answerFields={detail.answerFields}
                  requestedWorkingGroups={detail.requestedWorkingGroups}
                  categories={categories}
                  onChange={(updater) => setEditForm((f) => (f ? updater(f) : f))}
                  disabled={editSaving}
                  error={editError}
                  onSave={saveEdit}
                  onCancel={() => setEditing(false)}
                  saving={editSaving}
                />
              </>
            )
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
