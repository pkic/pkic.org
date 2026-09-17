import { WorkflowMigrationCard } from "./WorkflowMigrationCard";
import { isApplicationTerminalStage } from "../../../../../shared/schemas/member-applications";
import { ButtonLink } from "../../../../ui/Button";
/**
 * One membership application as a record: who applied, in the header, with
 * the stage beside the name and the record's commands in its own menu; then
 * facets, each a routed tab — the application itself, the correspondence,
 * the council's decisions, the consultation concerns (#109).
 *
 * Nothing opens in edit mode: editing the application is a command in the
 * menu that reveals the editor in place, and the transition form stands
 * beside the application because moving the stage is the record's work.
 */
import { useState } from "preact/hooks";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Badge } from "../../../../components/Badge";
import { Tabs } from "../../../../components/Tabs";
import { usePortalHashLocation } from "../../hash-location";
import { Avatar } from "../../../../ui/Avatar";
import { Breadcrumb } from "../../../../ui/Breadcrumb";
import { Menu, type MenuItem } from "../../../../ui/Menu";
import { ProfileHeader } from "../../../../ui/ProfileHeader";
import { fmt } from "../../ui";
import { useApplicationDetail } from "./useApplicationDetail";
import { ApplicationOverviewCard } from "./ApplicationOverviewCard";
import { ApplicationAnswersCard } from "./ApplicationAnswersCard";
import { ApplicationTransitionCard } from "./ApplicationTransitionCard";
import { ApplicationDocumentsCard } from "./ApplicationDocumentsCard";
import { ApplicationTimelineCard } from "./ApplicationTimelineCard";
import { ApplicationCommunicationsCard } from "./ApplicationCommunicationsCard";
import type { MembershipCategoryCatalogEntry } from "../../../../../shared/schemas/membership-categories";

export const APPLICATION_TABS = [
  { key: "overview", label: "Application" },
  { key: "communications", label: "Communications" },
] as const;
export type ApplicationTab = (typeof APPLICATION_TABS)[number]["key"];

function resolveTab(requested: string | undefined): ApplicationTab {
  return APPLICATION_TABS.some((tab) => tab.key === requested) ? (requested as ApplicationTab) : "overview";
}

export function ApplicationDetailView({
  applicationId,
  categories,
  canWrite,
  canApprove,
  tab,
}: {
  applicationId: string;
  categories: readonly MembershipCategoryCatalogEntry[];
  canWrite: boolean;
  canApprove: boolean;
  /** The URL-addressed facet; undefined or unknown opens the application itself. */
  tab?: string;
}) {
  const { loading, error, detail, transition, sendCommunication, addNote, saveEdit } =
    useApplicationDetail(applicationId);
  const [editing, setEditing] = useState(false);
  const activeTab = resolveTab(tab);
  const basePath = `/membership/applications/${encodeURIComponent(applicationId)}`;

  if (loading) return <Spinner label="Loading this application…" />;
  if (error && !detail) return <ErrorAlert error={error} />;
  if (!detail) return null;

  const commands: MenuItem[] = canWrite
    ? [
        {
          id: "edit",
          label: editing ? "Close the editor" : "Edit application…",
          // The category list is what the edit form's one required choice is
          // built from, so without it there is nothing to edit into.
          disabled: !editing && categories.length === 0,
          onSelect: () => setEditing((current) => !current),
        },
      ]
    : [];

  return (
    <div class="pk pk-stack" data-application-id={applicationId}>
      {error && <ErrorAlert error={error} />}
      <Breadcrumb
        items={[
          { label: "Membership applications", href: usePortalHashLocation.hrefs("/membership/applications") },
          { label: detail.applicantName },
        ]}
      />
      <ProfileHeader
        media={<Avatar name={detail.applicantName} size="xl" />}
        title={detail.applicantName}
        context={<Badge status={detail.stage} />}
        lede={detail.organizationName ?? "Individual applicant"}
        facts={[
          detail.applicantEmail,
          detail.membershipCategoryLabel,
          `Submitted ${fmt(detail.createdAt)}`,
          ...(detail.onHoldSubtype ? [`On hold: ${detail.onHoldSubtype.replaceAll("_", " ")}`] : []),
        ]}
        actions={commands.length > 0 ? <Menu label="Application actions" items={commands} align="end" /> : undefined}
        navigation={
          <Tabs
            label="Application sections"
            items={[...APPLICATION_TABS]}
            active={activeTab}
            hrefFor={(key) => (key === "overview" ? basePath : `${basePath}/${key}`)}
          />
        }
      />

      {activeTab === "overview" && (
        <div class="pk-record">
          <div class="pk-stack">
            <ApplicationOverviewCard
              detail={detail}
              categories={categories}
              editing={editing}
              onEditingChange={setEditing}
              onSave={saveEdit}
            />
            <ApplicationAnswersCard detail={detail} />
            <ApplicationDocumentsCard applicationId={detail.id} />
          </div>
          <aside class="pk-stack">
            {(canWrite || canApprove) && (
              <ApplicationTransitionCard detail={detail} canWrite={canWrite} onTransition={transition} />
            )}
            <ButtonLink href={usePortalHashLocation.hrefs(`${basePath}/review`)}>
              Review workflow and objections
            </ButtonLink>
            {canApprove && !isApplicationTerminalStage(detail.stage) && (
              <WorkflowMigrationCard applicationId={applicationId} />
            )}
            <ApplicationTimelineCard detail={detail} />
          </aside>
        </div>
      )}
      {activeTab === "communications" && (
        <ApplicationCommunicationsCard
          detail={detail}
          canWrite={canWrite}
          onSendCommunication={sendCommunication}
          onAddNote={addNote}
        />
      )}
    </div>
  );
}
