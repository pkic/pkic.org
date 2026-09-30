// @vitest-environment jsdom
import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { Badge } from "../../assets/ts/components/Badge";
import { ProposalTypeIcon } from "../../assets/ts/components/proposals/ProposalTypeIcon";
import { PROPOSAL_STATUSES } from "../../assets/shared/schemas/proposal-status";

function element(markup: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = markup;
  return root;
}

describe("shared symbolic badges", () => {
  it.each(PROPOSAL_STATUSES)("names the %s icon for assistive technology and hover", (status) => {
    const root = element(render(<Badge status={status} iconOnly />));
    const icon = root.querySelector('[role="img"]');
    expect(icon?.getAttribute("aria-label")).toBeTruthy();
    expect(icon?.getAttribute("title")).toBe(icon?.getAttribute("aria-label"));
    expect(icon?.querySelector("svg")).not.toBeNull();
    expect(icon?.querySelector("svg")?.getAttribute("fill")).toBe("none");
    expect(icon?.querySelector("svg")?.getAttribute("stroke-width")).toBe("1.6");
    expect(icon?.textContent).toBe("");
  });

  it("distinguishes submitted, resubmitted and accepted by shape as well as tone", () => {
    const submitted = element(render(<Badge status="submitted" iconOnly />));
    const resubmitted = element(render(<Badge status="resubmitted" iconOnly />));
    const accepted = element(render(<Badge status="accepted" iconOnly />));
    expect(submitted.querySelector(".pk-badge--ok")).not.toBeNull();
    expect(resubmitted.querySelector(".pk-badge--warn")).not.toBeNull();
    expect(submitted.querySelector("svg")?.innerHTML).not.toBe(resubmitted.querySelector("svg")?.innerHTML);
    expect(submitted.querySelector("svg")?.innerHTML).not.toBe(accepted.querySelector("svg")?.innerHTML);
  });

  it("keeps a recommendation count visible and includes it in its accessible name", () => {
    const icon = element(render(<Badge status="accept" iconOnly count={3} />)).querySelector('[role="img"]');
    expect(icon?.getAttribute("aria-label")).toBe("Accept 3");
    expect(icon?.textContent).toBe("3");
  });

  it.each(["talk", "panel", "workshop", "Organization case study"])(
    "retains the exact event-defined type %s",
    (type) => {
      const icon = element(render(<ProposalTypeIcon type={type} />)).querySelector('[role="img"]');
      expect(icon?.getAttribute("aria-label")).toBe(type);
      expect(icon?.getAttribute("title")).toBe(type);
      expect(icon?.querySelector("svg")).not.toBeNull();
      expect(icon?.textContent).toBe("");
    },
  );
});
