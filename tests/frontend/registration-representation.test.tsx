// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import {
  identityProfileUpdateSchema,
  ownIdentityProfileSchema,
} from "../../assets/shared/schemas/own-identity-profile";
import { typeInto, controlFor } from "./helpers/labeled-control";
import { registrationManageSchema } from "../../assets/shared/schemas/registration";
import { readResponse, PERSONAL, WORK } from "./helpers/participant-registration-fixtures";
import { installApi, mount, click, button, facts, settle } from "./helpers/participant-registration-harness";

describe("registration representation editing", () => {
  it("saves the representation and details in one registration update", async () => {
    const requests = installApi(readResponse({ identityId: PERSONAL.id }), { identities: [PERSONAL, WORK] });
    const container = await mount();

    // The read view states the representation; changing it is part of editing, not a separate command.
    expect(container.querySelector('button[aria-label="Change representation"]')).toBeNull();
    await click(button(container, "Edit details"));
    // The address follows the representation, so it is read here, never typed.
    expect(container.querySelector('input[name="email"]')).toBeNull();
    expect(facts(container)["Current email address"]).toBe("ada@example.test");

    await vi.waitFor(() => expect(container.querySelector('[role="combobox"]')).not.toBeNull());
    await click(container.querySelector<HTMLElement>('[role="combobox"]'));
    await vi.waitFor(() => expect(document.querySelector(`[role="option"][data-key="${WORK.id}"]`)).not.toBeNull());
    await click(document.querySelector<HTMLElement>(`[role="option"][data-key="${WORK.id}"]`));
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    await settle();

    const writes = requests.filter(({ method }) => method === "PUT" || method === "PATCH");
    expect(writes.map(({ method }) => method)).toEqual(["PATCH"]);
    expect(registrationManageSchema.parse(writes[0]!.body)).toMatchObject({
      action: "update",
      identityChange: { identityId: WORK.id, expectedIdentityId: PERSONAL.id },
    });
    expect(registrationManageSchema.parse(writes[0]!.body)).not.toHaveProperty("email");
    await vi.waitFor(() => expect(container.textContent).toContain("Registration updated."));
  });

  it("lets the owner replace an ended identity even when the recipient differs from the account", async () => {
    const read = readResponse({ identityId: WORK.id });
    read.user.email = "ada@analytical.example";
    const requests = installApi(read, { identities: [PERSONAL] });
    const container = await mount();
    await click(button(container, "Edit details"));
    await vi.waitFor(() => expect(container.querySelector('[role="combobox"]')).not.toBeNull());
    await click(container.querySelector<HTMLElement>('[role="combobox"]'));
    await vi.waitFor(() => expect(document.querySelector(`[role="option"][data-key="${PERSONAL.id}"]`)).not.toBeNull());
    await click(document.querySelector<HTMLElement>(`[role="option"][data-key="${PERSONAL.id}"]`));
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(1));
    expect(
      registrationManageSchema.parse(requests.find(({ method }) => method === "PATCH")!.body).identityChange,
    ).toEqual({ identityId: PERSONAL.id, expectedIdentityId: WORK.id });
  });

  it("keeps a refused combined save in the editor and makes no separate identity request", async () => {
    const requests = installApi(readResponse({ identityId: PERSONAL.id }), {
      identities: [PERSONAL, WORK],
      refusePatch: { error: { code: "REGISTRATION_CHANGED", message: "Reload your registration" } },
    });
    const container = await mount();
    await click(button(container, "Edit details"));
    await vi.waitFor(() => expect(container.querySelector('[role="combobox"]')).not.toBeNull());
    await click(container.querySelector<HTMLElement>('[role="combobox"]'));
    await vi.waitFor(() => expect(document.querySelector(`[role="option"][data-key="${WORK.id}"]`)).not.toBeNull());
    await click(document.querySelector<HTMLElement>(`[role="option"][data-key="${WORK.id}"]`));
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(1));
    expect(requests.some(({ method }) => method === "PUT")).toBe(false);
    expect(container.querySelector("form")).not.toBeNull();
    expect(
      registrationManageSchema.parse(requests.find(({ method }) => method === "PATCH")!.body).identityChange,
    ).toEqual({ identityId: WORK.id, expectedIdentityId: PERSONAL.id });
  });

  it("shows representation read-only when the server does not grant ownership", async () => {
    installApi(readResponse({ identityId: WORK.id, canChangeIdentity: false }), { identities: [PERSONAL, WORK] });
    const container = await mount();
    await click(button(container, "Edit details"));
    expect(container.querySelector('[role="combobox"]')).toBeNull();
    expect(container.querySelector('input[name="email"]')).toBeNull();
    await vi.waitFor(() => expect(container.querySelector('a[href="/portal/"]')).not.toBeNull());
  });

  it.each(["Discard", "Back", 503, 403, 500] as const)(
    "refreshes saved identity profile edits independently of closing with %s",
    async (exit) => {
      const work = { ...WORK };
      const read = readResponse({ identityId: work.id });
      const requests = installApi(read, { identities: [work] });
      const api = globalThis.fetch;
      let profileSaved = false;
      let refuseRefresh = typeof exit === "number";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
          const path = String(input);
          if (profileSaved && refuseRefresh && path.endsWith(read.registration.id)) {
            return Response.json(
              { error: { code: "TEMPORARY_UNAVAILABLE", message: "Registration refresh is unavailable." } },
              { status: typeof exit === "number" ? exit : 503 },
            );
          }
          if (!path.endsWith(`/identities/${work.id}/profile`)) return api(input, init);
          if (init.method === "PATCH") {
            const body = identityProfileUpdateSchema.parse(JSON.parse(String(init.body)));
            work.jobTitle = body.jobTitle ?? work.jobTitle;
            read.user.job_title = work.jobTitle;
            profileSaved = true;
          }
          return Response.json(
            ownIdentityProfileSchema.parse({
              identityId: work.id,
              organizationId: work.organizationId,
              organizationName: work.organizationName,
              jobTitle: work.jobTitle,
              biography: null,
              links: [],
            }),
          );
        }),
      );
      const container = await mount();
      await click(button(container, "Edit details"));
      await typeInto(container.querySelector<HTMLInputElement>('input[name="firstName"]')!, "Draft name");
      await vi.waitFor(() =>
        expect(container.querySelector('button[aria-label="Edit representation"]')).not.toBeNull(),
      );
      const readsBefore = requests.filter((r) => r.method === "GET" && r.path.endsWith(read.registration.id)).length;
      await click(container.querySelector('button[aria-label="Edit representation"]'));
      await settle();
      await typeInto(controlFor<HTMLInputElement>(document.body, "Job title for this organization"), "Coordinator");
      await click(button(document.querySelector("dialog[open]")!, "Save changes"));
      await vi.waitFor(() => expect(document.querySelector("dialog[open]")).toBeNull());
      expect(container.querySelector<HTMLInputElement>('input[name="firstName"]')!.value).toBe("Draft name");
      if (typeof exit === "number") {
        await vi.waitFor(() => expect(button(container, "Retry refresh")).not.toBeNull());
        await act(() => history.back());
        await vi.waitFor(() => expect(button(container, "Edit details")).not.toBeNull());
        await act(() => history.forward());
        await vi.waitFor(() => expect(button(container, "Retry refresh")).not.toBeNull());
        expect(container.querySelector<HTMLInputElement>('input[name="firstName"]')!.value).toBe("Draft name");
        expect(container.querySelector('[role="alert"]')?.textContent).toContain("Your profile changes were saved");
        refuseRefresh = false;
        await click(button(container, "Retry refresh"));
        await act(() => history.back());
      } else {
        await vi.waitFor(() =>
          expect(
            requests.filter((r) => r.method === "GET" && r.path.endsWith(read.registration.id)).length,
          ).toBeGreaterThan(readsBefore),
        );
        if (exit === "Back") await act(() => history.back());
        else await click(button(container, "Discard changes"));
      }
      await vi.waitFor(() => expect(button(container, "Edit details")).not.toBeNull());
      await vi.waitFor(() => expect(facts(container).Representation).toContain("Coordinator"));
      expect(button(container, "Retry registration")).toBeNull();
      expect(requests.some((r) => r.method === "PATCH")).toBe(false);
    },
  );

  it("offers retry after a transient owner-session load failure without asking the owner to sign in", async () => {
    installApi(readResponse({ identityId: WORK.id }), { identities: [WORK] });
    const api = globalThis.fetch;
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/auth/session") && fail)
          return Response.json(
            { error: { code: "TEMPORARY_UNAVAILABLE", message: "Temporary outage" } },
            { status: 503 },
          );
        return api(input, init);
      }),
    );
    const container = await mount();
    await click(button(container, "Edit details"));
    await vi.waitFor(() => expect(button(container, "Retry")).not.toBeNull());
    expect(container.querySelector('a[href="/portal/"]')).toBeNull();
    fail = false;
    await click(button(container, "Retry"));
    await vi.waitFor(() => expect(container.querySelector('[role="combobox"]')).not.toBeNull());
    expect(button(container, "Retry")).toBeNull();
  });

  it("offers sign-in when the owner session has expired or been revoked", async () => {
    installApi(readResponse({ identityId: WORK.id }), { identities: [WORK] });
    const api = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/auth/session"))
          return Response.json({ error: { code: "AUTH_REQUIRED", message: "Sign in again." } }, { status: 401 });
        return api(input, init);
      }),
    );
    const container = await mount();
    await click(button(container, "Edit details"));
    await vi.waitFor(() => expect(container.querySelector('a[href="/portal/"]')).not.toBeNull());
    expect(button(container, "Retry")).toBeNull();
    expect(container.querySelector('[role="combobox"]')).toBeNull();
  });

  it("keeps the representation when it is unchanged", async () => {
    const requests = installApi(readResponse({ identityId: PERSONAL.id }), { identities: [PERSONAL, WORK] });
    const container = await mount();

    await click(button(container, "Edit details"));
    await vi.waitFor(() => expect(container.querySelector('[role="combobox"]')).not.toBeNull());
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    await settle();

    expect(requests.some(({ method }) => method === "PUT")).toBe(false);
    expect(requests.some(({ method }) => method === "PATCH")).toBe(true);
  });
});
