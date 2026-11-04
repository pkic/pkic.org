// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";
import { AgendaSession } from "../../assets/ts/site/AgendaSession";

it("opens an editor card only for an intentional pointer gesture or title activation", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const onOpen = vi.fn();
  const onDragStart = vi.fn();
  await act(() =>
    render(
      <AgendaSession
        session={{ title: "Session", descriptionHtml: "Abstract", locations: [], speakers: [] }}
        slot={{ startsAt: "2026-11-04T12:00:00.000Z" }}
        locations={[]}
        dialogId="session"
        timeZone="UTC"
        editor={{ controls: <button type="button">Actions</button>, onOpen, onDragStart }}
      />,
      host,
    ),
  );
  const card = host.querySelector("article")!;
  const body = card.querySelector(".pk-content-agenda__session-body")!;
  const other = card.querySelector("h3")!;
  const nested = card.querySelector<HTMLButtonElement>(".pk-content-agenda__card-header button")!;
  const pointer = (target: Element, type: string, values: Record<string, unknown> = {}) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 0,
      clientY: 0,
      ...values,
    }))
      Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
  };
  try {
    await act(() => {
      pointer(body, "pointerdown");
      pointer(body, "pointerup");
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    await act(() => {
      pointer(body, "pointerdown");
      pointer(body, "pointermove", { clientX: 10 });
      pointer(body, "pointerup", { clientX: 10 });
    });
    await act(() => {
      pointer(body, "pointerdown");
      card.dispatchEvent(new Event("dragstart", { bubbles: true }));
      pointer(body, "pointerup");
    });
    await act(() => {
      pointer(nested, "pointerdown");
      pointer(nested, "pointerup");
    });
    await act(() => {
      pointer(body, "pointerdown");
      pointer(other, "pointerup");
    });
    await act(() => {
      pointer(body, "pointerdown");
      pointer(body, "pointerup", { pointerId: 2 });
    });
    await act(() => {
      pointer(body, "pointerdown");
      pointer(body, "pointercancel");
      pointer(body, "pointerup");
    });
    await act(() => {
      pointer(body, "pointerdown", { button: 2 });
      pointer(body, "pointerup", { button: 2 });
    });
    const selection = vi
      .spyOn(window, "getSelection")
      .mockReturnValue({ toString: () => "selected text" } as Selection);
    await act(() => {
      pointer(body, "pointerdown");
      pointer(body, "pointerup");
    });
    selection.mockRestore();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onDragStart).toHaveBeenCalledOnce();
    await act(() => card.querySelector<HTMLButtonElement>('[aria-label="Open session details: Session"]')!.click());
    expect(onOpen).toHaveBeenCalledTimes(2);
  } finally {
    await act(() => render(null, host));
    host.remove();
    vi.restoreAllMocks();
  }
});
