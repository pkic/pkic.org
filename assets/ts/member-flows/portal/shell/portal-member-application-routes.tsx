import { Route } from "wouter";
import { MyApplications } from "./portal-sections";
import { SectionWrapper } from "./PortalRouteChrome";

/** The member's application list and its addressable detail views. */
export function portalMemberApplicationRoutes() {
  return [
    <Route
      path="/application/:applicationId"
      component={({ params }: { params: { applicationId: string } }) => (
        <SectionWrapper>
          <MyApplications applicationId={params.applicationId} />
        </SectionWrapper>
      )}
    />,
    <Route
      path="/application"
      component={() => (
        <SectionWrapper>
          <MyApplications />
        </SectionWrapper>
      )}
    />,
  ];
}
