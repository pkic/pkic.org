// @vitest-environment jsdom
import axe from "axe-core";
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailFirstStep } from "../../assets/ts/components/EmailFirstStep";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import {
  DISPOSABLE_EMAIL_REFUSED,
  EMAIL_FIRST_ADVISORY_COPY,
  EMAIL_FIRST_COPY,
  EXAMPLE_WORK_EMAIL,
  WORK_EMAIL_STEER,
  type EmailFirstFlow,
} from "../../assets/shared/email-first-copy";
import type { MailboxKind } from "../../assets/shared/schemas/email-domains";
import { workEmailStepForKindSchema, workEmailStepSchema } from "../../assets/shared/schemas/work-email";
import { chooseCard, controlFor, radioNamed } from "./helpers/labeled-control";

let host: HTMLDivElement | undefined;

/**
 * The server's side of continuing: it knows which domains are free or
 * disposable, applies the shared work-email rule and refuses through the
 * validation envelope, which is all the browser ever sees of the lists.
 */
const SERVER_KINDS: Record<string, MailboxKind> = { "gmail.com": "free", "mailinator.com": "disposable" };
const kindOf = (domain: string): MailboxKind => SERVER_KINDS[domain] ?? "work";
function serverScreen(step: unknown, sent: unknown[]): void {
  const parsed = workEmailStepSchema.parse(step);
  const screened = workEmailStepForKindSchema(kindOf(parsed.email.slice(parsed.email.indexOf("@") + 1))).safeParse(
    parsed,
  );
  if (!screened.success)
    throw new ApiClientError(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request", details: screened.error.flatten() } },
      400,
    );
  sent.push(parsed);
}

