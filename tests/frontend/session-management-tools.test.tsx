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
import { cleanup, json, mount, settle } from "./helpers/event-management";
import { chooseOption, controlFor, optionValues, submitForm, typeInto } from "./helpers/labelled-control";

const USER_ID = "10000000-0000-4000-8000-000000000002";
const OCCURRENCE_ID = "10000000-0000-4000-8000-000000000003";
const endpoint = `/api/v1/events/workshop/agenda/${OCCURRENCE_ID}`;

afterEach(cleanup);

describe("Delegated session management", () => {
  it("offers registration confirmation without granting organizer delegation or holds", async () => {
    const changed = vi.fn();
    const requests: string[] = [];
    const submitted: unknown[] = [];
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
    const root = mount(<SessionManagementTools slug="workshop" occurrenceId={OCCURRENCE_ID} onChanged={changed} />);
    await settle();
    const action = controlFor<HTMLSelectElement>(root, "Action");
    expect(optionValues(action)).toEqual(sessionInvitationRequestSchema.shape.action.options);
    expect(root.textContent).not.toContain("Speaker delegation");
    expect(root.textContent).not.toContain("Hold a seat");
    expect(root.querySelector('input[type="checkbox"]')).toBeNull();

    await typeInto(controlFor(root, "Attendee"), "attendee");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const attendee = root.querySelector<HTMLButtonElement>('[aria-label="Matching users"] button');
    expect(attendee).not.toBeNull();
    await act(() => attendee!.click());
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
});
