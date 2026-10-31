// @vitest-environment jsdom
/**
 * The portal's document structure (WCAG 1.3.1, 2.4.6): one top-level `main`,
 * and on every screen one `h1` — the screen's own title — with sections
 * stepping down from it without skipping a level.
 *
 * Each screen renders the way the published page does: the site document's
 * `main`, the portal shell inside it, and the screen inside the shell.
 */
import { render, type ComponentChildren, type JSX } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupEvent } from "../../assets/shared/schemas/group-events";
import { ParticipantEvent } from "../../assets/ts/member-flows/portal/sections/events/ParticipantEvent";
import { GroupEventWorkspace } from "../../assets/ts/member-flows/portal/sections/management/GroupEventWorkspace";
import { ApplicationHoldSettings } from "../../assets/ts/member-flows/portal/sections/membership-settings/ApplicationHoldSettings";
import { Users } from "../../assets/ts/member-flows/portal/sections/system-users/Users";
import { PortalNavigationShell } from "../../assets/ts/member-flows/portal/shell/PortalNavigationShell";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { Dialog } from "../../assets/ts/ui/Dialog";
import { Panel, PanelHeader } from "../../assets/ts/ui/Panel";
import { SiteMain } from "../../assets/ts/ui/SiteChrome";
import { participantEventFixture } from "../helpers/participant-event";
import { portalSessionFixture } from "../helpers/portal-session";
import { axeViolations } from "./helpers/axe";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: JSX.HTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={`#${href}`} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/home", vi.fn()] }));

const STRUCTURE_RULES = [
  "landmark-one-main",
  "landmark-no-duplicate-main",
  "landmark-main-is-top-level",
  "landmark-complementary-is-top-level",
  "landmark-unique",
  "page-has-heading-one",
  "heading-order",
  "empty-heading",
];

const groupEvent: GroupEvent = {
  id: "architecture-workshop",
  ownerGroupId: "10000000-0000-4000-8000-000000000001",
  seriesId: null,
  slug: "architecture-workshop",
  basePath: "/events/2026/architecture-workshop/",
  name: "Architecture workshop",
  timezone: "Europe/Amsterdam",
  startsAt: "2026-09-01T15:00:00.000Z",
  endsAt: "2026-09-01T16:00:00.000Z",
  profileKey: "workshop",
  sourceMode: "portal",
  registrationPolicy: "optional",
  visibility: "group_members",
  inviteLimitAttendee: 5,
  city: null,
  country: null,
  meetingLocation: null,
  links: [],
  nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  proposalAccess: null,
  capabilities: ["view", "manage_attendance", "manage"],
};

let host: HTMLDivElement;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  portalSession.value = portalSessionFixture({ member: true, staff: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), location.origin);
      if (url.pathname === "/api/v1/users")
        return json({ users: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
      if (url.pathname === "/api/v1/membership/settings")
        return json({
          onHoldResponseDeadlineDays: 7,
          consultationEmailRecipients: "consultation@example.test",
          ecEmailRecipients: "ec@example.test",
          ccApplicantEmails: "members@example.test",
          autoReminderOnHolds: true,
          revision: 3,
          updatedAt: "2026-08-01T00:00:00.000Z",
        });
      // The structure under test does not depend on secondary data.
      return json({ error: "Not available in this test" }, 404);
    }),
  );
});

afterEach(() => {
  render(null, host);
  host.remove();
  portalSession.value = null;
  vi.unstubAllGlobals();
});

async function renderPortalScreen(screen: ComponentChildren): Promise<void> {
  await act(() =>
    render(
      <SiteMain privatePage>
        <PortalNavigationShell session={portalSession.value} displayName="Femke" headshotUrl={null}>
          {screen}
        </PortalNavigationShell>
      </SiteMain>,
      host,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The page's heading levels in document order; a dialog is its own outline. */
function pageHeadingLevels(): number[] {
  return [...host.querySelectorAll("h1, h2, h3, h4, h5, h6")]
    .filter((heading) => !heading.closest("dialog, [role=dialog], [role=alertdialog]"))
    .map((heading) => Number(heading.tagName.slice(1)));
}

function skippedLevels(levels: readonly number[]): string[] {
  return levels.flatMap((level, index) =>
    index > 0 && level > levels[index - 1]! + 1 ? [`h${String(levels[index - 1])} → h${String(level)}`] : [],
  );
}

async function expectPortalStructure(title: string): Promise<void> {
  const mains = document.querySelectorAll("main, [role=main]");
  expect(mains).toHaveLength(1);
  expect(mains[0]!.parentElement?.closest("main, [role=main], header, footer, nav, aside, section")).toBeNull();

  const headingOnes = [...host.querySelectorAll("h1")];
  expect(headingOnes.map((heading) => heading.textContent?.trim())).toEqual([title]);
  const levels = pageHeadingLevels();
  expect(levels[0]).toBe(1);
  expect(skippedLevels(levels)).toEqual([]);

  const violations = await axeViolations(document, STRUCTURE_RULES);
  expect(violations, violations.join("\n")).toEqual([]);
}

describe("portal landmarks and headings", () => {
  it("event app home: the event hero is the page's h1", async () => {
    await renderPortalScreen(<ParticipantEvent event={participantEventFixture()} />);
    await expectPortalStructure("Summit");
  });

  it("group event workspace overview: the event is the page's h1 and its panels step down", async () => {
    await renderPortalScreen(<GroupEventWorkspace event={groupEvent} groupId={groupEvent.ownerGroupId} />);
    await vi.waitFor(() => expect(pageHeadingLevels().slice(1).length).toBeGreaterThan(0));
    await expectPortalStructure("Architecture workshop");
  });

  it("a PageHeader list page: the page title is the page's h1", async () => {
    await renderPortalScreen(
      <Users
        permissions={{
          canRead: true,
          canWrite: true,
          canGrantAccess: false,
          canAnonymize: false,
          canManageMembership: false,
          canActivateIdentity: false,
        }}
      />,
    );
    await expectPortalStructure("Users");
  });

  it("applicant reminders: the settings' groups sit below the panel that holds them", async () => {
    await renderPortalScreen(<ApplicationHoldSettings canWrite={false} />);
    await expectPortalStructure("Applicant reminders");
    const groups = [...host.querySelectorAll("h1, h2, h3")].map((heading) => [heading.tagName, heading.textContent]);
    expect(groups).toEqual([
      ["H1", "Applicant reminders"],
      ["H2", "On-hold reminders"],
      ["H3", "Review deadlines"],
      ["H3", "Notifications"],
    ]);
  });

  it("a dialog keeps its h2 title and its sections sit below it", async () => {
    await renderPortalScreen(
      <Dialog open title="Remove member" confirmLabel="Remove" onConfirm={() => {}} onCancel={() => {}}>
        <Panel>
          <PanelHeader title="What changes" />
        </Panel>
      </Dialog>,
    );
    const dialog = host.querySelector("dialog")!;
    expect([...dialog.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((heading) => heading.tagName)).toEqual([
      "H2",
      "H3",
    ]);
  });
});
