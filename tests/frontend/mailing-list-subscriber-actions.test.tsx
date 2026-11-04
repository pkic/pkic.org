// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { mailingListPreferenceMutationSchema } from "../../assets/shared/schemas/mailing-lists";
import { mailingListSubscriberFixture } from "./helpers/mailing-list-fixture";
import { MailingListSubscriberActions } from "../../assets/ts/member-flows/portal/sections/management/MailingListSubscriberActions";
import { putJson } from "../../assets/ts/shared/api-client";

vi.mock("../../assets/ts/shared/api-client", () => ({ putJson: vi.fn(async () => {}) }));
vi.mock("../../assets/ts/components/ConfirmDialog", () => ({ confirmAction: vi.fn(async () => true) }));
let container: HTMLDivElement | undefined;
afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
  vi.clearAllMocks();
});

it.each(["subscribed", "archive_only"] as const)(
  "offers direct rejoin for a suppressed %s preference",
  async (preference) => {
    const label = preference === "subscribed" ? "Subscribe" : "Turn off email delivery";
    const person = mailingListSubscriberFixture({ preference, subscribed: false, suppressed: true });
    const onChanged = vi.fn(async () => {});
    container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <MailingListSubscriberActions groupId="group" listId="list" subscriber={person} onChanged={onChanged} />,
        container!,
      ),
    );
    await act(() =>
      container!.querySelector<HTMLButtonElement>('button[aria-label="Actions for Ada Lovelace"]')!.click(),
    );
    const item = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (node) => node.textContent?.trim() === label,
    )!;
    expect(item.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => item.click());
    expect(putJson).toHaveBeenCalledTimes(1);
    const [endpoint, body] = vi.mocked(putJson).mock.calls[0]!;
    expect(endpoint).toBe(`/api/v1/groups/group/mailing-lists/list/subscribers/${person.user.id}`);
    expect(mailingListPreferenceMutationSchema.parse(body)).toEqual({ preference });
    expect(onChanged).toHaveBeenCalledOnce();
  },
);
