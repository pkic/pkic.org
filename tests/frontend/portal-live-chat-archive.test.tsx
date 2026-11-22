// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  confirm: vi.fn(async () => true),
  downloadFile: vi.fn(),
}));
vi.mock("../../assets/ts/member-flows/portal/ui", () => ({ toast: mocks.toast }));
vi.mock("../../assets/ts/components/ConfirmDialog", () => ({ confirmAction: mocks.confirm }));
vi.mock("../../assets/ts/shared/download-file", () => ({ downloadFile: mocks.downloadFile }));
import { LiveChatArchive } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/LiveChatArchive";

let host: HTMLDivElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function mount(respond: (url: string, method: string) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      respond(new URL(String(input), location.origin).pathname, init?.method ?? "GET"),
    ),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => render(<LiveChatArchive slug="event-one" />, host));
}

function button(name: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  )!;
}

it("saves the event's chat as a file, and keeps a refused download on the page as an error", async () => {
  let tooLarge = false;
  await mount((url) =>
    tooLarge
      ? Response.json({ error: { code: "CSV_EXPORT_TOO_LARGE", message: "Too large." } }, { status: 413 })
      : (expect(url).toBe("/api/v1/events/event-one/agenda/chat/exports"),
        new Response("Session\r\nKeynote", { headers: { "content-type": "text/csv" } })),
  );
  await act(async () => button("Download chat (CSV)").click());
  await vi.waitFor(() =>
    expect(mocks.downloadFile).toHaveBeenCalledWith(expect.any(Blob), "text/csv", "event-one-live-chat.csv"),
  );

  tooLarge = true;
  await act(async () => button("Download chat (CSV)").click());
  await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.any(String), "error"));
  expect(mocks.downloadFile).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Attendee chat");
});

it("erases after confirmation and reports the counts", async () => {
  await mount((url, method) => {
    expect([url, method]).toEqual(["/api/v1/events/event-one/agenda/chat", "DELETE"]);
    return Response.json({ erasedChats: 1200, openChats: 1 });
  });
  await act(async () => button("Erase chat…").click());
  await vi.waitFor(() =>
    expect(mocks.toast).toHaveBeenCalledWith("Erased 1,200 chats. 1 chat still open kept its messages.", "success"),
  );
  expect(mocks.confirm).toHaveBeenCalledOnce();
});
