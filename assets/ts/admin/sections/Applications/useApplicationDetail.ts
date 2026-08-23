import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { toast } from "../../ui";
import type { AdminApplicationDetail } from "../../types";
import type { EcDecisionValue } from "../../../../shared/schemas/ec-review";
import {
  adminApplicationDetailSchema,
  adminEcDecisionCreateResponseSchema,
  applicationApproveResponseSchema,
  applicationCommunicationCreateResponseSchema,
  applicationNoteCreateResponseSchema,
  applicationStageTransitionResponseSchema,
} from "../../../../shared/schemas/admin-applications";

/**
 * Data + mutation commands for one application's detail view: transition,
 * communication, note, EC-decision, approve, and edit. Extracted from
 * Applications.tsx so the cards under this directory can stay presentation-
 * only (PR #1 review, Phase 8).
 */
export function useApplicationDetail(applicationId: string) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminApplicationDetail | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api(`/api/v1/admin/applications/${applicationId}`, adminApplicationDetailSchema);
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
      await api(`/api/v1/admin/applications/${applicationId}/stage`, applicationStageTransitionResponseSchema, {
        method: "PATCH",
        body: JSON.stringify({
          toStage: params.toStage,
          onHoldSubtype: params.toStage === "on_hold" ? params.onHoldSubtype : undefined,
          note: params.note || undefined,
        }),
      });
      toast(`Application moved to '${params.toStage}'`, "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function sendCommunication(params: { subject: string; body: string }) {
    try {
      await api(
        `/api/v1/admin/applications/${applicationId}/communications`,
        applicationCommunicationCreateResponseSchema,
        {
          method: "POST",
          body: JSON.stringify({ subject: params.subject, body: params.body }),
        },
      );
      toast("Communication sent", "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function addNote(body: string) {
    try {
      await api(`/api/v1/admin/applications/${applicationId}/notes`, applicationNoteCreateResponseSchema, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      toast("Note added", "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function recordEcDecision(params: { ecMemberUserId: string; decision: EcDecisionValue; reason?: string }) {
    try {
      await api(`/api/v1/admin/applications/${applicationId}/ec-decisions`, adminEcDecisionCreateResponseSchema, {
        method: "POST",
        body: JSON.stringify({
          ecMemberUserId: params.ecMemberUserId,
          decision: params.decision,
          reason: params.reason || undefined,
        }),
      });
      toast("EC decision recorded", "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function approve() {
    if (!confirm("Approve this application and run onboarding?")) return;
    try {
      await api(`/api/v1/admin/applications/${applicationId}/approve`, applicationApproveResponseSchema, {
        method: "POST",
      });
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
    await api(`/api/v1/admin/applications/${applicationId}`, adminApplicationDetailSchema, {
      method: "PATCH",
      body: JSON.stringify({
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
      }),
    });
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
