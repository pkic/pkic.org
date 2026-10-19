// @vitest-environment jsdom
/**
 * Staff hiding an identity from its person's public profile: the view loads
 * the identity, sends a body the route's contract accepts to the identity
 * itself, and returns to the person's record.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  identityPublicProfileSchema,
  identityPublicProfileUpdateSchema,
} from "../../assets/shared/schemas/identity-public-profile";
import { IdentityPublicProfileView } from "../../assets/ts/member-flows/portal/sections/system-users/IdentityPublicProfileView";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/users/person", navigate] }));

const userId = "00000000-0000-4000-8000-000000000061";
const identityId = "00000000-0000-4000-8000-000000000062";
const identity = identityPublicProfileSchema.parse({
  identityId,
  userId,
  personName: "Profile person",
  organizationName: "Example Trust",
  endedAt: "2025-01-01T00:00:00.000Z",
  hiddenFromPublicProfile: false,
});

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

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("hides an ended identity through the identity's own contract and returns to the record", async () => {
  const sent: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), location.origin);
      expect(url.pathname).toBe(`/api/v1/identities/${identityId}`);
      if (init?.method === "PATCH") {
        const body = identityPublicProfileUpdateSchema.parse(JSON.parse(String(init.body)));
        sent.push(body);
        return Response.json({ ...identity, ...body });
      }
      return Response.json(identity);
    }),
  );
  await act(async () => {
    render(<IdentityPublicProfileView userId={userId} identityId={identityId} />, container);
  });
  await settle();

  const hide = container.querySelector<HTMLInputElement>('input[name="hiddenFromPublicProfile"]')!;
  expect(hide.checked).toBe(false);
  hide.checked = true;
  await act(async () => {
    hide.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    hide.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();

  expect(sent).toEqual([{ hiddenFromPublicProfile: true }]);
  expect(navigate).toHaveBeenCalledWith(`/users/${userId}`);
});
