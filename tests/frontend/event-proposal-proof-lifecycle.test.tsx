// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventProposalIdentityStep } from "../../assets/ts/components/EventProposalIdentityStep";
import {
  eventProposalProofVerifySchema,
  eventProposalProofVerifyResponseSchema,
} from "../../assets/shared/schemas/event-proposal-proof";
import type { ProposalEntrySelection } from "../../assets/ts/components/useProposalEntryIdentity";

let host: HTMLDivElement | undefined;
let selection: ProposalEntrySelection | null = null;
function mount(enabled: boolean) {
  if (!host) {
    host = document.createElement("div");
    document.body.append(host);
  }
  return act(() => {
    render(
      <EventProposalIdentityStep
        enabled={enabled}
        eventSlug="proof-lifecycle"
        consents={() => []}
        onChange={(value) => {
          selection = value;
        }}
      />,
      host!,
    );
  });
}
function ready(email: string, continuationToken = "c".repeat(40)): Response {
  const body = eventProposalProofVerifyResponseSchema.parse({
    status: "ready",
    continuationToken,
    applicantKind: "organization",
    email,
    person: null,
    organization: null,
  });
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
function deferred() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function followProof(token: string): Promise<void> {
  await act(async () => {
    const changed = new Promise<void>((resolve) =>
      window.addEventListener("hashchange", () => resolve(), { once: true }),
    );
    location.hash = `verify=${token}`;
    await changed;
  });
}
afterEach(() => {
  if (host) render(null, host);
  document.body.innerHTML = "";
  host = undefined;
  selection = null;
  history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

describe("proposal mailbox proof lifecycle", () => {
  it("consumes a current hash only after terms activation and removes its listener on disable or unmount", async () => {
    const tokens: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const proof = eventProposalProofVerifySchema.parse(JSON.parse(init.body));
        tokens.push(proof.token);
        return ready("verified@example.test");
      }),
    );
    await mount(false);
    await followProof("a".repeat(40));
    expect(tokens).toEqual([]);
    await mount(true);
    await vi.waitFor(() => expect(selection?.person.email).toBe("verified@example.test"));
    expect(tokens).toEqual(["a".repeat(40)]);
    await mount(false);
    await followProof("b".repeat(40));
    expect(tokens).toHaveLength(1);
    await mount(true);
    await vi.waitFor(() => expect(tokens).toHaveLength(2));
    await vi.waitFor(() => expect(selection?.person.email).toBe("verified@example.test"));
    await act(() => {
      render(null, host!);
    });
    await followProof("d".repeat(40));
    expect(tokens).toEqual(["a".repeat(40), "b".repeat(40)]);
  });

  it("keeps the newer proof when an earlier proof or initial session resolves afterward", async () => {
    const session = deferred();
    const earlier = deferred();
    const latest = deferred();
    vi.stubGlobal(
      "fetch",
      vi.fn((url, init) => {
        if (String(url) === "/api/v1/auth/session") return session.promise;
        const proof = eventProposalProofVerifySchema.parse(JSON.parse(init.body));
        return proof.token === "a".repeat(40) ? earlier.promise : latest.promise;
      }),
    );
    await mount(true);
    await followProof("a".repeat(40));
    await followProof("b".repeat(40));
    await act(async () => {
      latest.resolve(ready("latest@example.test", "l".repeat(40)));
      await latest.promise;
    });
    await vi.waitFor(() => expect(selection?.person.email).toBe("latest@example.test"));
    await act(async () => {
      earlier.resolve(ready("earlier@example.test"));
      session.reject(new Error("Obsolete session failure"));
      await Promise.allSettled([earlier.promise, session.promise]);
    });
    expect(selection?.continuationToken).toBe("l".repeat(40));
    expect(host!.textContent).toContain("latest@example.test");
    expect(host!.textContent).not.toContain("earlier@example.test");
    expect(host!.textContent).not.toContain("could not load your saved profile");
  });

  it("ignores an obsolete proof refusal and a response that arrives after terms are disabled", async () => {
    const earlier = deferred();
    const latest = deferred();
    const disabled = deferred();
    history.replaceState({}, "", `/#verify=${"a".repeat(40)}`);
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        const proof = eventProposalProofVerifySchema.parse(JSON.parse(init.body));
        return proof.token === "a".repeat(40)
          ? earlier.promise
          : proof.token === "b".repeat(40)
            ? latest.promise
            : disabled.promise;
      }),
    );
    await mount(true);
    await followProof("b".repeat(40));
    await act(async () => {
      latest.resolve(ready("latest@example.test"));
      await latest.promise;
    });
    await vi.waitFor(() => expect(selection?.person.email).toBe("latest@example.test"));
    await act(async () => {
      earlier.reject(new Error("Obsolete proof refusal"));
      await Promise.allSettled([earlier.promise]);
    });
    expect(host!.textContent).not.toContain("Obsolete proof refusal");
    await followProof("d".repeat(40));
    await mount(false);
    await act(async () => {
      disabled.resolve(ready("disabled@example.test"));
      await disabled.promise;
    });
    expect(selection).toBeNull();
    expect(host!.textContent).toBe("");
  });
});
