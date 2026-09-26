import { Route } from "wouter";
import { LazyEventWorkspace } from "./LazyEventWorkspace";

export function portalEventParticipantRoutes() {
  return [
    <Route
      path="/events/:slug/registrations/:registrationId"
      component={({ params }: { params: { slug: string; registrationId: string } }) => (
        <LazyEventWorkspace
          view="participant"
          kind="registration"
          slug={params.slug}
          resourceId={params.registrationId}
        />
      )}
    />,
    <Route
      path="/events/:slug/proposals/:proposalId/:facet?"
      component={({ params }: { params: { slug: string; proposalId: string; facet?: string } }) => (
        <LazyEventWorkspace
          view="participant"
          kind="proposal"
          slug={params.slug}
          resourceId={params.proposalId}
          tab={params.facet}
        />
      )}
    />,
  ];
}
