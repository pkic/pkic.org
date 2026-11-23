// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import type { ClassifierQuestion } from "../../assets/shared/classifiers";
import {
  classifierEventAdditionsInputSchema,
  type ClassifierSettingsResponse,
  type ClassifierSharedSettingsResponse,
} from "../../assets/shared/schemas/classifiers";
import { ClassifierContext } from "../../assets/ts/member-flows/portal/sections/classifiers/ClassifierContext";
import { Classifiers } from "../../assets/ts/member-flows/portal/sections/classifiers/Classifiers";
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
  disabledQuestionIds: [],
});

const conduct: ClassifierQuestion = {
  id: "conduct",
  kind: "flag",
  question: "Does this break the code of conduct?",
  adviseAtPercent: 60,
  blockAtPercent: 90,
  message: "This breaks the code of conduct.",
};

const shared = (questions: ClassifierQuestion[] = []): ClassifierSharedSettingsResponse => ({
  revision: 2,
  saved: true,
  updatedAt: null,
  context: "PKIC rules.",
  questions,
});

type Put = { url: string; body: Record<string, unknown> & { expectedRevision: number } };

function stubApi(list: unknown): Put[] {
  const puts: Put[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        puts.push({ url: String(input), body: JSON.parse(String(init.body)) });
        return Response.json({ success: true, revision: puts.length });
      }
      return Response.json(list);
    }),
  );
  return puts;
}

async function mount(node: preact.ComponentChild) {
  root = document.createElement("div");
  document.body.append(root);
  await act(async () => render(node, root));
}

async function submitEdit(label: string, editLabel?: string) {
  await beginRecordEdit(root, label, editLabel);
  await act(async () => {
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

it("starts a revisited kind from what was saved, with its new revision", async () => {
  const puts = stubApi({ shared: shared(), classifiers: [settings("chat"), settings("question")] });
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

it("opens on All content and saves its flags apart from any kind", async () => {
  const puts = stubApi({ shared: shared([conduct]), classifiers: [settings("chat")] });
  await mount(<Classifiers canWrite />);
  await vi.waitFor(async () => {
    await settle();
    expect(root.querySelector('[aria-current="page"]')?.textContent).toBe("All content");
  });
  expect(root.textContent).toContain("Does this break the code of conduct?");
  await submitEdit("Context actions", "Edit context");
  expect(puts).toEqual([
    { url: "/api/v1/classifiers/all", body: { expectedRevision: 2, context: "PKIC rules.", questions: [conduct] } },
  ]);
});

it("lists the All content flags on a kind's tab and turns one off for that kind only", async () => {
  const puts = stubApi({ shared: shared([conduct]), classifiers: [settings("chat")] });
  await mount(<Classifiers canWrite kind="chat" />);
  const row = await vi.waitFor(async () => {
    await settle();
    const found = [...root.querySelectorAll("tbody tr")].find((candidate) =>
      candidate.textContent?.includes("conduct"),
    );
    if (!found) throw new Error("No conduct row");
    return found;
  });
  expect(row.textContent).toContain("All content");
  await act(async () => row.querySelector<HTMLButtonElement>('button[aria-label="Actions for conduct"]')!.click());
  const labels = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
  expect(labels).toEqual(["Change for chat messages", "Turn off"]);
  const off = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "Turn off",
  )!;
  await act(async () => off.click());
  await settle();
  expect(puts.map((put) => [put.url, put.body.disabledQuestionIds])).toEqual([
    ["/api/v1/classifiers/chat", ["conduct"]],
  ]);
});

it("saves an event's context through its contract, which includes the revision it was loaded at", async () => {
  const additions = { revision: 3, context: "Post-quantum migration.", questions: [], disabledQuestionIds: [] };
  const onSave = vi.fn(async () => {});
  await mount(
    <ClassifierContext
      schema={classifierEventAdditionsInputSchema}
      bodyFor={(context) => ({ expectedRevision: additions.revision, ...additions, context })}
      context={additions.context}
      term="This event"
      help="Added after the PKIC-wide context."
      below={{ term: "PKIC-wide", context: "" }}
      canEdit
      onSave={onSave}
    />,
  );
  await submitEdit("Context actions", "Edit context");
  expect(onSave).toHaveBeenCalledWith("Post-quantum migration.");
});
