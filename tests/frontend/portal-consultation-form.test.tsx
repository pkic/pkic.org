// @vitest-environment jsdom
/**
 * A consultation is answered by filling in its form, through the same
 * `FormSubmissionForm` every other form uses.
 *
 * What is worth asserting here is not the field renderer — that has its own
 * suite — but the two things this wrapper owns: that a question is labelled
 * by a real `for`/`id` pair, and that a rejected response is announced *and*
 * keeps what the person typed instead of clearing the form under them.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consultationFormSchema } from "../../assets/shared/schemas/votes";
import { ConsultationResponseForm } from "../../assets/ts/member-flows/portal/sections/Votes/ConsultationForm";
import { buttonNamed, controlFor, typeInto } from "./helpers/labelled-control";

const mounted: HTMLElement[] = [];

const form = consultationFormSchema.parse({
  id: "40000000-0000-4000-8000-000000000001",
  title: "Charter consultation",
  description: "Tell the council what you think of the revised charter.",
  fields: [
    {
      id: "50000000-0000-4000-8000-000000000001",
      key: "comment",
      label: "Your comment",
      fieldType: "text",
      required: true,
      options: null,
      optionSource: null,
      validation: null,
      sortOrder: 0,
      updatedAt: "2026-08-01T00:00:00.000Z",
      archivedAt: null,
    },
  ],
});

function mount(node: Parameters<typeof render>[0]): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("consultation response form", () => {
  it("labels every question through a for/id pair and says a response can still be changed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const container = mount(
      <ConsultationResponseForm
        form={form}
        hasResponded
        endpoint="/api/v1/votes/charter/consultation"
        onResponded={vi.fn(async () => {})}
      />,
    );

    // Resolved through the label's `for` and the control's `id`, so the lookup
    // fails exactly when the labelling contract is broken.
    expect(controlFor(container, "Your comment").tagName).toBe("INPUT");
    expect(container.textContent).toContain("You may change your response until the consultation closes.");
    expect(container.textContent).toContain("Tell the council what you think of the revised charter.");
  });

  it("posts the answers, with the member the response is cast for", async () => {
    const requests: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const onResponded = vi.fn(async () => {});

    const container = mount(
      <ConsultationResponseForm
        form={form}
        memberId="60000000-0000-4000-8000-000000000001"
        endpoint="/api/v1/votes/charter/consultation"
        onResponded={onResponded}
      />,
    );
    await typeInto(controlFor(container, "Your comment"), "Looks good to me");
    await act(async () => {
      buttonNamed(container, "Submit response").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(requests[0]?.url).toBe("/api/v1/votes/charter/consultation");
    expect(requests[0]?.body).toMatchObject({
      answers: { comment: "Looks good to me" },
      memberId: "60000000-0000-4000-8000-000000000001",
    });
    expect(onResponded).toHaveBeenCalledTimes(1);
  });

  it("announces a rejected response and keeps what was typed on screen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "CONFLICT", message: "The consultation has closed." } }), {
            status: 409,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const onResponded = vi.fn(async () => {});

    const container = mount(
      <ConsultationResponseForm form={form} endpoint="/api/v1/votes/charter/consultation" onResponded={onResponded} />,
    );
    await typeInto(controlFor(container, "Your comment"), "Looks good to me");
    await act(async () => {
      buttonNamed(container, "Submit response").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("The consultation has closed.");
    // Retyping the whole answer is the thing the rethrow exists to prevent.
    expect(controlFor<HTMLInputElement>(container, "Your comment").value).toBe("Looks good to me");
    expect(onResponded).not.toHaveBeenCalled();
  });

  it("turns a bare transport failure into a sentence rather than showing the status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );

    const container = mount(
      <ConsultationResponseForm
        form={form}
        endpoint="/api/v1/votes/charter/consultation"
        onResponded={vi.fn(async () => {})}
      />,
    );
    await typeInto(controlFor(container, "Your comment"), "Looks good to me");
    await act(async () => {
      buttonNamed(container, "Submit response").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("The service is temporarily unavailable.");
    expect(alert?.textContent).not.toContain("HTTP 503");
  });
});