/** `GET /api/v1/email/domains/:domain`, answered from the same lists. */
function serveDomainLookups(): string[] {
  const looked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const domain = decodeURIComponent(String(input).split("/").pop() ?? "");
      looked.push(domain);
      return new Response(JSON.stringify({ domain, kind: kindOf(domain) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return looked;
}

function Harness({ flow, onContinue }: { flow: EmailFirstFlow; onContinue: (step: unknown) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [individual, setIndividual] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  return (
    <EmailFirstStep
      flow={flow}
      email={email}
      onEmailChange={setEmail}
      individual={individual}
      onIndividualChange={setIndividual}
      onContinue={async (step) => {
        await onContinue(step);
        setSentTo(step.email);
      }}
      sentTo={sentTo}
      onChangeEmail={() => setSentTo(null)}
    />
  );
}

async function mount(flow: EmailFirstFlow, onContinue: (step: unknown) => Promise<void> = async () => {}) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<Harness flow={flow} onContinue={onContinue} />, host!));
}
async function type(label: string, value: string) {
  await act(() => {
    const control = controlFor(host!, label);
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function leave(label: string) {
  await act(() => {
    const control = controlFor(host!, label);
    control.focus();
    control.blur();
  });
}
const buttonTexts = () => [...host!.querySelectorAll("button")].map((button) => button.textContent);
async function click(label: string) {
  await act(async () => {
    const button = [...host!.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
    if (!button) throw new Error(`no button reads "${label}"`);
    button.click();
  });
}

afterEach(() => {
  if (host) render(null, host);
  document.body.innerHTML = "";
  host = undefined;
  vi.unstubAllGlobals();
});

describe("email-first step", () => {
  const copy = EMAIL_FIRST_COPY.registration;

  it.each(Object.keys(EMAIL_FIRST_COPY) as EmailFirstFlow[])(
    "recommends the work card in the %s flow, with the emphasis on work",
    async (flow) => {
      await mount(flow);
      const work = radioNamed(host!, "Use your work email (recommended)");
      expect(work.checked).toBe(true);
      const emphasis = work.closest("label")?.querySelector("strong, em");
      expect(emphasis?.textContent).toBe("work");
    },
  );

  it("offers the work and personal email as one radio group, work chosen, and follows the choice", async () => {
    await mount("registration");
    const work = radioNamed(host!, copy.work.title);
    const personal = radioNamed(host!, copy.personal.title);
    expect(work.closest('[role="radiogroup"]')).toBe(personal.closest('[role="radiogroup"]'));
    expect(work.name).toBe(personal.name);
    expect(work.checked).toBe(true);
    expect(personal.checked).toBe(false);
    // Each card is described by what choosing it means.
    const describedBy = (radio: HTMLInputElement) =>
      document.getElementById(radio.getAttribute("aria-describedby")!)!.textContent;
    for (const point of copy.work.points) expect(describedBy(work)).toContain(point);
    for (const point of copy.personal.points) expect(describedBy(personal)).toContain(point);
    expect(host!.querySelectorAll('input:not([type="radio"])')).toHaveLength(1);
    expect(controlFor(host!, copy.work.label).placeholder).toBe(EXAMPLE_WORK_EMAIL);
    expect(buttonTexts()).toEqual([copy.work.action]);

    await type(copy.work.label, "ada@example.org");
    await chooseCard(host!, copy.personal.title);
    expect(personal.checked).toBe(true);
    expect(controlFor(host!, copy.personal.label).value).toBe("ada@example.org");
    expect(buttonTexts()).toEqual([copy.personal.action]);
    expect(host!.textContent).not.toMatch(/sponsor/i);
    expect(host!.textContent).not.toContain(EMAIL_FIRST_ADVISORY_COPY.enterWork);
  });

  it("steers a consumer mailbox on the work card, then continues it as a personal email", async () => {
    const sent: unknown[] = [];
    await mount("registration", async (step) => serverScreen(step, sent));
    await type(copy.work.label, "Ada@Gmail.com");
    await click(copy.work.action);
    expect(sent).toHaveLength(0);
    // The server's steer is advice, not a red error, but it still holds the step: continuing is not offered.
    const field = controlFor(host!, copy.work.label).closest(".pk-field")!;
    await vi.waitFor(() => expect(field.textContent).toContain(WORK_EMAIL_STEER));
    expect(host!.textContent).not.toContain("Invalid request");
    expect(field.classList.contains("pk-field--advisory")).toBe(true);
    expect(buttonTexts()).toEqual([EMAIL_FIRST_ADVISORY_COPY.enterWork, EMAIL_FIRST_ADVISORY_COPY.usePersonal]);

    await click(EMAIL_FIRST_ADVISORY_COPY.enterWork);
    expect(controlFor(host!, copy.work.label).value).toBe("");
    expect(document.activeElement).toBe(controlFor(host!, copy.work.label));
    expect(host!.textContent).not.toContain(WORK_EMAIL_STEER);
    await type(copy.work.label, "Ada@Gmail.com");
    await click(copy.work.action);
    await vi.waitFor(() => expect(host!.textContent).toContain(WORK_EMAIL_STEER));

    await click(EMAIL_FIRST_ADVISORY_COPY.usePersonal);
    expect(radioNamed(host!, copy.personal.title).checked).toBe(true);
    expect(controlFor(host!, copy.personal.label).value).toBe("Ada@Gmail.com");
    expect(host!.textContent).not.toContain(WORK_EMAIL_STEER);
    await click(copy.personal.action);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(workEmailStepSchema.parse(sent[0])).toEqual({ email: "ada@gmail.com", unaffiliatedAttestation: true });
    await vi.waitFor(() => expect(host!.textContent).toContain(copy.sent("ada@gmail.com")));
    await click(copy.changeEmail);
    expect(controlFor(host!, copy.personal.label).value).toBe("Ada@Gmail.com");
  });

  it("offers an address the server reads as an organization's back to the work card", async () => {
    const looked = serveDomainLookups();
    const sent: unknown[] = [];
    await mount("registration", async (step) => serverScreen(step, sent));
    await chooseCard(host!, copy.personal.title);
    await type(copy.personal.label, "ada@gmail.com");
    await leave(copy.personal.label);
    await vi.waitFor(() => expect(looked).toEqual(["gmail.com"]));
    expect(host!.textContent).not.toContain(EMAIL_FIRST_ADVISORY_COPY.looksWork);

    await type(copy.personal.label, "ada@pkic.example");
    // Typing alone asks nothing: only an address the reader has finished is classified.
    expect(looked).toEqual(["gmail.com"]);
    await leave(copy.personal.label);
    const field = controlFor(host!, copy.personal.label).closest(".pk-field")!;
    await vi.waitFor(() => expect(field.textContent).toContain(EMAIL_FIRST_ADVISORY_COPY.looksWork));
    expect(field.classList.contains("pk-field--advisory")).toBe(true);
    expect(controlFor(host!, copy.personal.label).getAttribute("aria-invalid")).toBeNull();

    await click(EMAIL_FIRST_ADVISORY_COPY.useAsWork);
    expect(radioNamed(host!, copy.work.title).checked).toBe(true);
    expect(controlFor(host!, copy.work.label).value).toBe("ada@pkic.example");
    expect(host!.textContent).not.toContain(EMAIL_FIRST_ADVISORY_COPY.looksWork);
    await click(copy.work.action);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(workEmailStepSchema.parse(sent[0])).toEqual({ email: "ada@pkic.example", unaffiliatedAttestation: false });
  });

  it.each(["registration", "proposal", "speaker", "join"] as const)(
    "says what the %s personal path costs inside its card before it is chosen",
    async (flow) => {
      await mount(flow);
      const flowCopy = EMAIL_FIRST_COPY[flow];
      const personal = radioNamed(host!, flowCopy.personal.title);
      expect(personal.checked).toBe(false);
      const card = personal.closest("label")!;
      for (const point of flowCopy.personal.points) expect(card.textContent).toContain(point);
      if (flow === "proposal" || flow === "speaker") expect(card.textContent).toMatch(/independence disclosure/);
      // An independent's own domain may be a company's, so the personal card never claims it.
      expect(card.textContent).not.toMatch(/own domain/i);
      expect(host!.textContent).not.toMatch(/sponsor/i);
    },
  );

  it("refuses a disposable address on either card and continues a work address on behalf of the organization", async () => {
    const sent: unknown[] = [];
    await mount("proposal", async (step) => serverScreen(step, sent));
    const proposal = EMAIL_FIRST_COPY.proposal;
    await chooseCard(host!, proposal.personal.title);
    await type(proposal.personal.label, "ada@mailinator.com");
    await click(proposal.personal.action);
    expect(sent).toHaveLength(0);
    await vi.waitFor(() => expect(host!.textContent).toContain(DISPOSABLE_EMAIL_REFUSED));

    await chooseCard(host!, proposal.work.title);
    await click(proposal.work.action);
    await vi.waitFor(() => expect(host!.textContent).toContain(DISPOSABLE_EMAIL_REFUSED));
    expect(controlFor(host!, proposal.work.label).getAttribute("aria-invalid")).toBe("true");

    await type(proposal.work.label, "ada@official.example");
    await act(async () => {
      controlFor(host!, proposal.work.label).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(workEmailStepSchema.parse(sent[0])).toEqual({
      email: "ada@official.example",
      unaffiliatedAttestation: false,
    });
  });

  it("reads a server refusal back onto the email field", async () => {
    await mount("join", async () => {
      throw new ApiClientError(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request",
            details: { fieldErrors: { email: ["This address cannot be used."] } },
          },
        },
        400,
      );
    });
    const join = EMAIL_FIRST_COPY.join;
    await type(join.work.label, "ada@official.example");
    await click(join.work.action);
    await vi.waitFor(() =>
      expect(controlFor(host!, join.work.label).closest(".pk-field")!.textContent).toContain(
        "This address cannot be used.",
      ),
    );
    expect(controlFor(host!, join.work.label).getAttribute("aria-invalid")).toBe("true");
  });

  it("sends once when the action is activated twice before the page updates", async () => {
    const sent: unknown[] = [];
    await mount("join", async (step) => {
      sent.push(step);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const join = EMAIL_FIRST_COPY.join;
    await type(join.work.label, "ada@official.example");
    await act(async () => {
      const button = [...host!.querySelectorAll("button")].find(
        (candidate) => candidate.textContent === join.work.action,
      );
      button!.click();
      button!.click();
    });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });

  it("has no automatically detectable accessibility defects on either card", async () => {
    await mount("speaker");
    const check = async () => {
      const results = await axe.run(host!, { rules: { "color-contrast": { enabled: false } } });
      return results.violations.map((violation) => `${violation.id}: ${violation.help}`);
    };
    expect(await check()).toEqual([]);
    await chooseCard(host!, EMAIL_FIRST_COPY.speaker.personal.title);
    expect(await check()).toEqual([]);
  });
});
