import { useHashLocation } from "wouter/use-hash-location";
import {
  proposalProgramSchema,
  proposalProgramsListResponseSchema,
} from "../../../../../shared/schemas/proposal-programs";
import type { z } from "zod";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
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
  const [, navigate] = useHashLocation();

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Proposal programs</div>
      <div class="card-body">
        <p class="small text-muted">
          Programs appear here only when you can read that event's proposals. Review and management capabilities are
          independent, and this does not grant access to other group resources.
        </p>
        <ApiDataTable
          endpoint="/api/v1/me/proposal-programs"
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
                <div>
                  <div class="fw-semibold">{program.event.name}</div>
                  <div class="small text-muted">{program.group.name}</div>
                </div>
              ),
              sort: { asc: "eventName", desc: "-eventName", defaultDirection: "asc" },
            },
            {
              header: "Starts",
              cell: (program) => fmt(program.event.startsAt),
              className: "small",
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
            {
              header: "",
              className: "text-end",
              cell: () => <span class="btn btn-sm btn-outline-secondary">Open</span>,
            },
          ]}
          empty="No proposal programs are available to your current identity."
          rowKey={(program) => `${program.group.id}:${program.event.id}`}
          onRowClick={(program) =>
            navigate(
              `/groups/${encodeURIComponent(program.group.id)}/events/${encodeURIComponent(program.event.id)}/proposals`,
            )
          }
        />
      </div>
    </div>
  );
}
