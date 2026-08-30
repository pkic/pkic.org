import type { ComponentChildren } from "preact";
import { lazy, Suspense } from "preact/compat";
import { Spinner } from "../../../../components/Spinner";

const EventList = lazy(() => import("./EventList").then((module) => ({ default: module.EventList })));
const ProposalPrograms = lazy(() =>
  import("../management/ProposalPrograms").then((module) => ({ default: module.ProposalPrograms })),
);
const EventDetailView = lazy(() =>
  import("./detail/EventDetail").then((module) => ({ default: module.EventDetailView })),
);
const ProposalDetailPage = lazy(() =>
  import("./detail/ProposalDetailPage").then((module) => ({ default: module.ProposalDetailPage })),
);
const RegistrationDetailPage = lazy(() =>
  import("./detail/RegistrationDetailPage").then((module) => ({ default: module.RegistrationDetailPage })),
);

type EventWorkspaceProps =
  | { view: "list" }
  | { view: "detail"; slug: string; tab?: string; subTab?: string }
  | { view: "proposal"; slug: string; resourceId: string }
  | { view: "registration"; slug: string; resourceId: string };

function WorkspaceSection({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="portal-section">
      <h4 class="portal-section-title">{title}</h4>
      {children}
    </div>
  );
}

export function EventWorkspace(props: EventWorkspaceProps) {
  let content: ComponentChildren;
  let title: string;
  if (props.view === "list") {
    title = "Events";
    content = (
      <div class="d-flex flex-column gap-3">
        <EventList />
        <ProposalPrograms />
      </div>
    );
  } else if (props.view === "proposal") {
    title = "Proposal";
    content = <ProposalDetailPage slug={props.slug} proposalId={props.resourceId} />;
  } else if (props.view === "registration") {
    title = "Registration";
    content = <RegistrationDetailPage slug={props.slug} regId={props.resourceId} />;
  } else {
    title = "Event";
    content = <EventDetailView slug={props.slug} tab={props.tab} subTab={props.subTab} />;
  }
  return (
    <WorkspaceSection title={title}>
      <Suspense fallback={<Spinner />}>{content}</Suspense>
    </WorkspaceSection>
  );
}

export type { EventWorkspaceProps };
