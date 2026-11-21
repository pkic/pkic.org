import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { eventAttendanceRegistrationsQuerySchema } from "../../assets/shared/schemas/event-registrations";
import { ColumnTextFilterRow } from "../../assets/ts/components/table-filter-strip";

let container: HTMLDivElement;
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
});

it("commits a query-contract draft, preserves the label, and discards invalid drafts with Cancel or Escape", async () => {
  container = document.createElement("div");
  document.body.append(container);
  const onInput = vi.fn();
  const onClose = vi.fn();
  await act(() =>
    render(
      <ColumnTextFilterRow
        columnLabel="LinkedIn URL for PKI Consortium"
        param="job_title"
        value="Engineer"
        schema={eventAttendanceRegistrationsQuerySchema.pick({ job_title: true })}
        onInput={onInput}
        onClose={onClose}
      />,
      container,
    ),
  );
  const input = container.querySelector("input")!;
  expect(container.querySelector("label")!.textContent).toBe("Filter LinkedIn URL for PKI Consortium");
  await act(() => {
    input.value = "x".repeat(201);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(onInput).not.toHaveBeenCalled();
  await act(() => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(onClose).not.toHaveBeenCalled();
  await act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(onClose).toHaveBeenCalledOnce();
  const cancel = [...container.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!;
  expect(cancel.type).toBe("button");
  await act(() => cancel.click());
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(onInput).not.toHaveBeenCalled();
  await act(() => {
    input.value = "  Architect  ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(eventAttendanceRegistrationsQuerySchema.parse({ job_title: onInput.mock.calls[0][0] }).job_title).toBe(
    "Architect",
  );
});
