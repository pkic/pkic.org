// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import type { ClassifierSettingsResponse, EventClassifierResponse } from "../../assets/shared/schemas/classifiers";
import { Classifiers } from "../../assets/ts/member-flows/portal/sections/classifiers/Classifiers";
import { EventClassifierContext } from "../../assets/ts/member-flows/portal/sections/classifiers/EventClassifierContext";
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

const settings = (kind: ClassifierSettingsResponse["kind"]): ClassifierSettingsResponse => ({
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
      return Response.json({ classifiers: [settings("chat"), settings("question")] });
    }),
  );
  root = document.createElement("div");
  document.body.append(root);
  const show = (kind: string) => act(async () => render(<Classifiers canWrite kind={kind} />, root));

  await show("chat");
  await vi.waitFor(async () => {
    await settle();
    expect(root.querySelector('button[aria-label="Classifier actions"]')).not.toBeNull();
  });
  await submitEdit("Classifier actions");
  expect(puts.map((put) => put.body.expectedRevision)).toEqual([0]);

  await show("question");
  await settle();
  await show("chat");
  await settle();
  await submitEdit("Classifier actions");
  expect(puts.map((put) => put.body.expectedRevision)).toEqual([0, 1]);
});

it("saves an event's context through its contract, which includes the revision it was loaded at", async () => {
  const check: EventClassifierResponse = {
    kind: "chat",
    settings: settings("chat"),
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
  await act(async () => render(<EventClassifierContext check={check} canEdit onSave={onSave} />, root));
  await submitEdit("Context actions", "Edit context");
  expect(onSave).toHaveBeenCalledWith("Post-quantum migration.");
});
