import { Route } from "wouter";
import { LazyEventWorkspace } from "./LazyEventWorkspace";

export function portalEventParticipantRoutes() {
  return [
    <Route path="/events/:slug/proposals/:proposalId/:facet?">
      {(params: { slug: string; proposalId: string; facet?: string }) => (
        <LazyEventWorkspace
          view="participant"
          kind="proposal"
          slug={params.slug}
          resourceId={params.proposalId}
          tab={params.facet}
        />
      )}
    </Route>,
  ];
}
