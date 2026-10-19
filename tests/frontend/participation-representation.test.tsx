// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParticipationRepresentation } from "../../assets/ts/components/ParticipationRepresentation";
import { ORGANIZATION_JOB_TITLE_COPY } from "../../assets/shared/email-first-copy";
import { JOB_TITLE_REQUIRED } from "../../assets/shared/schemas/api-common";
import { controlFor } from "./helpers/labeled-control";

let host: HTMLDivElement | undefined;
const person = {
  email: "ada@official.example",
  firstName: "Ada",
  lastName: "Lovelace",
  organizationName: "Official Organization",
  jobTitle: null,
  bio: null,
  links: [],
};

afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = undefined;
});

async function mount(save: (role: { jobTitle: string }) => Promise<void>) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<ParticipationRepresentation person={person} save={save} requireJobTitle />, host!));
}

async function click(label: string) {
  await act(async () => {
    [...host!.querySelectorAll("button")].find((button) => button.textContent === label)!.click();
  });
}

describe("representation on behalf of an organization", () => {
  it("opens for a missing job title, refuses a blank one on the field, and saves a given one", async () => {
    const save = vi.fn(async () => {});
    await mount(save);
    const jobTitle = controlFor(host!, ORGANIZATION_JOB_TITLE_COPY.label);
    expect(jobTitle.required).toBe(true);
    expect(host!.textContent).toContain("This representation has no job title yet.");

    await click("Save representation");
    expect(save).not.toHaveBeenCalled();
    expect(jobTitle.getAttribute("aria-invalid")).toBe("true");
    expect(host!.textContent).toContain(JOB_TITLE_REQUIRED);

    await act(() => {
      jobTitle.value = "Security Architect";
      jobTitle.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Save representation");
    expect(save).toHaveBeenCalledWith({ jobTitle: "Security Architect" });
  });
});
