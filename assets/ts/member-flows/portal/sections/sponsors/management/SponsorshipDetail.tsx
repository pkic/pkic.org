import { useData } from "../../../../../hooks/useData";
import { useState, useRef } from "preact/hooks";
import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { getJson } from "../../../../../shared/api-client";
import { sponsorshipResponseSchema } from "../../../../../../shared/schemas/sponsorship-management";
import { fmtCalendarDate } from "../../../ui";
import type { Sponsorship } from "../../../../../../shared/schemas/sponsorship-management";
import type { ApiTableActions } from "../../../../../components/ApiDataTable";
import { Badge, statusLabel } from "../../../../../components/Badge";
import { Breadcrumb } from "../../../../../ui/Breadcrumb";
import { DescriptionList, type DescriptionListItem } from "../../../../../ui/DescriptionList";
import { Menu, type MenuItem } from "../../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { ProfileHeader } from "../../../../../ui/ProfileHeader";
import { usePortalHashLocation } from "../../../hash-location";
import { SponsorshipStageDialog } from "./SponsorshipStageDialog";
import { SponsorshipHistory } from "./SponsorshipHistory";
import { SponsorshipLogo } from "./SponsorshipLogo";
import { SponsorshipRecordForm } from "./SponsorshipRecordForm";
import { Markdown } from "../../../../../ui/Markdown";
import { ExternalLink } from "../../../../../ui/ExternalLink";

/** What the sponsorship is called, falling through the names it may carry. */
function sponsorTitle(sponsorship: Sponsorship): string {
  return sponsorship.organizationName ?? sponsorship.nonMemberName ?? sponsorship.contactName ?? "Sponsor";
}

export function SponsorshipDetail({
  id,
  canWrite,
  onChanged,
}: {
  id: string;
  canWrite: boolean;
  onChanged?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  // The stage move is a dialog the record's menu opens, never a form
  // standing open in the pipeline panel (#116).
  const [advancing, setAdvancing] = useState(false);
  const historyRef = useRef<ApiTableActions | null>(null);

  const {
    data: sponsorship,
    loading,
    error,
    reload: load,
  } = useData(async () => {
    const response = await getJson(`/api/v1/sponsors/${encodeURIComponent(id)}`, sponsorshipResponseSchema);
    return response.sponsorship;
  }, [id]);

  if (loading) return <Spinner />;
  if (error && !sponsorship) return <ErrorAlert error={error} />;
  if (!sponsorship) return null;

  const title = sponsorTitle(sponsorship);
  const facts: DescriptionListItem[] = [
    { term: "Type", value: `${statusLabel(sponsorship.sponsorType)} sponsorship` },
    { term: "Tier", value: sponsorship.tier },
    { term: "Event", value: sponsorship.eventName },
    {
      term: "Contact",
      value: sponsorship.contactEmail
        ? `${sponsorship.contactName ?? sponsorship.contactEmail} <${sponsorship.contactEmail}>`
        : null,
    },
    {
      term: "Website",
      // Printed as plain text, so staff had to select and paste an address
      // that was already a destination. Same class as issue #13: a link that
      // is not presented as one.
      value: sponsorship.nonMemberWebsite ? (
        <ExternalLink class="pk-break" href={sponsorship.nonMemberWebsite} external>
          {sponsorship.nonMemberWebsite.replace(/^https?:\/\//, "")}
        </ExternalLink>
      ) : null,
    },
    { term: "Assigned staff", value: sponsorship.assignedToName },
    { term: "Renewal date", value: sponsorship.renewalDate ? fmtCalendarDate(sponsorship.renewalDate) : null },
    { term: "Notes", value: sponsorship.notes ? <Markdown markdown={sponsorship.notes} /> : null },
  ];

  const commands: MenuItem[] = [
    { id: "edit", label: "Edit record…", disabled: editing, onSelect: () => setEditing(true) },
    { id: "stage", label: "Move stage…", onSelect: () => setAdvancing(true) },
  ];

  return (
    // The record page, with the same anatomy as an organization's: a trail,
    // the subject's header carrying its standing and its commands in the `…`
    // menu, the facts taking the width and the pipeline keeping the column
    // beside them. Every form here is closed until asked for through the
    // menu: a reader who opened a sponsorship to look at it is not handed
    // forms to fill in, and there are no buttons on the cards (#116).
    <section class="pk pk-stack" aria-label={title}>
      {error && <ErrorAlert error={error} />}
      <Breadcrumb items={[{ label: "Sponsors", href: usePortalHashLocation.hrefs("/sponsors") }, { label: title }]} />
      <ProfileHeader
        title={title}
        lede={[`${statusLabel(sponsorship.sponsorType)} sponsorship`, sponsorship.tier].filter(Boolean).join(" · ")}
        context={<Badge status={sponsorship.pipelineStage} />}
        facts={[
          sponsorship.eventName,
          sponsorship.contactEmail ? (sponsorship.contactName ?? sponsorship.contactEmail) : null,
          sponsorship.renewalDate ? `Renews ${fmtCalendarDate(sponsorship.renewalDate)}` : null,
        ].filter((fact): fact is string => Boolean(fact))}
        actions={canWrite ? <Menu label="Sponsorship actions" align="end" items={commands} /> : undefined}
      />
      {canWrite && advancing && (
        <SponsorshipStageDialog
          sponsorship={sponsorship}
          title={title}
          onCancel={() => setAdvancing(false)}
          onSaved={async () => {
            setAdvancing(false);
            await Promise.all([load(), historyRef.current?.reload() ?? Promise.resolve()]);
            onChanged?.();
          }}
        />
      )}
      <div class="pk-record">
        <Panel aria-label="Sponsorship record">
          <PanelHeader title="Record" />
          <PanelBody class="pk-stack">
            {!editing && <DescriptionList items={facts} density="compact" />}
            {canWrite && editing && (
              <SponsorshipRecordForm
                sponsorship={sponsorship}
                onSaved={async () => {
                  setEditing(false);
                  await load();
                  onChanged?.();
                }}
                onCancel={() => setEditing(false)}
              />
            )}
            {canWrite && !sponsorship.organizationId && <SponsorshipLogo sponsorship={sponsorship} onChanged={load} />}
          </PanelBody>
        </Panel>

        <Panel aria-label="Pipeline">
          <PanelHeader title="Pipeline" />
          <PanelBody class="pk-stack">
            <DescriptionList
              density="compact"
              items={[
                { term: "Stage", value: <Badge status={sponsorship.pipelineStage} /> },
                { term: "Assigned staff", value: sponsorship.assignedToName },
              ]}
            />
            <p class="pk-small pk-muted">Every stage this sponsorship has passed through is listed below the record.</p>
          </PanelBody>
        </Panel>
      </div>

      {/* The trail is a table of four columns, so it takes the page's width
          rather than the narrow column the pipeline panel keeps beside the
          record — where a note wraps to one word per line. */}
      <SponsorshipHistory sponsorshipId={id} actionsRef={historyRef} />
    </section>
  );
}
