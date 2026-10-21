// @vitest-environment jsdom
/**
 * The page that edits one identity's profile from the person's record: it
 * reads and writes the identity's own resource, then returns to the record.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { identityRecordSchema } from "../../assets/shared/schemas/identity-public-profile";
import {
  identityProfileUpdateSchema,
  ownIdentityProfileSchema,
} from "../../assets/shared/schemas/own-identity-profile";
import { Users } from "../../assets/ts/member-flows/portal/sections/system-users/Users";
import { identityProfileEditPath } from "../../assets/ts/member-flows/portal/sections/system-users/IdentityProfilePage";
import { press, settle } from "./helpers/affiliation-fixtures";
import { typeInto } from "./helpers/labeled-control";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/users/person", navigate] }));

const userId = "00000000-0000-4000-8000-000000000071";
const identityId = "00000000-0000-4000-8000-000000000072";
const permissions = {
  canRead: true,
  canWrite: false,
  canGrantAccess: false,
  canManageMembership: true,
} as unknown as Parameters<typeof Users>[0]["permissions"];

let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  render(null, container);
  vi.unstubAllGlobals();
  navigate.mockReset();
  document.body.innerHTML = "";
});

function serve(record: unknown, paths: string[], bodies: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      paths.push(new URL(String(input), location.origin).pathname);
      if (init?.method === "PATCH") bodies.push(identityProfileUpdateSchema.parse(JSON.parse(String(init.body))));
      return Response.json(record);
    }),
  );
}

it("builds the path under the record", () => {
  expect(identityProfileEditPath("current", identityId)).toBe(`/users/current/affiliations/${identityId}/profile`);
});

it("lets staff edit an identity's profile through its resource and returns to the record", async () => {
  const record = identityRecordSchema.parse({
    identityId,
    userId,
    personName: "Profile person",
    organizationName: "Example Trust",
    endedAt: null,
    hiddenFromPublicProfile: false,
    organizationId: "00000000-0000-4000-8000-000000000073",
    jobTitle: "Standards lead",
    biography: "Before.",
    links: ["https://github.com/example", "https://orcid.org/0000"],
  });
  const paths: string[] = [];
  const bodies: unknown[] = [];
  serve(record, paths, bodies);
  await act(async () => {
    render(
      <Users userId={userId} section="affiliations" segment={identityId} view="profile" permissions={permissions} />,
      container,
    );
  });
  await settle();

  expect(container.textContent).toContain("Edit profile: Example Trust");
  expect(paths[0]).toBe(`/api/v1/identities/${identityId}`);
  expect(container.querySelectorAll('[aria-label="Added profile links"] .pk-chip')).toHaveLength(2);
  await typeInto(container.querySelector<HTMLInputElement>('input[type="url"]')!, "https://example.org/profile");
  await press(container, "Save changes");
  expect(paths).toContain(`/api/v1/identities/${identityId}`);
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toEqual(
    expect.objectContaining({
      links: ["https://github.com/example", "https://orcid.org/0000", "https://example.org/profile"],
    }),
  );
  expect(navigate).toHaveBeenCalledWith(`/users/${userId}`);
});

it("lets the person edit through their own resource on the current record", async () => {
  const record = ownIdentityProfileSchema.parse({
    identityId,
    organizationId: null,
    organizationName: null,
    jobTitle: null,
    biography: "Before.",
    links: [],
  });
  const paths: string[] = [];
  serve(record, paths, []);
  await act(async () => {
    render(
      <Users
        userId="current"
        section="affiliations"
        segment={identityId}
        view="profile"
        permissions={{ ...permissions, canManageMembership: false }}
      />,
      container,
    );
  });
  await settle();
  expect(paths[0]).toBe(`/api/v1/users/current/identities/${identityId}/profile`);
  expect(container.textContent).toContain("Edit profile: About you");
});
