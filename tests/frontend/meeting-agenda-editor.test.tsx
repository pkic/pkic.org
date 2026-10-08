// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MeetingAgendaEditor } from "../../assets/ts/member-flows/portal/sections/management/MeetingAgendaEditor";
import { meetingAgendaSchema, meetingAgendaSaveSchema } from "../../assets/shared/schemas/meeting-agenda";
const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock("../../assets/ts/shared/api-client", () => api);
const host = document.createElement("div");
document.body.append(host);
afterEach(() => {
  render(null, host);
  vi.clearAllMocks();
});
const agenda = meetingAgendaSchema.parse({
  seriesId: crypto.randomUUID(),
  occurrenceId: crypto.randomUUID(),
  revision: 3,
  writeRevision: 7,
  formatVersion: 2,
  name: "Weekly meeting",
  items: [
    { id: crypto.randomUUID(), title: "Opening", description: "", durationMinutes: 10, speakerUserIds: [] },
    { id: crypto.randomUUID(), title: "Discussion", description: "", durationMinutes: 30, speakerUserIds: [] },
  ],
  startsAt: "2099-10-25T00:30:00.000Z",
  endsAt: "2099-10-25T01:30:00.000Z",
  timezone: "Europe/Amsterdam",
  exception: false,
  publishedAt: null,
});
describe("meeting agenda editor", () => {
  it("reorders durable item identities and submits an explicit guarded future operation", async () => {
    api.getJson.mockResolvedValue(agenda);
    api.postJson.mockResolvedValue({ ...agenda, revision: 4, writeRevision: 8 });
    await act(async () =>
      render(
        <MeetingAgendaEditor groupId="group" seriesId={agenda.seriesId} occurrenceId={agenda.occurrenceId!} />,
        host,
      ),
    );
    await vi.waitFor(() => expect(host.textContent).toContain("Total duration: 40"));
    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Move down")!.click();
    });
    const scope = host.querySelector("select")!;
    await act(async () => {
      scope.value = "future";
      scope.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const sent = meetingAgendaSaveSchema.parse(api.postJson.mock.calls[0]![1]);
    expect(sent).toMatchObject({
      expectedRevision: 3,
      expectedWriteRevision: 7,
      expectedFormatVersion: 2,
      scope: "future",
      fromOccurrenceId: agenda.occurrenceId,
    });
    expect(sent.items.map((item) => item.id)).toEqual([agenda.items[1]!.id, agenda.items[0]!.id]);
  });
  it("requires a changed agenda name to be saved before approval", async () => {
    api.getJson.mockResolvedValue(agenda);
    await act(async () =>
      render(
        <MeetingAgendaEditor groupId="group" seriesId={agenda.seriesId} occurrenceId={agenda.occurrenceId!} />,
        host,
      ),
    );
    const approve = () =>
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Approve and freeze this agenda")!;
    await vi.waitFor(() => expect(approve().disabled).toBe(false));
    const input = [...host.querySelectorAll("input")].find((input) => input.value === agenda.name)!;
    await act(async () => {
      input.value = "Changed meeting name";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(approve().disabled).toBe(true);
    approve().click();
    expect(api.postJson).not.toHaveBeenCalled();
    api.postJson.mockResolvedValue({ ...agenda, name: "Changed meeting name", revision: 4, writeRevision: 8 });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(api.postJson.mock.calls[0]![1]).toMatchObject({ name: "Changed meeting name" });
    expect(approve().disabled).toBe(false);
  });
  it("copies a reusable format with fresh item IDs and reviewed speaker assignments", async () => {
    const original = { ...agenda.items[0]!, speakerUserIds: [crypto.randomUUID()] };
    api.getJson.mockImplementation(async (url: string) =>
      url.includes("/meetings/formats?")
        ? {
            formats: [
              {
                seriesId: crypto.randomUUID(),
                version: 8,
                name: "Reusable discussion",
                eventName: "Other accessible meeting",
                items: [original],
                createdAt: "2026-10-03T00:00:00.000Z",
              },
            ],
            page: { limit: 20, offset: 0, total: 1, hasMore: false },
          }
        : agenda,
    );
    api.postJson.mockResolvedValue({ ...agenda, revision: 4, writeRevision: 8 });
    await act(async () => {
      render(
        <MeetingAgendaEditor groupId="group" seriesId={agenda.seriesId} occurrenceId={agenda.occurrenceId!} />,
        host,
      );
    });
    await vi.waitFor(() => expect(host.textContent).toContain("Browse reusable formats"));
    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Browse reusable formats")!.click();
    });
    await vi.waitFor(() => expect(host.textContent).toContain("Other accessible meeting"));
    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Copy this format")!.click();
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const sent = meetingAgendaSaveSchema.parse(api.postJson.mock.calls[0]![1]);
    expect(sent.items[0]!.id).not.toBe(original.id);
    expect(sent.items[0]!.speakerUserIds).toEqual([]);
    expect(sent.fromOccurrenceId).toBe(agenda.occurrenceId);
    expect(sent.expectedFormatVersion).toBe(agenda.formatVersion);
  });
  it("renders approved agendas as immutable", async () => {
    api.getJson.mockResolvedValue({ ...agenda, publishedAt: "2026-10-03T00:00:00.000Z" });
    await act(async () =>
      render(
        <MeetingAgendaEditor groupId="group" seriesId={agenda.seriesId} occurrenceId={agenda.occurrenceId!} />,
        host,
      ),
    );
    await vi.waitFor(() => expect(host.textContent).toContain("past or approved"));
    expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Save agenda")!.disabled).toBe(
      true,
    );
  });
});
