import {
  proposalProgramSchema,
  proposalProgramsListResponseSchema,
} from "../../../../../shared/schemas/proposal-programs";
import type { z } from "zod";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { EmptyState } from "../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { fmt } from "../../ui";

type ProposalProgram = z.infer<typeof proposalProgramSchema>;

function capabilityLabel(program: ProposalProgram): string {
  if (program.access.canFinalize) return "Manage program";
  if (program.access.canReview) return "Review proposals";
  if (program.access.canEditAcceptedAbstract || program.access.canCancelAcceptedProposal) return "Program corrections";
  return "View proposals";
}

/** Server-derived catalog for program committee work not tied to generic group membership or management. */
export function ProposalPrograms() {
  return (
    <div class="pk">
      <Panel aria-label="Proposal programs">
        <PanelHeader title="Proposal programs" />
        {/* The body owns the gap between the explanation and the table; the
            paragraph carried its own bottom margin before. */}
        <PanelBody class="pk-stack">
          <p class="pk-small">
            Programs appear here only when you can read that event&apos;s proposals. Review and management capabilities
            are independent, and this does not grant access to other group resources.
          </p>
          <ApiDataTable
            caption="Proposal programs"
            endpoint="/api/v1/proposals/programs"
            responseSchema={proposalProgramsListResponseSchema}
            resolve={(response) => response.programs}
            resolvePage={(response) => response.page}
            paginate
            initialSort="eventName"
            searchPlaceholder="Search programs…"
            columns={[
              {
                header: "Event",
                cell: (program) => (
                  <div class="pk-stack pk-stack--tight">
                    <span class="pk-strong">{program.event.name}</span>
                    <span class="pk-small">{program.group.name}</span>
                  </div>
                ),
                sort: { asc: "eventName", desc: "-eventName", defaultDirection: "asc" },
              },
              {
                header: "Starts",
                cell: (program) => fmt(program.event.startsAt),
                className: "pk-small pk-nowrap",
                sort: { asc: "startsAt", desc: "-startsAt" },
              },
              {
                header: "Access",
                cell: (program) => (
                  <Badge
                    status={program.access.canFinalize ? "accepted" : "under_review"}
                    label={capabilityLabel(program)}
                  />
                ),
              },
            ]}
            empty={
              <EmptyState
                title="No proposal programs are available to your current identity."
                body="A program appears here once you can read that event's proposals. Switching identity may show others."
              />
            }
            rowKey={(program) => `${program.group.id}:${program.event.id}`}
            rowAction={(program) => ({
              label: `Open proposals for ${program.event.name}`,
              href: `#/groups/${encodeURIComponent(program.group.id)}/events/${encodeURIComponent(program.event.id)}/proposals`,
            })}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
