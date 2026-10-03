import { Route } from "wouter";
import { LazyEventWorkspace } from "./LazyEventWorkspace";
export function portalEventScannerRoutes() {
  return (
    <Route
      path="/events/:slug/sponsors/:sponsorId/scanner"
      component={({ params }: { params: { slug: string; sponsorId: string } }) => (
        <LazyEventWorkspace
          view="detail"
          slug={params.slug}
          tab="sponsors"
          subTab={params.sponsorId}
          detailSegment="scanner"
        />
      )}
    />
  );
}
