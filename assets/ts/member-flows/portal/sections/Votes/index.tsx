/**
 * Votes — ballot casting, results viewing, proposal submission/endorsement.
 * Two tabs: "Votes" (every vote visible to the
 * caller, per `listVisibleVotesForMember` — public + group-owned/shared votes +
 * every WG vote for a WG the member belongs to) and "Proposals" (the
 * CA/Browser-Forum-style endorsement path). No shell or
 * backend changes needed — both endpoint groups were already fully live
 * and tested, this is a pure frontend build.
 *
 * H-category members can see everything here but the backend rejects
 * every ballot/proposal/endorsement path for them with no exceptions,
 * this component mirrors that client-side only to avoid a
 * pointless round trip, never as the actual gate.
 *
 * Split into feature components (PR #1 review, Phase 8) — see VotesList,
 * ProposalsList, and their card/form sub-components in this directory.
 * This file is just the top-level tab switcher.
 */
import { useState } from "preact/hooks";
import { VotesList } from "./VotesList";
import { ProposalsList } from "./ProposalsList";

export function Votes() {
  const [tab, setTab] = useState<"votes" | "proposals">("votes");

  return (
    <div>
      <ul class="nav nav-tabs mb-3">
        <li class="nav-item">
          <button type="button" class={`nav-link${tab === "votes" ? " active" : ""}`} onClick={() => setTab("votes")}>
            Votes
          </button>
        </li>
        <li class="nav-item">
          <button
            type="button"
            class={`nav-link${tab === "proposals" ? " active" : ""}`}
            onClick={() => setTab("proposals")}
          >
            Proposals
          </button>
        </li>
      </ul>
      {tab === "votes" ? <VotesList /> : <ProposalsList />}
    </div>
  );
}
