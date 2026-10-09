// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationDetail } from "../../assets/shared/schemas/organization-management";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { confirmationButton } from "./helpers/confirm-dialog";
import { OrganizationLogo } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationLogo";

let container: HTMLDivElement | null = null;
let toastArea: HTMLDivElement | null = null;

function organization(logoUrl: string | null): OrganizationDetail {
  return { id: "org-1", name: "Example Corp", logoUrl } as unknown as OrganizationDetail;
}

function mount(node: preact.VNode): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  toastArea = document.createElement("div");
  toastArea.id = "portal-toast-area";
  document.body.append(toastArea);
});

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  toastArea?.remove();
  toastArea = null;
  vi.unstubAllGlobals();
});

describe("OrganizationLogo", () => {
  it("shows the logo to a viewer, named for anyone who cannot see it, with nothing to press", () => {
    const root = mount(
      <OrganizationLogo
        organization={organization("/logo.svg")}
        canWrite={false}
        onChanged={() => Promise.resolve()}
      />,
    );

    const image = root.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/logo.svg");
    expect(image?.getAttribute("alt")).toBe("Example Corp logo");
    expect(root.querySelector("button")).toBeNull();
    expect(root.querySelector('input[type="file"]')).toBeNull();
  });

  it("stands the name's initials in for a missing logo, the way an avatar does", () => {
    const root = mount(
      <OrganizationLogo organization={organization(null)} canWrite={false} onChanged={() => Promise.resolve()} />,
    );

    const tile = root.querySelector('[role="img"]');
    expect(tile?.getAttribute("aria-label")).toBe("Example Corp has no logo");
    expect(tile?.textContent).toBe("EC");
  });

  it("makes the tile itself the control for an editor: pressing it chooses a file", () => {
    const root = mount(
      <OrganizationLogo organization={organization(null)} canWrite onChanged={() => Promise.resolve()} />,
    );

    // No panel header and no separate button: the tile is named for what
    // pressing it does, and the file rule reaches it through describedby.
    const control = root.querySelector<HTMLButtonElement>("button");
    expect(control?.getAttribute("aria-label")).toBe("Upload logo of Example Corp");
    expect(root.querySelector(`#${control!.getAttribute("aria-describedby")!}`)?.textContent).toContain("SVG only.");
    const input = root.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.getAttribute("accept")).toBe("image/svg+xml");
    const opened = vi.spyOn(input!, "click");
    void act(() => control!.click());
    expect(opened).toHaveBeenCalled();
    for (const element of root.querySelectorAll<HTMLElement>("[class]")) {
      for (const name of element.classList) {
        expect(name === "pk" || name.startsWith("pk-")).toBe(true);
      }
    }
  });

  it("offers changing and removing over the one picture", () => {
    const root = mount(
      <OrganizationLogo organization={organization("/logo.svg")} canWrite onChanged={() => Promise.resolve()} />,
    );

    expect(root.querySelector("button")?.getAttribute("aria-label")).toBe("Change logo of Example Corp");
    expect(root.querySelector("img")?.getAttribute("alt")).toBe("Example Corp logo");
    expect([...root.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"))).toContain(
      "Remove logo of Example Corp",
    );
  });

  it("reports an upload failure to the reader instead of silently keeping the old logo", async () => {
    const changed = vi.fn(() => Promise.resolve());
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "invalid_image", message: "That file is not an SVG." } }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );

    const root = mount(<OrganizationLogo organization={organization(null)} canWrite onChanged={changed} />);
    const input = root.querySelector<HTMLInputElement>("input[type=file]");
    if (!input) throw new Error("no file input");

    const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await settle();

    const toast = document.querySelector(".my-toast");
    expect(toast?.textContent).toContain("That file is not an SVG.");
    expect(changed).not.toHaveBeenCalled();
  });

  it("uploads the chosen SVG to the organization's own logo route and reports the change", async () => {
    const requests: Array<{ method: string; path: string; type: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push({
          method: init?.method ?? "GET",
          path: url.pathname,
          type: new Headers(init?.headers).get("content-type"),
        });
        return new Response(JSON.stringify({ success: true, r2Key: "logos/org-1.svg", logoUrl: "/logo.svg" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const changed = vi.fn(() => Promise.resolve());
    const root = mount(<OrganizationLogo organization={organization(null)} canWrite onChanged={changed} />);
    const input = root.querySelector<HTMLInputElement>("input[type=file]")!;

    Object.defineProperty(input, "files", {
      value: [new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" })],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await settle();

    expect(requests).toEqual([{ method: "PUT", path: "/api/v1/organizations/org-1/logo", type: "image/svg+xml" }]);
    expect(document.querySelector(".my-toast")?.textContent).toContain("Logo uploaded");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("removes the logo only after the confirmation is accepted", async () => {
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        methods.push(init?.method ?? "GET");
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const changed = vi.fn(() => Promise.resolve());
    const root = mount(
      <>
        <ConfirmDialogHost />
        <OrganizationLogo organization={organization("/logo.svg")} canWrite onChanged={changed} />
      </>,
    );
    const remove = root.querySelector<HTMLButtonElement>('button[aria-label="Remove logo of Example Corp"]')!;

    await act(async () => remove.click());
    await act(async () => confirmationButton("Cancel", root)?.click());
    await settle();
    expect(methods).toEqual([]);

    await act(async () => remove.click());
    await act(async () => confirmationButton("Remove logo", root)?.click());
    await settle();
    expect(methods).toEqual(["DELETE"]);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
