// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Grants } from "../../assets/ts/member-flows/portal/sections/access-control/Grants";
import { Roles } from "../../assets/ts/member-flows/portal/sections/access-control/Roles";
import { UserRoles } from "../../assets/ts/member-flows/portal/sections/access-control/UserRoles";

const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
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
});

describe("portal system access control", () => {
  it("uses canonical grants endpoints and hides grant creation from revoke-only staff", async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        paths.push(url.pathname);
        if (url.pathname === "/api/v1/permissions/grants") {
          return json({
            grants: [
              {
                id: "00000000-0000-4000-8000-000000000001",
                userId: "00000000-0000-4000-8000-000000000002",
                userEmail: "staff@example.test",
                permission: "access:grant",
                contextType: null,
                contextId: null,
                expiresAt: null,
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(() => render(<Grants canGrant={false} canRevoke />, container));
    await settle();

    expect(container.textContent).not.toContain("Grant a permission");
    expect(container.textContent).toContain("Revoke");
    expect(paths).toEqual(["/api/v1/permissions/grants"]);
    expect(paths.some((path) => path.startsWith("/api/v1/admin/"))).toBe(false);
  });

  it("keeps role inspection available while hiding creation and deletion without the corresponding authority", async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        paths.push(url.pathname);
        if (url.pathname === "/api/v1/roles") {
          return json({
            roles: [
              {
                id: "role-membership_processor",
                name: "membership_processor",
                description: null,
                isSystemRole: false,
                permissions: [],
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(() => render(<Roles canGrant={false} canRevoke={false} />, container));
    await settle();

    expect(container.textContent).not.toContain("Create a custom role");
    expect(container.textContent).not.toContain("Delete");
    expect(container.textContent).toContain("membership_processor");
    expect(paths).toEqual(["/api/v1/roles"]);
  });

  it("hides role assignment controls without grant authority while retaining the staff tab shell", () => {
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() => render(<UserRoles canGrant={false} canRevoke={false} />, container));

    expect(container.textContent).toContain("Staff management");
    expect(container.textContent).not.toContain("Assign");
  });
});
