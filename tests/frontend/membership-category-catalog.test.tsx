// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invalidateMembershipCategoryCatalog,
  useMembershipCategoryCatalog,
} from "../../assets/ts/hooks/useMembershipCategoryCatalog";
import { useMembershipCategoryLabels } from "../../assets/ts/hooks/useMembershipCategoryLabels";
import { exampleMembershipCategories } from "./helpers/membership-category-catalog";

const container = document.createElement("div");
function Catalog() {
  const categories = useMembershipCategoryCatalog();
  const labels = useMembershipCategoryLabels();
  return <p>{categories.map((category) => labels.label(category.code)).join(", ")}</p>;
}

afterEach(() => {
  void act(() => render(null, container));
  invalidateMembershipCategoryCatalog();
  vi.unstubAllGlobals();
});

describe("shared membership category catalog", () => {
  it("loads public policy once for both form choices and labels without staff catalog permission", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({ categories: exampleMembershipCategories, form: null }),
    );
    vi.stubGlobal("fetch", fetch);
    await act(async () => {
      render(<Catalog />, container);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/api/v1/members/applications/form");
    expect(container.textContent).toContain("Example H6 (H6)");
  });
});
