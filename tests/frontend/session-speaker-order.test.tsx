import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { SessionSpeakerFields } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SessionSpeakerFields";
import { runRowAction } from "./helpers/row-actions";

const host = document.createElement("div");
document.body.append(host);
afterEach(() => render(null, host));

it("reorders speaker references without changing their identity or role", async () => {
  const speakers = [
    {
      userId: "first",
      displayName: "First speaker",
      role: "moderator" as const,
      profileCandidate: {
        identityId: null,
        organizationName: "Example",
        jobTitle: "Chair",
        biography: "",
        links: [],
        photoUrl: null,
      },
    },
    { userId: "second", displayName: "Second speaker", role: "speaker" as const },
  ];
  const changed = vi.fn();
  await act(() => render(<SessionSpeakerFields speakers={speakers} setSpeakers={changed} />, host));
  await runRowAction(host, "Second speaker", "Move up");
  expect(changed).toHaveBeenLastCalledWith([speakers[1], speakers[0]]);
  expect(changed.mock.calls[0][0][1]).toBe(speakers[0]);
});
