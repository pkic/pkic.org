// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { livePollDraftSchema, type LivePollDraft } from "../../assets/shared/schemas/live-session-poll";
import { LivePollEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LivePollEditor";
import { QuestionBasics } from "../../assets/ts/components/forms/FormQuestionCard";
import { emptyFieldDraft } from "../../assets/ts/components/forms/form-field-draft";
import { livePoll, livePollResults } from "./helpers/live-room-socket";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
/** The confirmation opened over the editor: the last dialog on the page. */
const confirmation = () => [...document.querySelectorAll<HTMLElement>("[role='alertdialog'], dialog[open]")].at(-1);

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
  history.replaceState(null, "", location.pathname);
});
function mount(poll?: ReturnType<typeof livePoll>) {
  history.replaceState(null, "", "/portal/#/events/synthetic/live");
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const save = vi.fn<(draft: LivePollDraft, discardRemovedAnswers: boolean) => boolean>(() => true);
  const close = vi.fn();
  void act(() =>
    render(
      <>
        <LivePollEditor poll={poll} onSave={save} onClose={close} />
        <ConfirmDialogHost />
      </>,
      host,
    ),
  );
  return { host, save, close };
}
function button(host: ParentNode, label: string) {
  const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
function input(host: HTMLElement, label: string) {
  const name = [...host.querySelectorAll("label")].find((item) => item.textContent?.trim() === label);
  if (!name?.htmlFor) throw new Error(`Missing field: ${label}`);
  return host.querySelector<HTMLInputElement>(`[id='${name.htmlFor}']`)!;
}
function type(control: HTMLInputElement, value: string) {
  void act(() => {
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it.each([
  ["Yes / no", "select", "radios", ["Yes", "No"], undefined, undefined],
  ["Yes / no / unsure", "select", "radios", ["Yes", "No", "Unsure"], undefined, undefined],
  ["Rating 1–5", "number", "rating_stars", undefined, 1, 5],
  ["NPS 0–10", "number", "nps", undefined, 0, 10],
])("prepares the %s starting point through the live poll contract", (starter, fieldType, widget, options, min, max) => {
  const { host, save, close } = mount();
  type(input(host, "Question"), "My session question");
  void act(() => button(host, starter as string).click());
  expect(input(host, "Question").value).toBe("My session question");
  expect(host.querySelector("select")).toBeNull();
  expect(host.querySelectorAll("input[type='radio']").length).toBeGreaterThanOrEqual(3);
  expect(host.querySelector("details")).toBeNull();
  void act(() => button(host, "Add poll").click());
  expect(save).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  const checked = livePollDraftSchema.parse(save.mock.calls[0]![0]);
  expect(checked.field).toMatchObject({ label: "My session question", fieldType, required: true });
  expect(checked.field.validation).toMatchObject({ uiWidget: widget });
  if (options) expect(checked.field.options?.map((option) => option.value)).toEqual(options);
  if (min !== undefined) expect(checked.field.validation?.min).toBe(min);
  if (max !== undefined) expect(checked.field.validation?.max).toBe(max);
});
it("keeps an edited draft's rules and values when switching detail tabs", () => {
  const poll = livePoll({ status: "draft", showResults: false });
  poll.field.validation = { uiWidget: "radios", helpText: "Read before choosing", adminVisualization: "pie" };
  const { host, save } = mount(poll);
  void act(() => button(host, "Details").click());
  expect(input(host, "Description").value).toBe("Read before choosing");
  type(input(host, "Description"), "Updated guidance");
  void act(() => host.querySelector<HTMLButtonElement>("[role='tab'][aria-controls]")!.click());
  expect(input(host, "Question").value).toBe(poll.field.label);
  void act(() => button(host, "Save poll").click());
  const checked = livePollDraftSchema.parse(save.mock.calls[0]![0]);
  expect(checked.showResults).toBe(false);
  expect(checked.field.options).toEqual(poll.field.options);
  expect(checked.field.validation).toMatchObject({ helpText: "Updated guidance", adminVisualization: "pie" });
});
it("refuses invalid score bounds without saving, then saves a corrected draft", () => {
  const { host, save, close } = mount();
  void act(() => button(host, "Rating 1–5").click());
  type(input(host, "Highest score"), "1");
  void act(() => button(host, "Add poll").click());
  expect(save).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(input(host, "Highest score").getAttribute("aria-invalid")).toBe("true");
  type(input(host, "Highest score"), "5");
  void act(() => button(host, "Add poll").click());
  expect(save).toHaveBeenCalledOnce();
});
it("retains the normal forms answer-type select by default", () => {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => render(<QuestionBasics field={emptyFieldDraft(0, "select")} update={() => {}} />, host));
  expect(host.querySelector("select")).not.toBeNull();
  expect(host.querySelector("input[type='radio']")).toBeNull();
});
it("corrects an open poll's wording while each choice keeps its stored value and the answer type stays fixed", () => {
  const poll = livePoll({ status: "open", results: livePollResults({ "Root CA": 3, "TLS endpoints": 1 }) });
  const { host, save } = mount(poll);
  expect([...host.querySelectorAll("button")].some((item) => item.textContent?.trim() === "Yes / no")).toBe(false);
  expect(host.querySelectorAll("input[type='radio']")).toHaveLength(1);
  type(input(host, "Question"), "Which migration should come first?");
  type(host.querySelector<HTMLInputElement>("input[aria-label='Choice 2']")!, "TLS endpoints and APIs");
  void act(() => button(host, "Save poll").click());
  const [draft, discard] = save.mock.calls[0]!;
  const checked = livePollDraftSchema.parse(draft);
  expect(checked.field.label).toBe("Which migration should come first?");
  expect(checked.field.options?.map(({ value, label }) => [value, label])).toEqual([
    ["Root CA", "Root CA"],
    ["TLS endpoints", "TLS endpoints and APIs"],
  ]);
  expect(discard).toBe(false);
});
it("asks before a removed choice takes its answers with it", async () => {
  const poll = livePoll({ status: "closed", results: livePollResults({ "Root CA": 3, "TLS endpoints": 1 }) });
  poll.field = {
    ...poll.field,
    options: [...(poll.field.options ?? []), { value: "Code signing", label: "Code signing", active: true }],
  };
  const { host, save } = mount(poll);
  void act(() => host.querySelector<HTMLButtonElement>("button[aria-label='Remove choice 1']")!.click());
  await act(async () => button(host, "Save poll").click());
  expect(confirmation()?.textContent).toContain("3 answers are deleted");
  expect(save).not.toHaveBeenCalled();
  await act(async () => button(confirmation()!, "Remove and save").click());
  const [draft, discard] = save.mock.calls[0]!;
  expect(livePollDraftSchema.parse(draft).field.options?.map((option) => option.value)).toEqual([
    "TLS endpoints",
    "Code signing",
  ]);
  expect(discard).toBe(true);
});
