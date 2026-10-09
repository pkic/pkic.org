// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import {
  sessionInvitationRequestSchema,
  sessionInvitationResponseSchema,
  sessionManagementInfoSchema,
} from "../../assets/shared/schemas/event-session-management";
import { badgeAttendeesResponseSchema } from "../../assets/shared/schemas/route-contracts-event-badges";
import { buildPageInfo } from "../../assets/shared/schemas/pagination";
import { SessionManagementTools } from "../../assets/ts/member-flows/portal/sections/events/detail/participation/SessionManagementTools";
import { confirmAction } from "../../assets/ts/components/ConfirmDialog";
import { cleanup, json, mount, settle } from "./helpers/event-management";
import { chooseOption, controlFor, optionValues, submitForm, typeInto } from "./helpers/labelled-control";

const USER_ID = "10000000-0000-4000-8000-000000000002";
const OCCURRENCE_ID = "10000000-0000-4000-8000-000000000003";
const endpoint = `/api/v1/events/workshop/agenda/${OCCURRENCE_ID}`;

vi.mock("../../assets/ts/components/ConfirmDialog", async (original) => ({
  ...(await original<typeof import("../../assets/ts/components/ConfirmDialog")>()),
  confirmAction: vi.fn(async () => true),
}));

afterEach(() => {
  cleanup();
  vi.mocked(confirmAction).mockReset();
  vi.mocked(confirmAction).mockResolvedValue(true);
});

function stubApi(submitted: unknown[], requests: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url === `${endpoint}/management`)
        return json(
          sessionManagementInfoSchema.parse({
            canDelegate: false,
            rooms: [],
            speakers: [{ userId: USER_ID, displayName: "Assigned speaker" }],
          }),
        );
      if (url.startsWith(`${endpoint}/invitees?`))
        return json(
          badgeAttendeesResponseSchema.parse({
            users: [{ id: USER_ID, email: "attendee@example.test", first_name: "Test", last_name: "Attendee" }],
            page: buildPageInfo(8, 0, 1, 1),
          }),
        );
      if (url === `${endpoint}/invitations` && init?.method === "PUT") {
        submitted.push(sessionInvitationRequestSchema.parse(JSON.parse(String(init.body))));
        return json(sessionInvitationResponseSchema.parse({ invited: true }));
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
}

async function pickAttendee(root: HTMLElement) {
  await typeInto(controlFor(root, "Attendee"), "attendee");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  const attendee = root.querySelector<HTMLButtonElement>('[aria-label="Matching users"] button');
  expect(attendee).not.toBeNull();
  await act(() => attendee!.click());
}

function buttonNamed(root: HTMLElement, label: string) {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`missing button: ${label}`);
  return button;
}

describe("Delegated session management", () => {
  it("offers registration confirmation without granting organizer delegation or holds", async () => {
    const changed = vi.fn();
    const requests: string[] = [];
    const submitted: unknown[] = [];
    stubApi(submitted, requests);
    const root = mount(<SessionManagementTools slug="workshop" occurrenceId={OCCURRENCE_ID} onChanged={changed} />);
    await settle();
    const action = controlFor<HTMLSelectElement>(root, "Action");
    // Revoking is never a choice in the select; it is a separate, confirmed action.
    expect(optionValues(action)).toEqual(["invite", "add"]);
    expect(root.textContent).not.toContain("Speaker delegation");
    expect(root.textContent).not.toContain("Hold a seat");
    expect(root.querySelector('input[type="checkbox"]')).toBeNull();

    await pickAttendee(root);
    await chooseOption(action, "add");
    await chooseOption(controlFor(root, "Reason"), "speaker_invitation");
    await submitForm(root);
    await settle();

    expect(submitted).toHaveLength(1);
    const body = sessionInvitationRequestSchema.parse(submitted[0]);
    expect(body.action).toBe("add");
    expect(body.userId).toBe(USER_ID);
    expect(body.reasonCode).toBe("speaker_invitation");
    expect(changed).toHaveBeenCalledOnce();
    expect(root.textContent).toContain("Session registration reviewed");
    expect(root.textContent).not.toContain("Speaker delegation");
    expect(root.textContent).not.toContain("Hold a seat");
    expect(requests.some((url) => url.includes("/holds") || url.includes("/delegation"))).toBe(false);
  });

  it("revokes an invitation only through its own confirmation naming the attendee", async () => {
    const submitted: unknown[] = [];
    stubApi(submitted);
    const root = mount(<SessionManagementTools slug="workshop" occurrenceId={OCCURRENCE_ID} onChanged={vi.fn()} />);
    await settle();
    await pickAttendee(root);
    vi.mocked(confirmAction).mockResolvedValueOnce(false);

    await act(async () => buttonNamed(root, "Revoke invitation…").click());
    await settle();
    expect(confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Revoke Test Attendee's invitation to this session?",
        confirmLabel: "Revoke invitation",
        tone: "danger",
      }),
    );
    expect(submitted).toHaveLength(0);

    await act(async () => buttonNamed(root, "Revoke invitation…").click());
    await settle();
    expect(submitted).toHaveLength(1);
    const body = sessionInvitationRequestSchema.parse(submitted[0]);
    expect(body).toMatchObject({ action: "revoke", userId: USER_ID });
    expect(root.textContent).toContain("Invitation revoked.");
  });
});
