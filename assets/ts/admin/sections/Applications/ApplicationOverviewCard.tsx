import { useState } from "preact/hooks";
import { Badge } from "../../../components/Badge";
import { fmt } from "../../ui";
import { INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "../../../../shared/schemas/admin-members";
import type { AdminApplicationDetail } from "../../types";
import { asString } from "./helpers";
import { ApplicationEditForm, type ApplicationEditFormValue } from "./ApplicationEditForm";

/**
 * Read-only application summary, with an in-place edit toggle for
 * correcting applicant-submitted data (typos etc.) without transitioning
 * the stage — mirrors Users.tsx's UserDetailView edit-toggle pattern.
 */
export function ApplicationOverviewCard({
  detail,
  onSave,
}: {
  detail: AdminApplicationDetail;
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
      const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(editForm.membershipCategory);
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
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold d-flex justify-content-between align-items-center">
        <span>Application</span>
        {!editing && (
          <button class="btn btn-sm btn-outline-primary" onClick={startEditing}>
            Edit
          </button>
        )}
      </div>
      <div class="card-body">
        {!editing ? (
          <table class="table table-sm table-borderless mb-0">
            <tbody>
              <tr>
                <th class="text-muted small">Applicant name</th>
                <td>{detail.applicantName}</td>
              </tr>
              <tr>
                <th class="text-muted small">Email</th>
                <td>{detail.applicantEmail}</td>
              </tr>
              <tr>
                <th class="text-muted small">Organization</th>
                <td>{detail.organizationName ?? <span class="fst-italic text-muted">Individual</span>}</td>
              </tr>
              <tr>
                <th class="text-muted small">Category</th>
                <td class="mono">{detail.membershipCategory}</td>
              </tr>
              <tr>
                <th class="text-muted small">Stage</th>
                <td>
                  <Badge status={detail.stage} />
                </td>
              </tr>
              {detail.onHoldSubtype && (
                <tr>
                  <th class="text-muted small">On-hold reason</th>
                  <td>{detail.onHoldSubtype}</td>
                </tr>
              )}
              <tr>
                <th class="text-muted small">Stage entered</th>
                <td class="mono small">{fmt(detail.stageEnteredAt)}</td>
              </tr>
              <tr>
                <th class="text-muted small">Submitted</th>
                <td class="mono small">{fmt(detail.createdAt)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          editForm && (
            <ApplicationEditForm
              form={editForm}
              onChange={(updater) => setEditForm((f) => (f ? updater(f) : f))}
              disabled={editSaving}
              error={editError}
              onSave={() => void saveEdit()}
              onCancel={() => setEditing(false)}
              saving={editSaving}
            />
          )
        )}
      </div>
    </div>
  );
}
