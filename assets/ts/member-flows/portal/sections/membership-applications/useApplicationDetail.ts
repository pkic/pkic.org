import { useCallback, useEffect, useState } from "preact/hooks";
import { getJson, patchJson, postJson } from "../../../../shared/api-client";
import { toast } from "../../ui";
import type {
  ApplicationCommunicationCreate,
  ApplicationUpdate,
  MembershipApplicationDetail,
} from "../../../../../shared/schemas/membership-application-management";
import {
  membershipApplicationDetailSchema,
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
      throw e;
    }
  }

  /**
   * `params` is already the canonical request body the card checked against
   * applicationCommunicationCreateSchema, so it is sent as it stands rather
   * than re-copied field by field. It carries no `templateKey`: the card
   * offers no template to choose, and under that contract the typed subject
   * and body are what the applicant receives.
   */
  async function sendCommunication(params: ApplicationCommunicationCreate) {
    try {
      await postJson(
        `/api/v1/members/applications/${applicationId}/communications`,
        params,
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

  /** Throws on failure — caller (the overview card) owns editSaving/editError local state. */
  async function saveEdit(edits: ApplicationUpdate) {
    await patchJson(`/api/v1/members/applications/${applicationId}`, edits, membershipApplicationDetailSchema);
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
    saveEdit,
  };
}
