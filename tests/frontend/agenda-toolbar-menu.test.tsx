import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { mountAgendaToolbarMenu } from "../../assets/ts/site/agenda-toolbar-menu";

it("lists an on/off agenda setting under one name, checked while it is on", async () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<div data-agenda-secondary-menu></div><button data-agenda-compact aria-pressed="true" title="Show session descriptions">Abstracts</button>';
  document.body.append(root);
  let dispose = () => {};
  await act(async () => {
    dispose = mountAgendaToolbarMenu(root);
  });
  const canonical = root.querySelector<HTMLButtonElement>("[data-agenda-compact]")!;
  canonical.addEventListener("click", () => {
    canonical.setAttribute("aria-pressed", "false");
  });
  try {
    await act(async () => root.querySelector<HTMLButtonElement>('[aria-label="Agenda filters and actions"]')!.click());
    const first = document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!;
    expect(first.textContent).toContain("Show session descriptions");
    expect(first.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      first.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => root.querySelector<HTMLButtonElement>('[aria-label="Agenda filters and actions"]')!.click());
    const next = document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!;
    expect(next.textContent).toContain("Show session descriptions");
    expect(next.getAttribute("aria-checked")).toBe("false");
  } finally {
    await act(async () => dispose());
    root.remove();
  }
});
