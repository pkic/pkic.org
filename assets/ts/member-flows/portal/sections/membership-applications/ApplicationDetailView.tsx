import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Badge } from "../../../../components/Badge";
import { Button } from "../../../../ui/Button";
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

/**
 * One membership application, as staff read and work it.
 *
 * The two columns are a `pk-grid`, not a twelve-column row: the cards reflow
 * to one column when they no longer fit rather than at a breakpoint someone
 * has to keep choosing. The applicant's name is a real `<h2>` — it used to be
 * a `<span>` carrying a legacy `page-heading` class, so the page it heads had
 * no heading at all in the outline.
 */
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

  if (loading) return <Spinner label="Loading this application…" />;
  if (error) return <ErrorAlert error={error} />;
  if (!detail) return null;

  return (
    <div class="pk pk-stack">
      <div class="pk-cluster">
        <Button size="sm" onClick={onBack}>
          ← Back to list
        </Button>
        <h2>{detail.applicantName}</h2>
        <Badge status={detail.stage} />
      </div>

      <div class="pk-grid pk-grid--roomy">
        <div class="pk-stack">
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

        <div class="pk-stack">
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
