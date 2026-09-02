// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WgChairsWidget } from "../../assets/ts/member-flows/wg-chairs-widget";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const PARENT_GROUP_ID = "10000000-0000-4000-8000-000000000002";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function directory(leadership: unknown[]) {
  return {
    group: {
      id: GROUP_ID,
      slug: "pqc-task-force",
      name: "PQC Task Force",
      type: {
        key: "task_force",
        singularLabel: "Task Force",
        pluralLabel: "Task Forces",
        description: null,
        defaultGovernanceInheritanceMode: "inherited",
        defaultEligibilityMode: "managed",
        defaultAutomaticEnrollmentMode: "none",
        defaultAllowAutomaticOptOut: false,
        defaultVisibility: "public",
        active: true,
        sortOrder: 1,
      },
      parentGroup: null,
      description: "Coordinates post-quantum cryptography work.",
      links: [],
      visibility: "public",
      governanceInheritanceMode: "inherited",
      eligibilityMode: "managed",
      automaticEnrollmentMode: "none",
      allowAutomaticOptOut: false,
      publicLeadership: true,
      minEndorsersForBallot: 0,
      active: true,
      revision: 1,
      membershipCapacityCount: 2,
      participantCount: 2,
      childCount: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    mailingListEmail: null,
    leadership,
    pastLeadership: [],
    roster: null,
  };
}

function assignment(roleId: "role-group_lead" | "role-group_deputy_lead", name: string, inherited: boolean) {
  return {
    roleId,
    title: roleId === "role-group_lead" ? "Chair" : "Vice Chair",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: null,
    person: {
      name,
      jobTitle: "Principal Cryptographer",
      organizationName: "Example Consortium",
      organizationLogoUrl: null,
      organizationWebsite: "https://example.test",
      photoUrl: null,
      linkedin: `https://www.linkedin.com/in/${name.toLowerCase().replaceAll(" ", "-")}`,
    },
    sourceGroup: {
      id: inherited ? PARENT_GROUP_ID : GROUP_ID,
      slug: inherited ? "parent-consortium" : "pqc-task-force",
      name: inherited ? "Parent Consortium" : "PQC Task Force",
      type: { key: "task_force", singularLabel: "Task Force", pluralLabel: "Task Forces" },
    },
    inherited,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

let container: HTMLDivElement;

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  vi.unstubAllGlobals();
});

describe("WgChairsWidget", () => {
  it("loads the generic group directory and renders local and inherited assignments under their own titles", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      return json(
        directory([
          assignment("role-group_lead", "Ada Lovelace", false),
          assignment("role-group_lead", "Grace Hopper", true),
          assignment("role-group_deputy_lead", "Katherine Johnson", false),
        ]),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);

    await act(async () => {
      render(
        <WgChairsWidget apiBase="/api/v1" slug="pqc-task-force" wgLabel="Task Force" color="green" mode="compact" />,
        container,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/groups/pqc-task-force/directory");
    expect(container.querySelectorAll(".person-card")).toHaveLength(3);
    expect(container.textContent).toContain("Task Force Chair");
    expect(container.textContent).toContain("Task Force Vice Chair");
    expect(container.textContent).toContain("Ada Lovelace");
    expect(container.textContent).toContain("Grace Hopper");
    expect(container.textContent).toContain("Katherine Johnson");
    expect(container.textContent).toContain("Principal Cryptographer at Example Consortium");
    expect(container.querySelectorAll('a[aria-label="LinkedIn"]')).toHaveLength(3);
  });

  it("keeps the mount hidden when the directory has no public leadership", async () => {
    const onReveal = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(directory([]))),
    );
    container = document.createElement("div");
    document.body.append(container);

    await act(async () => {
      render(
        <WgChairsWidget
          apiBase="/api/v1"
          slug="pqc-task-force"
          wgLabel="Task Force"
          color="green"
          mode="card"
          onReveal={onReveal}
        />,
        container,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(container.textContent).toBe("");
    expect(onReveal).not.toHaveBeenCalled();
  });

  it("fails closed without revealing the mount when the directory request fails", async () => {
    const onReveal = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("directory unavailable"))),
    );
    container = document.createElement("div");
    document.body.append(container);

    await act(async () => {
      render(
        <WgChairsWidget
          apiBase="/api/v1"
          slug="pqc-task-force"
          wgLabel="Task Force"
          color="green"
          mode="compact"
          onReveal={onReveal}
        />,
        container,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(container.textContent).toBe("");
    expect(onReveal).not.toHaveBeenCalled();
  });
});
