import { afterEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { useEditorResource } from "../../assets/ts/hooks/useEditorResource";

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

describe("useEditorResource", () => {
  it("loads server data into editable state and refreshes it", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(["one"]).mockResolvedValueOnce(["two"]);
    let resource: ReturnType<typeof useEditorResource<string[]>> | undefined;
    function Harness() {
      resource = useEditorResource<string[]>(fetcher, [], []);
      return null;
    }
    const container = document.createElement("div");
    mounted.push(container);
    void act(() => render(h(Harness, {}), container));
    await act(async () => Promise.resolve());
    expect(resource?.value).toEqual(["one"]);

    await act(async () => resource?.reload());
    expect(resource?.value).toEqual(["two"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
