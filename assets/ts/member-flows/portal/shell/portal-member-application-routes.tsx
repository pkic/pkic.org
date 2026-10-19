import { Route } from "wouter";
import { MyApplications } from "./portal-sections";
import { SectionWrapper } from "./PortalRouteChrome";

/** The signed-in applicant's application list and its addressable detail views. */
export function portalMemberApplicationRoutes() {
  return [
    <Route path="/application/:applicationId">
      {(params: { applicationId: string }) => (
        <SectionWrapper>
          <MyApplications applicationId={params.applicationId} />
        </SectionWrapper>
      )}
    </Route>,
    <Route path="/application">
      {() => (
        <SectionWrapper>
          <MyApplications />
        </SectionWrapper>
      )}
    </Route>,
  ];
}
