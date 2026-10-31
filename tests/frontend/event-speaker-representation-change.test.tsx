// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import {
  READ,
  TERMS,
  boot,
  installApi,
  json,
  mountShell,
  panel,
  speakerPage,
  speakerTerms,
} from "./helpers/speaker-manage-page-fixture";

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState({}, "", "/events/2026/pqc-2026/speaker/?token=speaker-token-12345678901234567890");
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

describe("speaker representation change", () => {
  it("lets a speaker back out of changing a recorded representation, with the save action hidden until a change", async () => {
    const root = mountShell();
    const data = speakerPage({ status: "confirmed", proposalStatus: "accepted" });
    data.profile = {
      ...(data.profile as Record<string, unknown>),
      actingIdentitySelection: "individual",
      actingIdentitySelectedAt: "2026-01-01T00:00:00.000Z",
    };
    installApi({ [READ]: () => json(data), [TERMS]: () => json(speakerTerms()) });
    await boot();
    const named = (label: string) =>
      [...root.querySelectorAll("button")].find((button) => button.textContent === label);
    expect(panel(root, "data-profile-save").hidden).toBe(true);
    await act(async () => named("Add representation")!.click());
    expect(panel(root, "data-profile-save").hidden).toBe(false);
    await act(async () => named("Cancel")!.click());
    expect(named("Add representation")).toBeDefined();
    expect(panel(root, "data-profile-save").hidden).toBe(true);
  });
});
