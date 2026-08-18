import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { toast } from "../../ui";
import type { AdminApplicationDetail, AdminWorkingGroupSummary } from "../../types";

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
  const [workingGroupLabels, setWorkingGroupLabels] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<AdminApplicationDetail>(`/api/v1/admin/applications/${applicationId}`);
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

  useEffect(() => {
    // Labels for the working_groups answer (array of slugs) — read from the
    // managed working_groups table instead of a hand-typed slug->name copy.
    api<{ workingGroups: AdminWorkingGroupSummary[] }>("/api/v1/admin/working-groups")
      .then((d) => setWorkingGroupLabels(Object.fromEntries(d.workingGroups.map((g) => [g.slug, g.name]))))
      .catch(() => setWorkingGroupLabels({}));
  }, []);

  async function transition(params: { toStage: string; onHoldSubtype?: string; note?: string }) {
    try {
      await api(`/api/v1/admin/applications/${applicationId}/stage`, {
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
      await api(`/api/v1/admin/applications/${applicationId}/communications`, {
        method: "POST",
        body: JSON.stringify({ subject: params.subject, body: params.body }),
      });
      toast("Communication sent", "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function addNote(body: string) {
    try {
      await api(`/api/v1/admin/applications/${applicationId}/notes`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      toast("Note added", "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function recordEcDecision(params: {
    ecMemberUserId: string;
    decision: "approve" | "decline";
    reason?: string;
  }) {
    try {
      await api(`/api/v1/admin/applications/${applicationId}/ec-decisions`, {
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
      await api(`/api/v1/admin/applications/${applicationId}/approve`, { method: "POST" });
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
    await api(`/api/v1/admin/applications/${applicationId}`, {
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
    workingGroupLabels,
    reload,
    transition,
    sendCommunication,
    addNote,
    recordEcDecision,
    approve,
    saveEdit,
  };
}
