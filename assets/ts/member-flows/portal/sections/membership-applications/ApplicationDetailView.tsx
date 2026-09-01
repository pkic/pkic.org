import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Badge } from "../../../../components/Badge";
import { usePortalHashLocation } from "../../hash-location";
import { PageHeader } from "../../../../ui/PageHeader";
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
}: {
  applicationId: string;
  categories: MembershipCategoryCatalogEntry[];
  canWrite: boolean;
  canApprove: boolean;
}) {
  const { loading, error, detail, transition, sendCommunication, addNote, recordEcDecision, approve, saveEdit } =
    useApplicationDetail(applicationId);

  if (loading) return <Spinner label="Loading this application…" />;
  if (error) return <ErrorAlert error={error} />;
  if (!detail) return null;

  return (
    <div class="pk pk-stack">
      {/* The applicant heads the page over a trail back to the queue; the
          stage stands beside the name. The back button this replaces
          duplicated the trail in button's clothing. */}
      <PageHeader
        trail={[
          { label: "Membership applications", href: usePortalHashLocation.hrefs("/membership/applications") },
          { label: detail.applicantName },
        ]}
        title={detail.applicantName}
        context={<Badge status={detail.stage} />}
      />

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
