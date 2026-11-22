// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import type {
  ContentCheckSettingsResponse,
  EventContentCheckResponse,
} from "../../assets/shared/schemas/content-checks";
import { ContentChecks } from "../../assets/ts/member-flows/portal/sections/content-checks/ContentChecks";
import { EventContentCheckContext } from "../../assets/ts/member-flows/portal/sections/content-checks/EventContentCheckContext";
import { beginRecordEdit } from "./helpers/record-edit";

let root: HTMLElement;
afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const settings = (kind: ContentCheckSettingsResponse["kind"]): ContentCheckSettingsResponse => ({
  kind,
  revision: 0,
  saved: false,
  updatedAt: null,
  enabled: true,
  model: "clef-flash",
  context: "",
  questions: [],
});

async function submitEdit(label: string, editLabel?: string) {
  await beginRecordEdit(root, label, editLabel);
  await act(async () => {
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

it("starts a revisited kind from what was saved, with its new revision", async () => {
  const puts: Array<{ url: string; body: { expectedRevision: number } }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        puts.push({ url: String(input), body: JSON.parse(String(init.body)) });
        return Response.json({ success: true, revision: puts.length });
      }
      return Response.json({ checks: [settings("chat_message"), settings("audience_question")] });
    }),
  );
  root = document.createElement("div");
  document.body.append(root);
  const show = (kind: string) => act(async () => render(<ContentChecks canWrite kind={kind} />, root));

  await show("chat_message");
  await vi.waitFor(async () => {
    await settle();
    expect(root.querySelector('button[aria-label="Check actions"]')).not.toBeNull();
  });
  await submitEdit("Check actions");
  expect(puts.map((put) => put.body.expectedRevision)).toEqual([0]);

  await show("audience_question");
  await settle();
  await show("chat_message");
  await settle();
  await submitEdit("Check actions");
  expect(puts.map((put) => put.body.expectedRevision)).toEqual([0, 1]);
});

it("saves an event's context through its contract, which includes the revision it was loaded at", async () => {
  const check: EventContentCheckResponse = {
    kind: "chat_message",
    settings: settings("chat_message"),
    additions: {
      revision: 3,
      context: "Post-quantum migration.",
      questions: [],
      disabledQuestionIds: [],
      updatedAt: null,
    },
    effective: { enabled: true, model: "clef-flash", context: "", questions: [] },
  };
  const onSave = vi.fn(async () => {});
  root = document.createElement("div");
  document.body.append(root);
  await act(async () => render(<EventContentCheckContext check={check} canEdit onSave={onSave} />, root));
  await submitEdit("Context actions", "Edit context");
  expect(onSave).toHaveBeenCalledWith("Post-quantum migration.");
});
