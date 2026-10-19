// @vitest-environment jsdom
import { render } from "preact";
import { render as markup } from "preact-render-to-string";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { AgendaSpeaker } from "../../assets/ts/site/AgendaSpeaker";
import { initializeAgendaSpeakers } from "../../assets/ts/site/agenda-speakers";
import { PublicPersonCard } from "../../assets/ts/site/PublicPersonCard";

const hosts: HTMLElement[] = [];
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const stop of cleanups.splice(0)) stop();
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});
function host() {
  const root = document.body.appendChild(document.createElement("div"));
  hosts.push(root);
  return root;
}

it("gives static agenda speaker controls the canonical focus card and retains their full profile action", async () => {
  const root = host();
  root.innerHTML = markup(
    <AgendaSpeaker
      speaker={{
        name: "Synthetic Speaker",
        affiliations: [{ title: "Architect", organization: { name: "Example Org" } }],
      }}
      profileId="synthetic-profile"
    />,
  );
  const profile = root.querySelector<HTMLDialogElement>("dialog")!;
  profile.showModal = vi.fn(() => profile.setAttribute("open", ""));
  await act(async () => {
    cleanups.push(initializeAgendaSpeakers(root));
  });
  const trigger = root.querySelector<HTMLButtonElement>("[data-agenda-open-speaker]")!;
  await act(async () => trigger.focus());
  const card = root.querySelector('[role="dialog"].pk-live-person-card')!;
  expect(card?.textContent).toContain("Synthetic Speaker");
  expect(card?.textContent).toContain("Architect");
  expect(card?.textContent).toContain("Example Org");
  expect(root.querySelector("[data-agenda-speaker-preview]")).toBeNull();
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(root.querySelector(".pk-live-person-card")).toBeNull();
  trigger.click();
  expect(profile.showModal).toHaveBeenCalledOnce();
  expect(trigger.getAttribute("aria-controls")).toBe("synthetic-profile");
});

it("uses the same keyboard/tap card on public and delegated member cards while retaining tenure and profile links", async () => {
  const root = host();
  await act(async () =>
    render(
      <PublicPersonCard
        person={{
          name: "Synthetic Chair",
          jobTitle: "Engineer",
          organizationName: "Example Org",
          organizationWebsite: null,
          organizationLogoUrl: null,
          photoUrl: null,
          featuredLink: null,
        }}
        role="Chair"
        from="2025-01-01"
      />,
      root,
    ),
  );
  const trigger = root.querySelector<HTMLButtonElement>("button.person-card-name")!;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("click", { detail: 0, bubbles: true }));
  });
  expect(root.querySelector(".pk-live-person-card")?.textContent).toContain("Engineer");
  expect(root.querySelector(".pk-live-person-card")?.textContent).toContain("Chair");
  expect(root.querySelector(".person-card-footer")?.textContent).toContain("2025");
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(root.querySelector(".pk-live-person-card")).toBeNull();
});

it("activates the canonical card on published public markup without hydrating or replacing the profile", async () => {
  const root = host();
  root.innerHTML = markup(
    <PublicPersonCard
      person={{
        name: "Published Chair",
        jobTitle: "Architect",
        organizationName: "Example Org",
        organizationWebsite: null,
        organizationLogoUrl: null,
        photoUrl: null,
        featuredLink: null,
      }}
      role="Chair"
      from="2024-01-01"
    />,
  );
  const original = root.querySelector(".person-card-footer");
  await act(async () => {
    await import("../../assets/ts/member-flows/public-person-previews");
  });
  const trigger = root.querySelector<HTMLButtonElement>("button.person-card-name")!;
  await act(async () => trigger.focus());
  expect(root.querySelector(".pk-live-person-card")?.textContent).toContain("Published Chair");
  expect(root.querySelector(".person-card-footer")).toBe(original);
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(root.querySelector(".pk-live-person-card")).toBeNull();
});
