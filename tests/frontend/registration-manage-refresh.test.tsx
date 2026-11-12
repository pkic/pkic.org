import { afterEach, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { renderToString } from "preact-render-to-string";
import { EventRegistrationManagement } from "../../assets/ts/site/EventRegistrationManagement";
import { FORMS, readResponse } from "./helpers/participant-registration-fixtures";

const editor = vi.hoisted(() => ({ refresh: null as null | (() => Promise<void>) }));
vi.mock("../../assets/ts/components/events/RegistrationFlow", () => ({
  RegistrationFlow: ({ onProfileUpdated }: { onProfileUpdated: () => Promise<void> }) => {
    editor.refresh = onProfileUpdated;
    return null;
  },
}));

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
  vi.unstubAllGlobals();
  editor.refresh = null;
});

it("keeps the latest saved profile in the manage summary when refreshes finish out of order", async () => {
  vi.resetModules();
  window.history.replaceState({}, "", "/events/2026/pqc-2026/manage/?token=manage-token&editRegistration=1");
  document.body.innerHTML = renderToString(<EventRegistrationManagement />);
  document.querySelector<HTMLElement>("[data-event-registration-manage]")!.dataset.eventSlug = "pqc-2026";
  const pending: Array<(response: Response) => void> = [];
  let initialRead = true;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("/forms/placements/")) return Promise.resolve(Response.json(FORMS));
      if (initialRead) {
        initialRead = false;
        return Promise.resolve(Response.json(readResponse()));
      }
      return new Promise<Response>((resolve) => pending.push(resolve));
    }),
  );
  await act(async () => {
    await import("../../assets/ts/event-flows/registration-manage-page");
  });
  await vi.waitFor(() => expect(editor.refresh).toBeTypeOf("function"));

  const older = editor.refresh!();
  const latest = editor.refresh!();
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  const response = (title: string) => {
    const data = readResponse();
    data.user.job_title = title;
    return Response.json(data);
  };
  const summary = document.querySelector<HTMLElement>("[data-manage-summary]")!;
  await act(async () => {
    pending[1]!(response("Latest saved title"));
    await latest;
  });
  expect(summary.textContent).toContain("Latest saved title");
  await act(async () => {
    pending[0]!(response("Older saved title"));
    await older;
  });
  expect(summary.textContent).toContain("Latest saved title");
  expect(summary.textContent).not.toContain("Older saved title");
});
