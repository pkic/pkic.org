import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useNumericCssProperties } from "../../assets/ts/hooks/useNumericCssProperties";

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

function Geometry({ scale, name }: { scale: number; name: string }) {
  const id = useNumericCssProperties({ "--test-scale": scale });
  return <div data-numeric-css-properties={id}>{name}</div>;
}

// jsdom exposes CSS rules but does not compute styles from adopted stylesheets.
function scaleFor(element: Element): string | undefined {
  return document.adoptedStyleSheets
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule): rule is CSSStyleRule => "selectorText" in rule)
    .find((rule) => element.matches(rule.selectorText))
    ?.style.getPropertyValue("--test-scale");
}

afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
});

describe("calculated CSS geometry", () => {
  it("isolates instances, updates their calculated values, and leaves markup free of inline styles", async () => {
    const show = (scale: number) => (
      <>
        <Geometry name="First timer" scale={scale} />
        <Geometry name="Second timer" scale={0.5} />
      </>
    );
    await act(() => render(show(1), host));
    const first = host.children[0]!;
    const second = host.children[1]!;
    expect(scaleFor(first)).toBe("1");
    expect(scaleFor(second)).toBe("0.5");
    await act(() => render(show(0.25), host));
    expect(scaleFor(first)).toBe("0.25");
    expect(scaleFor(second)).toBe("0.5");
    expect(host.querySelector("[style]")).toBeNull();
  });

  it("releases its stylesheet on unmount instead of accumulating rules across screen changes", async () => {
    const before = document.adoptedStyleSheets?.length ?? 0;
    await act(() => render(<Geometry name="Timer" scale={1} />, host));
    expect(document.adoptedStyleSheets).toHaveLength(before + 1);
    await act(() => render(null, host));
    expect(document.adoptedStyleSheets).toHaveLength(before);
  });
});
