import { useCallback, useEffect, useState } from "preact/hooks";
import { getJson, patchJson, postJson } from "../../../../shared/api-client";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { toast } from "../../ui";
import type {
  EcDecisionRecordInput,
  MembershipApplicationDetail,
} from "../../../../../shared/schemas/membership-application-management";
import {
  membershipApplicationDetailSchema,
  ecDecisionRecordResponseSchema,
  applicationApproveResponseSchema,
  applicationCommunicationCreateResponseSchema,
  applicationNoteCreateResponseSchema,
  applicationStageTransitionResponseSchema,
} from "../../../../../shared/schemas/membership-application-management";

/**
 * Data + mutation commands for one application's detail view: transition,
 * communication, note, EC-decision, approve, and edit. Extracted from
 * Applications.tsx so the cards under this directory can stay presentation-
 * only (PR #1 review, Phase 8).
 */
export function useApplicationDetail(applicationId: string) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MembershipApplicationDetail | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getJson(`/api/v1/members/applications/${applicationId}`, membershipApplicationDetailSchema);
      setDetail(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function transition(params: { toStage: string; onHoldSubtype?: string; note?: string }) {
    try {
      await patchJson(
        `/api/v1/members/applications/${applicationId}/stage`,
        {
          toStage: params.toStage,
          onHoldSubtype: params.toStage === "on_hold" ? params.onHoldSubtype : undefined,
          note: params.note || undefined,
        },
        applicationStageTransitionResponseSchema,
      );
      toast(`Application moved to '${params.toStage}'`, "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function sendCommunication(params: { subject: string; body: string }) {
    try {
      await postJson(
        `/api/v1/members/applications/${applicationId}/communications`,
        { subject: params.subject, body: params.body },
        applicationCommunicationCreateResponseSchema,
      );
      toast("Communication sent", "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
      // The card keeps the draft and marks the field a refusal names.
      throw e;
    }
  }

  async function addNote(body: string) {
    try {
      await postJson(
        `/api/v1/members/applications/${applicationId}/notes`,
        { body },
        applicationNoteCreateResponseSchema,
      );
      toast("Note added", "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
      throw e;
    }
  }

  async function recordEcDecision(decision: EcDecisionRecordInput) {
    try {
      await postJson(
        `/api/v1/members/applications/${applicationId}/ec-decisions`,
        decision,
        ecDecisionRecordResponseSchema,
      );
      toast("EC decision recorded", "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
      throw e;
    }
  }

  async function approve() {
    const applicantName = detail?.applicantName ?? "this applicant";
    const confirmed = await confirmAction({
      title: `Approve ${applicantName}'s application and run onboarding?`,
      consequences: [
        "The applicant becomes a member and receives their onboarding communication",
        "Membership records and access are created for them immediately",
      ],
      confirmLabel: "Approve & run onboarding",
      tone: "primary",
    });
    if (!confirmed) return;
    try {
      await postJson(`/api/v1/members/applications/${applicationId}/approve`, {}, applicationApproveResponseSchema);
      toast("Application approved", "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  /** Throws on failure — caller (the overview card) owns editSaving/editError local state. */
  async function saveEdit(edits: {
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
  }) {
    await patchJson(
      `/api/v1/members/applications/${applicationId}`,
      {
        applicantName: edits.applicantName,
        applicantEmail: edits.applicantEmail,
        organizationName: edits.organizationName,
        membershipCategory: edits.membershipCategory,
        answers: {
          job_title: edits.jobTitle,
          linkedin: edits.linkedin,
          organization_website: edits.organizationWebsite,
          about_yourself: edits.aboutYourself,
          about_organization: edits.aboutOrganization,
          reason: edits.reason,
        },
      },
      membershipApplicationDetailSchema,
    );
    toast("Application updated", "success");
    await reload();
  }

  return {
    loading,
    error,
    detail,
    reload,
    transition,
    sendCommunication,
    addNote,
    recordEcDecision,
    approve,
    saveEdit,
  };
}
