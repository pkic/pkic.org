// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationDetail } from "../../assets/shared/schemas/organization-management";
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
  it("names the picture for anyone who cannot see it", () => {
    const root = mount(
      <OrganizationLogo
        organization={organization("/logo.svg")}
        canWrite={false}
        onChanged={() => Promise.resolve()}
      />,
    );

    const image = root.querySelector("img");
    expect(image?.getAttribute("alt")).toBe("Example Corp logo");
    // The base layer keeps the picture inside its column, so the surface no
    // longer paints a frame, padding or a fixed white fill behind it.
    expect(image?.className).toBe("adm-organization-logo");
  });

  it("renders nothing rather than an empty frame when a viewer has no logo to see", () => {
    const root = mount(
      <OrganizationLogo organization={organization(null)} canWrite={false} onChanged={() => Promise.resolve()} />,
    );

    expect(root.innerHTML).toBe("");
  });

  it("frames the empty placeholder with design-system classes only", () => {
    const root = mount(
      <OrganizationLogo organization={organization(null)} canWrite onChanged={() => Promise.resolve()} />,
    );

    const placeholder = [...root.querySelectorAll<HTMLElement>("div")].find(
      (element) => element.textContent === "No logo",
    );
    expect(placeholder).toBeDefined();
    expect(placeholder?.classList.contains("pk-framed")).toBe(true);
    expect(placeholder?.classList.contains("pk-cluster--center")).toBe(true);
    for (const name of placeholder?.classList ?? []) {
      expect(name.startsWith("pk-") || name.startsWith("adm-")).toBe(true);
    }
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
    // The failure is announced, and it is told apart from a success by its
    // words and its role, not only by the tone dot beside them.
    expect(toast?.getAttribute("role")).toBe("status");
    expect(toast?.textContent).toBe("That file is not an SVG.");
    expect(toast?.classList.contains("pk-toast--danger")).toBe(true);
    expect(changed).not.toHaveBeenCalled();
  });
});
