import { Route } from "wouter";
import { LazyEventWorkspace } from "./LazyEventWorkspace";

/** Reserved collection subpages that must precede participant-id routes. */
export function portalEventResponseRoutes() {
  return [
    <Route path="/events/:slug/registrations/responses">
      {(params: { slug: string }) => (
        <LazyEventWorkspace view="detail" slug={params.slug} tab="registrations" subTab="responses" />
      )}
    </Route>,
    <Route path="/events/:slug/proposals/responses">
      {(params: { slug: string }) => (
        <LazyEventWorkspace view="detail" slug={params.slug} tab="proposals" subTab="responses" />
      )}
    </Route>,
  ];
}
