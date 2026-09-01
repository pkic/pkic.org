/**
 * The event's proposal catalogue, its form responses, and its speaker mail.
 *
 * The two archive links stay anchors — downloading an archive is a
 * navigation, not a page action — and borrow the button's appearance rather
 * than its element. The arrow beside the first is decoration, so it is hidden
 * from assistive technology instead of being read out as "down arrow".
 */
import { usePortalHashLocation } from "../../../hash-location";
import { Tabs } from "../../../../../components/Tabs";
import { EventProposalsTable } from "../../../../../components/proposals/EventProposalsTable";
import { EventEmailCampaign } from "../../../../../components/events/EventEmailCampaign";
import { EventFormResponses } from "./Forms";
import { toast } from "../../../ui";
import { eventProposalDetailViewPath } from "./proposal-paths";
// The archive links are written as class names rather than rendered through
// `Button`, because they are anchors. Button.css also ships with the entry
// stylesheet, but the module that writes the class names asks for them.
import "../../../../../ui/Button.css";

function ProposalsList({ slug }: { slug: string }) {
  const [, navigate] = usePortalHashLocation();

  return (
    <EventProposalsTable
      endpoint={`/api/v1/events/${encodeURIComponent(slug)}/proposals`}
      storageKey={`adm_proposal_filters_${slug}`}
      onSelect={(proposal) => navigate(eventProposalDetailViewPath(slug, proposal.id))}
      toolbarPrefix={(_, access) =>
        access?.canRead ? (
          <div class="pk-cluster" role="group" aria-label="Download event presentations">
            <a
              class="pk-btn pk-btn--secondary pk-btn--sm"
              href={`/api/v1/events/${encodeURIComponent(slug)}/presentations/archive`}
              title="Download the current presentation for every accepted proposal"
            >
              <span aria-hidden="true">↓</span> Current presentations
            </a>
            <a
              class="pk-btn pk-btn--secondary pk-btn--sm"
              href={`/api/v1/events/${encodeURIComponent(slug)}/presentations/archive?versions=all`}
              title="Download every retained presentation version for accepted proposals"
            >
              All presentation versions
            </a>
          </div>
        ) : null
      }
    />
  );
}

/** Portal adapter for the shared event-proposal catalogue. */
export function Proposals({ slug, subTab, canWrite }: { slug: string; subTab?: string; canWrite: boolean }) {
  const [, navigate] = usePortalHashLocation();
  const tab = subTab === "responses" || (canWrite && subTab === "email") ? subTab : "proposals";

  return (
    <div class="pk-stack">
      <Tabs
        label="Proposal sections"
        items={[
          { key: "proposals", label: "Overview" },
          { key: "responses", label: "Responses" },
          ...(canWrite ? [{ key: "email", label: "Email" }] : []),
        ]}
        active={tab}
        onChange={(key) => navigate(`/events/${slug}/proposals/${key === "proposals" ? "" : key}`)}
        hrefFor={(key) => `/events/${slug}/proposals/${key === "proposals" ? "" : key}`}
      />
      {tab === "proposals" && <ProposalsList slug={slug} />}
      {tab === "responses" && <EventFormResponses slug={slug} purpose="proposal_submission" />}
      {tab === "email" && (
        <EventEmailCampaign
          campaignsPath={`/api/v1/events/${encodeURIComponent(slug)}/email/campaigns`}
          daysPath={`/api/v1/events/${encodeURIComponent(slug)}/days`}
          audience="speakers"
          notify={toast}
        />
      )}
    </div>
  );
}
