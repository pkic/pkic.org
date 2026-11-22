// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { ParticipationPersonalDetails } from "../../assets/ts/components/ParticipationPersonalDetails";

let host: HTMLDivElement;

afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  history.replaceState({}, "", "/");
});

// A field's message clears as the name is typed; an alert repeating it would stay behind.
it("leaves a refused missing name to its field instead of an alert", async () => {
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <ParticipationPersonalDetails
        person={{ firstName: null, lastName: null }}
        save={async () => {}}
        refusal="Enter your first name."
      />,
      host,
    ),
  );
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  const first = dialog.querySelector<HTMLInputElement>('input[name="firstName"]')!;
  expect(first.getAttribute("aria-invalid")).toBe("true");
  expect(dialog.querySelector(".pk-alert")).toBeNull();
});
