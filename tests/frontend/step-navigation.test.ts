// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createUrlDialogState } from "../../assets/ts/ui/url-query";
import { installStepNavigation } from "../../assets/ts/shared/form/step-navigation";

afterEach(() => {
  document.body.innerHTML = "";
  history.replaceState({}, "", "/");
});
it("closes nested identity dialogs in history order and ignores a stale close callback", async () => {
  history.replaceState({}, "", "/portal/#/events/summit?registrationStep=2");
  const representation = createUrlDialogState("representation", "hash", "/events/summit");
  const identity = createUrlDialogState("identity", "hash", "/events/summit");
  representation.show();
  const choice = representation.marker();
  identity.show();
  const addition = identity.marker();
  history.back();
  await vi.waitFor(() => expect(identity.marker()).toBeNull());
  expect(representation.marker()).toBe(choice);
  expect(location.hash).toContain("registrationStep=2");
  history.forward();
  await vi.waitFor(() => expect(identity.marker()).toBe(addition));
  await identity.close(addition);
  await vi.waitFor(() => expect(identity.marker()).toBeNull());
  identity.show();
  const next = identity.marker();
  await identity.close(addition);
  expect(identity.marker()).toBe(next);
  await Promise.all([identity.close(next), identity.close(next)]);
  await vi.waitFor(() => expect(identity.marker()).toBeNull());
  await representation.close(choice);
  await vi.waitFor(() => expect(representation.marker()).toBeNull());
  expect(location.hash).toContain("registrationStep=2");
});
it("activates identity work only after required terms allow the next step", () => {
  document.body.innerHTML =
    '<section><form><div data-step="1"><input type="checkbox" name="consents" required></div><div data-step="2" hidden></div><button data-step-next type="button">Next</button><button data-step-back type="button">Back</button><button type="submit">Submit</button><p role="status"></p></form></section>';
  const root = document.querySelector("section")!;
  root.scrollIntoView = vi.fn();
  const activated = vi.fn();
  installStepNavigation(root, root.querySelector("form")!, root.querySelector("p")!, undefined, activated);
  expect(activated.mock.calls).toEqual([[1]]);
  root.querySelector<HTMLButtonElement>("[data-step-next]")!.click();
  expect(activated.mock.calls).toEqual([[1]]);
  root.querySelector<HTMLInputElement>("input")!.checked = true;
  root.querySelector<HTMLButtonElement>("[data-step-next]")!.click();
  expect(activated.mock.calls).toEqual([[1], [2]]);
  expect(root.querySelector<HTMLElement>('[data-step="2"]')!.hidden).toBe(false);
  root.querySelector<HTMLButtonElement>("[data-step-back]")!.click();
  expect(activated.mock.calls).toEqual([[1], [2], [1]]);
});
it.each(["hash", "search"] as const)(
  "uses browser Back and Forward without discarding registration answers (%s)",
  async (source) => {
    const ownerPath = source === "hash" ? "/events/summit/register/" : "/events/2027/summit/register/";
    history.replaceState(
      {},
      "",
      source === "hash" ? "/portal/#/events/summit/register/" : `${ownerPath}?ref=example&registrationStep=1`,
    );
    document.body.innerHTML =
      '<section><form><div data-step="1"></div><div data-step="2" hidden><input name="answer"></div><div data-step="3" hidden></div><button data-step-next type="button">Next</button><button data-step-back type="button">Back</button><button type="submit">Submit</button><p role="status"></p></form></section>';
    const root = document.querySelector("section")!;
    root.scrollIntoView = vi.fn();
    const navigation = installStepNavigation(
      root,
      root.querySelector("form")!,
      root.querySelector("p")!,
      undefined,
      undefined,
      { source, ownerPath, param: "registrationStep" },
    );
    try {
      root.querySelector<HTMLButtonElement>("[data-step-next]")!.click();
      const answer = root.querySelector<HTMLInputElement>("input")!;
      answer.value = "Keep this answer";
      root.querySelector<HTMLButtonElement>("[data-step-next]")!.click();
      expect(location.href).toContain("registrationStep=3");
      history.back();
      await vi.waitFor(() => expect(root.querySelector<HTMLElement>('[data-step="2"]')!.hidden).toBe(false));
      expect(answer.value).toBe("Keep this answer");
      history.forward();
      await vi.waitFor(() => expect(root.querySelector<HTMLElement>('[data-step="3"]')!.hidden).toBe(false));
      root.querySelector<HTMLButtonElement>("[data-step-back]")!.click();
      await vi.waitFor(() => expect(root.querySelector<HTMLElement>('[data-step="2"]')!.hidden).toBe(false));
      expect(answer.value).toBe("Keep this answer");
      history.back();
      await vi.waitFor(() => expect(root.querySelector<HTMLElement>('[data-step="1"]')!.hidden).toBe(false));
      history.forward();
      await vi.waitFor(() => expect(root.querySelector<HTMLElement>('[data-step="2"]')!.hidden).toBe(false));
      expect(answer.value).toBe("Keep this answer");
    } finally {
      navigation.dispose();
      history.replaceState({}, "", "/");
    }
  },
);
