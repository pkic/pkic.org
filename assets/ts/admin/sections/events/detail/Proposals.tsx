import { useHashLocation } from "wouter/use-hash-location";
import { Tabs } from "../../../../components/Tabs";
import { EventProposalsTable } from "../../../../components/proposals/EventProposalsTable";
import { EventEmail } from "./EventEmail";
import { EventFormResponses } from "./Forms";

function ProposalsList({ slug }: { slug: string }) {
  const [, navigate] = useHashLocation();

  return (
    <EventProposalsTable
      endpoint={`/api/v1/events/${encodeURIComponent(slug)}/proposals`}
      storageKey={`adm_proposal_filters_${slug}`}
      onSelect={(proposal) => navigate(`/events/${slug}/proposal/${proposal.id}`)}
      toolbarPrefix={(_, access) =>
        access?.canRead ? (
          <div class="btn-group" role="group" aria-label="Download event presentations">
            <a
              class="btn btn-sm btn-outline-secondary"
              href={`/api/v1/events/${encodeURIComponent(slug)}/presentations/archive`}
              title="Download the current presentation for every accepted proposal"
            >
              ↓ Current presentations
            </a>
            <a
              class="btn btn-sm btn-outline-secondary"
              href={`/api/v1/events/${encodeURIComponent(slug)}/presentations/archive?versions=all`}
              title="Download every retained presentation version for accepted proposals"
            >
              All versions
            </a>
          </div>
        ) : null
      }
    />
  );
}

/** Admin adapter for the shared event-proposal catalogue. */
export function Proposals({ slug, subTab }: { slug: string; subTab?: string }) {
  const [, navigate] = useHashLocation();
  const tab = subTab === "email" || subTab === "responses" ? subTab : "proposals";

  return (
    <div>
      <Tabs
        items={[
          { key: "proposals", label: "Overview" },
          { key: "responses", label: "Responses" },
          { key: "email", label: "Email" },
        ]}
        active={tab}
        onChange={(key) => navigate(`/events/${slug}/proposals/${key === "proposals" ? "" : key}`)}
      />
      {tab === "proposals" && <ProposalsList slug={slug} />}
      {tab === "responses" && <EventFormResponses slug={slug} purpose="proposal_submission" />}
      {tab === "email" && <EventEmail slug={slug} audience="speakers" />}
    </div>
  );
}
