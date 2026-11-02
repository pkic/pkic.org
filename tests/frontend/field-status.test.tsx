import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { useContractForm } from "../../assets/ts/hooks/useContractForm";
import { ChoiceCard } from "../../assets/ts/ui/ChoiceCard";
import { Button } from "../../assets/ts/ui/Button";
import { InputGroup } from "../../assets/ts/ui/InputGroup";
import { Field } from "../../assets/ts/ui/Field";
import { FieldStatus } from "../../assets/ts/ui/FieldStatus";
import { TextInput } from "../../assets/ts/ui/TextControl";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) {
    void act(() => render(null, host));
    host.remove();
  }
});

const schema = z.object({ text: z.string().trim().min(1, "Write a message.").max(5, "Keep it short.") }).strict();

/** A composer on the contract: its message goes to a status line it places, and empty is at rest. */
function Composer({ quiet }: { quiet: boolean }) {
  const [text, setText] = useState("");
  const form = useContractForm(schema, { text }, { quietWhenEmpty: quiet });
  const field = form.of("text");
  return (
    <form noValidate {...form.handlers} onSubmit={(event) => event.preventDefault()}>
      <FieldStatus id="composer-status" state={field.state} message={field.message}>
        Everyone sees this.
      </FieldStatus>
      <Field label="Message" labelHidden statusId="composer-status" {...field}>
        {(control) => (
          <TextInput {...control} name="text" value={text} onInput={(event) => setText(event.currentTarget.value)} />
        )}
      </Field>
      <button type="submit" disabled={!form.valid}>
        Send
      </button>
    </form>
  );
}

function mount(quiet = true) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => render(<Composer quiet={quiet} />, host));
  return host;
}

function type(host: HTMLElement, value: string) {
  const input = host.querySelector("input")!;
  void act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

describe("a field reporting to a status line", () => {
  it("names the status line instead of drawing a message under the control", () => {
    const host = mount();
    const input = type(host, "too long");
    expect(input.getAttribute("aria-describedby")).toBe("composer-status");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const status = host.querySelector("#composer-status")!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Keep it short.");
    expect(host.querySelector(".pk-field__message, .pk-field__state")).toBeNull();
  });

  it("keeps an emptied composer at rest, with submit disabled by the contract", () => {
    const host = mount();
    const input = type(host, "hi");
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
    type(host, "   ");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(host.querySelector("#composer-status")!.textContent).toBe("Everyone sees this.");
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  });

  it("still reports an emptied field when the form does not opt in", () => {
    const host = mount(false);
    type(host, "hi");
    type(host, "");
    expect(host.querySelector("#composer-status")!.textContent).toBe("Write a message.");
  });

  it("leaves a default Field's message under its control", () => {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    void act(() =>
      render(
        <Field label="Name" state="invalid" message="Write your name.">
          {(control) => <TextInput {...control} name="name" />}
        </Field>,
        host,
      ),
    );
    const input = host.querySelector("input")!;
    const message = host.querySelector(".pk-field__message")!;
    expect(message.textContent).toContain("Write your name.");
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
  });
});

it("keeps field labels distinct across independently rendered dialog roots", () => {
  const roots = [mount(), mount()];
  const controls = roots.map((host) => host.querySelector("input")!);
  expect(controls[0].id).not.toBe(controls[1].id);
  for (const [index, host] of roots.entries()) {
    expect(host.querySelector("label")!.control).toBe(controls[index]);
  }
});

it("keeps choice titles distinct across independently rendered dialog roots", () => {
  const roots = [document.createElement("div"), document.createElement("div")];
  for (const [index, host] of roots.entries()) {
    hosts.push(host);
    document.body.append(host);
    void act(() => render(<ChoiceCard icon={null} name={`choice-${index}`} title={`Choice ${index}`} />, host));
  }
  const titleIds = roots.map((host) => host.querySelector("input")!.getAttribute("aria-labelledby")!);
  expect(titleIds[0]).not.toBe(titleIds[1]);
  for (const [index, host] of roots.entries()) {
    expect(host.contains(document.getElementById(titleIds[index]))).toBe(true);
  }
});

it("keeps server template identifiers separate from a fresh browser runtime", async () => {
  vi.resetModules();
  vi.stubGlobal("document", undefined);
  let serverId: string;
  try {
    const server = await import("../../assets/ts/ui/dom-id");
    serverId = server.nextDomId("field");
  } finally {
    vi.unstubAllGlobals();
  }
  vi.resetModules();
  const client = await import("../../assets/ts/ui/dom-id");
  expect(client.nextDomId("field")).not.toBe(serverId!);
});

describe("a field with an input and action", () => {
  it("keeps its validation mark inside the input and retains the control as validation changes", () => {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    function specimen(state?: "invalid" | "ok") {
      return (
        <Field label="Organization" state={state} message={state ? "Choose an organization." : undefined}>
          {(control) => (
            <InputGroup>
              <TextInput {...control} />
              <Button aria-label="Add organization">+</Button>
            </InputGroup>
          )}
        </Field>
      );
    }
    void act(() => render(specimen(), host));
    const input = host.querySelector("input")!;
    input.focus();
    for (const state of ["invalid", "ok", undefined] as const) {
      void act(() => render(specimen(state), host));
      expect(host.querySelector("input")).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(input.getAttribute("aria-invalid")).toBe(state === "invalid" ? "true" : null);
      const wrapper = host.querySelector(".pk-input-group__control")!;
      expect(wrapper.contains(input)).toBe(true);
      expect(wrapper.querySelector(".pk-field__state") !== null).toBe(Boolean(state));
      expect(wrapper.querySelector("button")).toBeNull();
      expect(host.querySelector(".pk-input-group > button")).not.toBeNull();
    }
  });
});
