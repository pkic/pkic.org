import { useState } from "preact/hooks";
import { Badge } from "../../../../components/Badge";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { fmt } from "../../ui";
import {
  isIndividualMembershipCategory,
  type MembershipCategoryCatalogEntry,
} from "../../../../../shared/schemas/membership-categories";
import type { MembershipApplicationDetail } from "../../../../../shared/schemas/membership-application-management";
import { asString } from "./helpers";
import { ApplicationEditForm, type ApplicationEditFormValue } from "./ApplicationEditForm";
// `pk-datalist` and `pk-mono` are written here as class names rather than
// reached through a component, so this module has to pull their stylesheet
// into its own chunk. Without the import the summary renders unstyled and
// nothing complains.
import "../../../../ui/Content.css";

/**
 * Read-only application summary, with an in-place edit toggle for
 * correcting applicant-submitted data (typos etc.) without transitioning
 * the stage — mirrors Users.tsx's UserDetailView edit-toggle pattern.
 *
 * The summary is a description list. It was a two-column `<table>` with no
 * caption, which is announced as an unnamed grid sitting among the other
 * cards; these are label-and-value once each, which is what a `dl` is for.
 */
export function ApplicationOverviewCard({
  detail,
  categories,
  canWrite,
  onSave,
}: {
  detail: MembershipApplicationDetail;
  categories: MembershipCategoryCatalogEntry[];
  canWrite: boolean;
  onSave: (edits: {
    applicantName: string;
    applicantEmail: string;
    organizationName: string | null;
    membershipCategory: string;
    jobTitle: string | null;
    linkedin: string | null;
    organizationWebsite: string | null;
    aboutYourself: string | null;
    aboutOrganization: string | null;
    reason: string | null;
  }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [editForm, setEditForm] = useState<ApplicationEditFormValue | null>(null);

  function startEditing() {
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
    });
    setEditError("");
    setEditing(true);
  }

  async function saveEdit() {
    if (!editForm) return;
    setEditSaving(true);
    setEditError("");
    try {
      const isIndividual = isIndividualMembershipCategory(editForm.membershipCategory);
      await onSave({
        applicantName: editForm.applicantName,
        applicantEmail: editForm.applicantEmail,
        organizationName: isIndividual ? null : editForm.organizationName || null,
        membershipCategory: editForm.membershipCategory,
        jobTitle: editForm.jobTitle || null,
        linkedin: editForm.linkedin || null,
        organizationWebsite: editForm.organizationWebsite || null,
        aboutYourself: editForm.aboutYourself || null,
        aboutOrganization: editForm.aboutOrganization || null,
        reason: editForm.reason || null,
      });
      setEditing(false);
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div class="pk">
      <Panel aria-label="Application">
        <PanelHeader title="Application">
          {canWrite &&
            !editing &&
            /*
             * The category list is what the edit form's one required choice is
             * built from, so without it there is nothing to edit into. The
             * surface used to render a disabled button and say nothing, which
             * reads as "broken" rather than "waiting"; the sentence says which.
             */
            (categories.length === 0 ? (
              <span class="pk-small">Editing needs the membership categories, which are not available.</span>
            ) : (
              <Button size="sm" variant="primary" onClick={startEditing}>
                Edit
              </Button>
            ))}
        </PanelHeader>
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
              <ApplicationEditForm
                form={editForm}
                categories={categories}
                onChange={(updater) => setEditForm((f) => (f ? updater(f) : f))}
                disabled={editSaving}
                error={editError}
                onSave={() => void saveEdit()}
                onCancel={() => setEditing(false)}
                saving={editSaving}
              />
            )
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
