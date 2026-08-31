// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { confirmAction, ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { confirmationConsequences, requestClose, typedConfirmationInput } from "./helpers/confirm-dialog";
import { EmptyState } from "../../assets/ts/components/EmptyState";
import { RowActions } from "../../assets/ts/ui/RowActions";
import { Spinner } from "../../assets/ts/components/Spinner";
import { DataTable } from "../../assets/ts/components/Table";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

function dialogButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`missing button: ${label}`);
  return button;
}

describe("ConfirmDialog", () => {
  it("renders title, body, and consequences, and resolves true on the named confirm action", async () => {
    const container = mount(<ConfirmDialogHost />);
    let pending!: Promise<boolean>;
    await act(() => {
      pending = confirmAction({
        title: "Remove Dana Yu from Example Corp?",
        body: "Their representative record is removed; their user account is kept.",
        consequences: ["They lose access to Example Corp resources", "Their votes already cast are kept"],
        confirmLabel: "Remove from organization",
      });
    });
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Remove Dana Yu from Example Corp?");
    expect(dialog?.textContent).toContain("their user account is kept");
    expect(confirmationConsequences(container)).toHaveLength(2);
    // The confirm button names the action instead of a generic "OK".
    await act(() => {
      dialogButton(container, "Remove from organization").click();
    });
    await expect(pending).resolves.toBe(true);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("resolves false on Cancel and on Escape", async () => {
    const container = mount(<ConfirmDialogHost />);
    let first!: Promise<boolean>;
    await act(() => {
      first = confirmAction({ title: "Revoke invitation?", confirmLabel: "Revoke invitation" });
    });
    await act(() => {
      dialogButton(container, "Cancel").click();
    });
    await expect(first).resolves.toBe(false);

    let second!: Promise<boolean>;
    await act(() => {
      second = confirmAction({ title: "Revoke invitation?", confirmLabel: "Revoke invitation" });
    });
    await act(() => requestClose(container));
    await expect(second).resolves.toBe(false);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("keeps the confirm button disabled until the typed confirmation matches exactly", async () => {
    const container = mount(<ConfirmDialogHost />);
    let pending!: Promise<boolean>;
    await act(() => {
      pending = confirmAction({
        title: "Anonymize this user?",
        confirmLabel: "Anonymize user",
        typedConfirmation: "dana@example.com",
      });
    });
    const confirm = dialogButton(container, "Anonymize user");
    expect(confirm.disabled).toBe(true);
    const input = typedConfirmationInput(container);
    if (!input) throw new Error("missing typed-confirmation input");
    await act(() => {
      input.value = "dana@example";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(dialogButton(container, "Anonymize user").disabled).toBe(true);
    await act(() => {
      input.value = "dana@example.com";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const enabled = dialogButton(container, "Anonymize user");
    expect(enabled.disabled).toBe(false);
    await act(() => enabled.click());
    await expect(pending).resolves.toBe(true);
  });

  it("cancels a superseded request instead of stacking two dialogs", async () => {
    mount(<ConfirmDialogHost />);
    let first!: Promise<boolean>;
    await act(() => {
      first = confirmAction({ title: "First?", confirmLabel: "Do it" });
    });
    await act(() => {
      void confirmAction({ title: "Second?", confirmLabel: "Do it" });
    });
    await expect(first).resolves.toBe(false);
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    await act(() => requestClose());
  });
});

describe("RowActions", () => {
  it("shows status text and a labeled actions menu, and never bubbles clicks into row navigation", async () => {
    let rowClicked = 0;
    let selected = 0;
    const container = mount(
      <div onClick={() => (rowClicked += 1)}>
        <RowActions
          status="Invited"
          actions={[{ id: "revoke", label: "Revoke invitation", onSelect: () => (selected += 1) }]}
        />
      </div>,
    );
    expect(container.textContent).toContain("Invited");
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
    if (!trigger) throw new Error("missing menu trigger");
    await act(() => trigger.click());
    const item = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === "Revoke invitation",
    );
    if (!item) throw new Error("missing menu item");
    await act(() => item.click());
    expect(selected).toBe(1);
    expect(rowClicked).toBe(0);
  });

  it("renders status alone when there are no actions", () => {
    const container = mount(<RowActions status="Removed" actions={[]} />);
    expect(container.textContent).toContain("Removed");
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  });
});

describe("EmptyState", () => {
  it("names the absence and hands the viewer the action", async () => {
    let created = 0;
    const container = mount(
      <EmptyState
        title="No roles yet"
        body="Create a role to bundle permissions you assign together."
        action={{ label: "New role", onSelect: () => (created += 1) }}
      />,
    );
    expect(container.querySelector('[role="status"]')?.textContent).toContain("No roles yet");
    const button = dialogButton(container, "New role");
    await act(() => button.click());
    expect(created).toBe(1);
  });

  it("renders inside a table empty slot without the placeholder italics", () => {
    const container = mount(
      <DataTable
        columns={[{ header: { label: "Name" }, cell: () => null }]}
        data={[]}
        empty={<EmptyState title="No people found" />}
      />,
    );
    expect(container.querySelector(".pkic-empty-state-title")?.textContent).toBe("No people found");
    expect(container.querySelector("td")?.className).not.toContain("fst-italic");
  });
});

describe("Spinner", () => {
  it("names what is loading when given a label", () => {
    const container = mount(<Spinner label="Loading registrations…" />);
    expect(container.textContent).toContain("Loading registrations…");
  });
});
