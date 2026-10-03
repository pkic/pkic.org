import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { PORTAL_LOGIN_COPY_ID, portalLoginCopySchema } from "../../assets/shared/schemas/portal-login-copy";
import { PortalPage } from "../../assets/ts/site/PortalPage";

describe("portal document shell", () => {
  it("keeps authored login copy inert and mounts the application without a prose wrapper", () => {
    const copy = portalLoginCopySchema.parse({
      headline: 'Organizations </script><script>alert("test")</script> & users',
      facts: [{ value: "—", label: "members", memberCount: "all" }],
    });
    const container = document.createElement("main");
    container.innerHTML = render(<PortalPage copy={copy} />);
    expect(container.querySelectorAll("script")).toHaveLength(1);
    const source = container.querySelector(`#${PORTAL_LOGIN_COPY_ID}`)!;
    expect(source.getAttribute("type")).toBe("application/json");
    expect(portalLoginCopySchema.parse(JSON.parse(source.textContent!))).toEqual(copy);
    expect(container.querySelector(":scope > #portal-app")?.getAttribute("data-module")).toBe(
      "member-flows/portal-page",
    );
    expect(container.querySelector(":scope > #portal-toast-area")).not.toBeNull();
  });
});
