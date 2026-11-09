// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ParticipantEvent } from "../../assets/ts/member-flows/portal/sections/events/ParticipantEvent";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { participantEventFixture } from "../helpers/participant-event";
import { participantSpeakerFixture } from "./helpers/participant-speaker-fixture";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
vi.mock("../../assets/ts/components/markdown-editor/MarkdownInput", () => ({ MarkdownEditor: () => null }));
const event = participantEventFixture();
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  portalSession.value = null;
  history.replaceState(null, "", "/");
});

it("names the proposal columns consistently for a speaker", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        proposals: [
          {
            id: event.id,
            event,
            title: "Quantum trust",
            status: "submitted",
            role: "speaker",
            speakerStatus: "confirmed",
            updatedAt: "2026-11-01T00:00:00.000Z",
          },
        ],
        page: { limit: 25, offset: 0, total: 1, hasMore: false },
      }),
    ),
  );
  await act(() => render(<ParticipantEvent event={event} tab="submissions" />, host));
  await vi.waitFor(() => expect(host.textContent).toContain("Quantum trust"));
  expect([...host.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim())).toEqual([
    "Name",
    "Status",
    "Participation",
    "Role",
  ]);
  expect(host.querySelector(`a[href="#/events/summit/proposals/${event.id}"]`)).not.toBeNull();
});

it.each(["participation", "presentations"])(
  "offers a neighboring presentation tab and opens the %s facet",
  async (facet) => {
    const speaker = participantSpeakerFixture();
    speaker.proposal.status = "accepted";
    speaker.speaker.status = "confirmed";
    speaker.proposal.presentationUploaded = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/submission"))
          return Response.json({ error: { code: "NOT_FOUND", message: "Not the submitter" } }, { status: 404 });
        if (url.endsWith("/participation")) return Response.json(speaker);
        if (url.includes("/terms?")) return Response.json({ event, audience: "speaker", terms: [] });
        return Response.json({
          event,
          registrationPolicy: "public",
          purpose: "proposal_submission",
          form: null,
          requiredTerms: [],
          allowedSessionTypes: ["talk"],
          eventDays: [],
        });
      }),
    );
    await act(() =>
      render(<ParticipantEvent event={event} kind="proposal" resourceId={speaker.proposal.id} tab={facet} />, host),
    );
    await vi.waitFor(() => expect(host.querySelector('nav[aria-label="Proposal"]')).not.toBeNull());
    const links = [...host.querySelectorAll('nav[aria-label="Proposal"] a')];
    expect(links.map((link) => link.textContent)).toEqual(["Speaker profile", "Presentations"]);
    expect(links.find((link) => link.getAttribute("aria-current") === "page")?.textContent).toBe(
      facet === "presentations" ? "Presentations" : "Speaker profile",
    );
    expect(host.querySelector('input[type="file"][accept=".pdf,.ppt,.pptx,.pptm,.odp"]') !== null).toBe(
      facet === "presentations",
    );
    expect(host.querySelector('a[aria-label="Download current presentation"]') !== null).toBe(
      facet === "presentations",
    );
  },
);

it.each(["participation", "presentations"])(
  "refuses an invitation for another account on the %s facet before fetching speaker data",
  async (facet) => {
    const speaker = participantSpeakerFixture();
    portalSession.value = portalSessionFixture({ staff: false });
    history.replaceState(
      null,
      "",
      `/#/events/summit/proposals/${speaker.proposal.id}/${facet}?speaker=${crypto.randomUUID()}`,
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await act(() =>
      render(<ParticipantEvent event={event} kind="proposal" resourceId={speaker.proposal.id} tab={facet} />, host),
    );
    await vi.waitFor(() => expect(host.textContent).toContain("different account"));
    expect(fetch).not.toHaveBeenCalled();
  },
);
