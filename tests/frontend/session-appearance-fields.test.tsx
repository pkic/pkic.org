// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import type { z } from "zod";
import { AppearanceFields } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SessionAppearanceFields";
import { sessionAppearanceSchema, type SessionAppearance } from "../../assets/shared/schemas/event-session-history";
import { buttonNamed, chooseOption, optionValues, typeInto } from "./helpers/labeled-control";

const api = vi.hoisted(() => ({ getJson: vi.fn() }));
vi.mock("../../assets/ts/shared/api-client", () => api);
const host = document.createElement("div");
document.body.append(host);
afterEach(() => {
  render(null, host);
  vi.clearAllMocks();
});

const identity = (id: string, organizationName: string, jobTitle: string) => ({
  id,
  userId: "speaker",
  organizationId: `${id}-organization`,
  organizationName,
  jobTitle,
  biography: `${organizationName} biography`,
});

it("approves several representations in the reviewer's order with an edited title for each", async () => {
  api.getJson.mockImplementation(async (_path: string, schema: z.ZodType) =>
    schema.parse({
      identities: [identity("consortium", "PKI Consortium", "Member"), identity("company", "Digitorus", "CEO")],
      page: { limit: 200, offset: 0, total: 2, hasMore: false },
    }),
  );
  let approved: SessionAppearance[] = [];
  await act(async () =>
    render(
      <AppearanceFields
        slug="event"
        occurrenceId="session"
        appearances={[]}
        speakers={[{ userId: "speaker", displayName: "Example speaker", role: "speaker" }]}
        sourceRepresentations={[]}
        onChange={(value) => (approved = value)}
      />,
      host,
    ),
  );
  const picker = () =>
    [...host.querySelectorAll("select")].find((select) =>
      [...select.options].some((option) => option.value === "__individual"),
    )!;
  await vi.waitFor(() => expect(optionValues(picker())).toContain("company"));
  await chooseOption(picker(), "company");
  await chooseOption(picker(), "consortium");
  // A representation already chosen is not offered twice.
  expect(optionValues(picker())).not.toContain("company");
  await act(() => buttonNamed(host, "Make primary").click());
  const titles = [...host.querySelectorAll("label")]
    .filter((label) => label.textContent?.startsWith("Title at this event"))
    .map((label) => document.getElementById(label.htmlFor) as HTMLInputElement);
  await typeInto(titles[0]!, "Chair");
  await act(() => buttonNamed(host, "Approve representation for Example speaker").click());
  expect(approved).toHaveLength(1);
  const appearance = sessionAppearanceSchema.parse(approved[0]);
  expect(appearance.affiliations).toEqual([
    {
      identityId: "consortium",
      title: "Chair",
      organizationId: "consortium-organization",
      organizationName: "PKI Consortium",
    },
    { identityId: "company", title: "CEO", organizationId: "company-organization", organizationName: "Digitorus" },
  ]);
  // The first representation chosen brought its biography; reordering does not replace it.
  expect(appearance.biography).toBe("Digitorus biography");
});
