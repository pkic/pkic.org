// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { ParticipationQualifier } from "../../assets/ts/site/ParticipationQualifier";

const host = document.createElement("div");
afterEach(() => {
  render(null, host);
  host.remove();
});

it("requires an explicit answer and retains the authorized-representative guidance without membership choices", async () => {
  document.body.append(host);
  const changed = vi.fn();
  await act(() =>
    render(
      <form>
        <ParticipationQualifier name="participationKind" onChange={changed} />
      </form>,
      host,
    ),
  );
  const form = host.querySelector("form")!;
  expect(form.checkValidity()).toBe(false);
  expect(host.querySelector("legend")?.textContent).toBe("Are you employed by, or do you own, an organization?");
  expect(host.textContent).toContain("separately authorized you to act on its behalf, choose Yes");
  const organization = host.querySelector<HTMLInputElement>('input[value="organization"]')!;
  expect(organization.checked).toBe(false);
  await act(() => {
    organization.click();
  });
  expect(form.checkValidity()).toBe(true);
  expect(new FormData(form).get("participationKind")).toBe("organization");
  expect(changed).toHaveBeenCalledOnce();
  expect(host.querySelectorAll("input")).toHaveLength(2);
});
