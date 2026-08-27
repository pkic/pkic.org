import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Badge } from "../../../../components/Badge";
import { useApplicationDetail } from "./useApplicationDetail";
import { ApplicationOverviewCard } from "./ApplicationOverviewCard";
import { ApplicationAnswersCard } from "./ApplicationAnswersCard";
import { ApplicationTransitionCard } from "./ApplicationTransitionCard";
import { ApplicationDocumentsCard } from "./ApplicationDocumentsCard";
import { ApplicationTimelineCard } from "./ApplicationTimelineCard";
import { ApplicationCommunicationsCard } from "./ApplicationCommunicationsCard";
import { ApplicationEcDecisionsCard } from "./ApplicationEcDecisionsCard";
import { ApplicationConcernsCard } from "./ApplicationConcernsCard";
import type { MembershipCategoryCatalogEntry } from "../../../../../shared/schemas/membership-categories";

export function ApplicationDetailView({
  applicationId,
  categories,
  canWrite,
  canApprove,
  onBack,
}: {
  applicationId: string;
  categories: MembershipCategoryCatalogEntry[];
  canWrite: boolean;
  canApprove: boolean;
  onBack: () => void;
}) {
  const { loading, error, detail, transition, sendCommunication, addNote, recordEcDecision, approve, saveEdit } =
    useApplicationDetail(applicationId);

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!detail) return null;

  return (
    <div>
      <div class="d-flex align-items-center gap-2 mb-3">
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onBack}>
          ← Back to list
        </button>
        <span class="page-heading mb-0">{detail.applicantName}</span>
        <Badge status={detail.stage} />
      </div>

      <div class="row g-4">
        <div class="col-md-6">
          <ApplicationOverviewCard detail={detail} categories={categories} canWrite={canWrite} onSave={saveEdit} />
          <ApplicationAnswersCard detail={detail} />
          {(canWrite || canApprove) && (
            <ApplicationTransitionCard
              detail={detail}
              canWrite={canWrite}
              canApprove={canApprove}
              onApprove={approve}
              onTransition={transition}
            />
          )}
          <ApplicationDocumentsCard applicationId={detail.id} />
        </div>

        <div class="col-md-6">
          <ApplicationTimelineCard detail={detail} />
          <ApplicationCommunicationsCard
            detail={detail}
            canWrite={canWrite}
            onSendCommunication={sendCommunication}
            onAddNote={addNote}
          />
          <ApplicationEcDecisionsCard detail={detail} canApprove={canApprove} onRecordEcDecision={recordEcDecision} />
          <ApplicationConcernsCard detail={detail} />
        </div>
      </div>
    </div>
  );
}
