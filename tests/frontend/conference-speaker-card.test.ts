import { afterEach, expect, it, vi } from "vitest";

const speakers = [
  { name: "Synthetic <img src=x onerror=alert(1)>", title: "Researcher", headshot: { x250: "/headshot.webp" } },
  { name: "Second speaker", title: "Engineer" },
];
vi.mock("../../assets/js/event-common.js", () => ({
  loadEventData: vi.fn(async () => undefined),
  getHashParams: () => Object.fromEntries(new URLSearchParams(window.location.hash.slice(1))),
  getSpeakersData: () => speakers,
  findSpeakerByFlexibleName: (name: string) => speakers.find((speaker) => speaker.name === name),
}));

afterEach(() => {
  document.body.replaceChildren();
  window.location.hash = "";
});

it("renders source metadata and speaker content safely while preserving hash and keyboard selection", async () => {
  document.body.dataset.conferenceTitle = "Synthetic Conference 2027";
  document.body.dataset.conferenceData = "/events/synthetic/event-data.json";
  document.body.innerHTML = '<div id="speaker-name"></div><div id="speaker-title"></div><div id="speaker-photo"></div>';
  await import("../../assets/js/event-speaker-card.js");
  await vi.waitFor(() => expect(document.getElementById("speaker-name")!.textContent).toBe(speakers[0]!.name));
  expect(document.title).toContain("Synthetic Conference 2027");
  expect(document.querySelector("#speaker-name img")).toBeNull();
  expect(document.querySelector("#speaker-photo img")!.getAttribute("style")).toBeNull();
  expect(document.querySelector("#speaker-photo img")!.getAttribute("src")).toBe("/headshot.webp");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  await vi.waitFor(() => expect(document.getElementById("speaker-name")!.textContent).toBe("Second speaker"));
  expect(document.querySelector("#speaker-photo .speaker-photo-placeholder")!.textContent).toBe("SS");
  expect(document.querySelector("#speaker-photo img")).toBeNull();
});
