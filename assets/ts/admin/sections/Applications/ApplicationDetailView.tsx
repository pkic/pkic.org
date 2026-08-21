import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Badge } from "../../../components/Badge";
import { useApplicationDetail } from "./useApplicationDetail";
import { ApplicationOverviewCard } from "./ApplicationOverviewCard";
import { ApplicationAnswersCard } from "./ApplicationAnswersCard";
import { ApplicationTransitionCard } from "./ApplicationTransitionCard";
import { ApplicationDocumentsCard } from "./ApplicationDocumentsCard";
import { ApplicationTimelineCard } from "./ApplicationTimelineCard";
import { ApplicationCommunicationsCard } from "./ApplicationCommunicationsCard";
import { ApplicationEcDecisionsCard } from "./ApplicationEcDecisionsCard";
import { ApplicationConcernsCard } from "./ApplicationConcernsCard";

export function ApplicationDetailView({ applicationId, onBack }: { applicationId: string; onBack: () => void }) {
  const { loading, error, detail, transition, sendCommunication, addNote, recordEcDecision, approve, saveEdit } =
    useApplicationDetail(applicationId);

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!detail) return null;

  return (
    <div>
      <div class="d-flex align-items-center gap-2 mb-3">
        <button class="btn btn-sm btn-outline-secondary" onClick={onBack}>
          ← Back to list
        </button>
        <span class="page-heading mb-0">{detail.applicantName}</span>
        <Badge status={detail.stage} />
      </div>

      <div class="row g-4">
        <div class="col-md-6">
          <ApplicationOverviewCard detail={detail} onSave={saveEdit} />
          <ApplicationAnswersCard detail={detail} />
          <ApplicationTransitionCard detail={detail} onApprove={approve} onTransition={transition} />
          <ApplicationDocumentsCard detail={detail} />
        </div>

        <div class="col-md-6">
          <ApplicationTimelineCard detail={detail} />
          <ApplicationCommunicationsCard detail={detail} onSendCommunication={sendCommunication} onAddNote={addNote} />
          <ApplicationEcDecisionsCard detail={detail} onRecordEcDecision={recordEcDecision} />
          <ApplicationConcernsCard detail={detail} />
        </div>
      </div>
    </div>
  );
}
