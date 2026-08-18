/**
 * Admin → Votes. Two tabs: direct vote creation +
 * management (visibility, ballot audit), and member-proposal moderation
 * (approve bypasses the endorsement count, reject requires a reason and
 * emails the proposer). Mirrors OrganizationContentReviews.tsx's
 * list+detail moderation layout for the Proposals tab.
 *
 * Split into feature components (PR #1 review, Phase 8) — see VotesTab,
 * ProposalsTab, and their detail/create sub-components in this directory.
 * This file is just the top-level tab switcher.
 */
import { useState } from "preact/hooks";
import { TOP_TABS, type TopTab } from "./shared";
import { VotesTab } from "./VotesTab";
import { ProposalsTab } from "./ProposalsTab";

export function Votes() {
  const [tab, setTab] = useState<TopTab>("votes");

  return (
    <div>
      <ul class="nav nav-pills mb-3">
        {TOP_TABS.map((t) => (
          <li class="nav-item" key={t}>
            <button
              type="button"
              class={`nav-link text-capitalize${tab === t ? " active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          </li>
        ))}
      </ul>
      {tab === "votes" ? <VotesTab /> : <ProposalsTab />}
    </div>
  );
}
