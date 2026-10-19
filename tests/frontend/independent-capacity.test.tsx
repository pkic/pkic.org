// @vitest-environment jsdom
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IndependentCapacityDisclosure,
  completedIndependentCapacity,
  type IndependentCapacityDraft,
} from "../../assets/ts/components/IndependentCapacityDisclosure";
import {
  IndependentCapacityBadge,
  IndependentCapacityDetails,
  independentCapacityActions,
} from "../../assets/ts/components/proposals/IndependentCapacityReview";
import { INDEPENDENT_CAPACITY_COPY, INDEPENDENT_CAPACITY_REVIEW_COPY } from "../../assets/shared/email-first-copy";
import { independentCapacityDisclosureSchema } from "../../assets/shared/schemas/independent-capacity";
import { controlFor } from "./helpers/labeled-control";

let host: HTMLDivElement | undefined;
let latest: IndependentCapacityDraft = {};

function Harness({ onUseWorkEmail }: { onUseWorkEmail: () => void }) {
  const [draft, setDraft] = useState<IndependentCapacityDraft>({});
  latest = draft;
  return <IndependentCapacityDisclosure draft={draft} onChange={setDraft} onUseWorkEmail={onUseWorkEmail} />;
}

async function mount(node: preact.ComponentChild) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(node, host!));
}
async function input(label: string, value: string) {
  await act(() => {
    const control = controlFor<HTMLInputElement | HTMLTextAreaElement>(host!, label);
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function check(label: string) {
  await act(() => {
    const control = controlFor(host!, label);
    control.checked = true;
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  if (host) render(null, host);
  document.body.innerHTML = "";
  host = undefined;
  latest = {};
});

describe("independence disclosure step", () => {
  const copy = INDEPENDENT_CAPACITY_COPY;

  it("stops the individual path for someone connected to an organization and steers to the work address", async () => {
    const useWork = vi.fn();
    await mount(<Harness onUseWorkEmail={useWork} />);
    await check(copy.yes);
    expect(host!.textContent).toContain(copy.connectedSteer);
    expect(completedIndependentCapacity(latest)).toBeNull();
    await act(() => {
      [...host!.querySelectorAll("button")].find((button) => button.textContent === copy.useWorkEmail)!.click();
    });
    expect(useWork).toHaveBeenCalledOnce();
  });

  it("completes only with every attestation, producing the shared contract's disclosure", async () => {
    await mount(<Harness onUseWorkEmail={() => {}} />);
    await check(copy.no);
    await input(copy.formerAffiliationsLabel, "Example Labs");
    await input(copy.currentPositionLabel, "Retired");
    await check(copy.noRelatedEngagement);
    await check(copy.accountability);
    expect(completedIndependentCapacity(latest)).toBeNull();
    const policy = [...host!.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(policy).toEqual([copy.iprPolicyHref, copy.codeOfConductHref]);
    await act(() => {
      const control = host!.querySelector<HTMLInputElement>('input[name="acknowledgesPolicies"]')!;
      control.checked = true;
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const completed = completedIndependentCapacity(latest);
    expect(independentCapacityDisclosureSchema.parse(completed)).toMatchObject({
      organizationConnection: "no",
      formerAffiliations: "Example Labs",
      currentPosition: "Retired",
    });
  });
});

describe("reviewer flag", () => {
  const review = {
    id: "disclosure-1",
    version: "v",
    formerAffiliations: "Example Labs",
    currentPosition: "Independent consultant",
    emailDomainKind: "personal" as const,
    attestedAt: "2026-10-01T10:00:00.000Z",
    status: "pending" as const,
    reviewedAt: null,
    reviewedByName: null,
  };

  it("flags an unverified independent speaker with what they disclosed", async () => {
    await mount(
      <>
        <IndependentCapacityBadge status={review.status} />
        <IndependentCapacityDetails review={review} />
      </>,
    );
    expect(host!.textContent).toContain(INDEPENDENT_CAPACITY_REVIEW_COPY.status.pending);
    expect(host!.textContent).toContain(INDEPENDENT_CAPACITY_REVIEW_COPY.emailKind.personal);
    expect(host!.textContent).toContain("Example Labs");
  });

  it("offers only the decisions not yet taken", () => {
    const labels = (status: "pending" | "verified" | "representation_requested") =>
      independentCapacityActions(
        { ...review, status },
        "/review",
        () => {},
        () => {},
      ).map((item) => item.label);
    expect(labels("pending")).toEqual([
      INDEPENDENT_CAPACITY_REVIEW_COPY.verify,
      INDEPENDENT_CAPACITY_REVIEW_COPY.requestRepresentation,
    ]);
    expect(labels("verified")).toEqual([INDEPENDENT_CAPACITY_REVIEW_COPY.requestRepresentation]);
    expect(
      independentCapacityActions(
        null,
        "/review",
        () => {},
        () => {},
      ),
    ).toEqual([]);
  });
});
