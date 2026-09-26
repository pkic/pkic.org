// @vitest-environment jsdom
/**
 * What `{{< … >}}` does in stored Markdown.
 *
 * Issue #12: a member wrote the shortcode their Hugo page used to take and
 * got the braces printed on their public profile. The class of failure is a
 * renderer that implements part of a syntax and emits the rest verbatim, so
 * the tests here are about the whole surface of that syntax — the supported
 * names, the unsupported ones, the malformed ones — not only about YouTube.
 */
import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { Markdown } from "../../assets/ts/components/Markdown";
import {
  findMarkdownShortcodes,
  markdownShortcodeUrl,
  resolveMarkdownShortcodes,
  SUPPORTED_MARKDOWN_SHORTCODES,
  unsupportedMarkdownShortcodeNames,
} from "../../assets/shared/markdown-shortcodes";
import { organizationEditableContentSchema } from "../../assets/shared/schemas/organization-profile";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

describe("the shortcode registry", () => {
  it.each([
    ["{{< youtube HGoZW7MCF60 >}}", "https://www.youtube.com/watch?v=HGoZW7MCF60"],
    // Real member content: no space before the closing delimiter.
    ["{{< youtube csGJEyVen-o>}}", "https://www.youtube.com/watch?v=csGJEyVen-o"],
    ["{{< vimeo 76979871 >}}", "https://vimeo.com/76979871"],
    ['{{< video link="https://example.test/v.mp4" >}}', "https://example.test/v.mp4"],
    // The percent delimiter is the same shortcode, differently spelled.
    ["{{% youtube HGoZW7MCF60 %}}", "https://www.youtube.com/watch?v=HGoZW7MCF60"],
  ])("resolves %s to its URL", (source, url) => {
    expect(resolveMarkdownShortcodes(source)).toBe(url);
  });

  it("removes a shortcode it does not support rather than printing it", () => {
    expect(resolveMarkdownShortcodes('before {{< figure src="/x.png" >}} after')).toBe("before  after");
    expect(unsupportedMarkdownShortcodeNames('{{< figure src="/x.png" >}}{{< button >}}')).toEqual([
      "figure",
      "button",
    ]);
  });

  it("names each unsupported shortcode once, whatever the delimiter or case", () => {
    expect(unsupportedMarkdownShortcodeNames("{{< Figure >}} {{% figure %}} {{< figure >}}")).toEqual(["figure"]);
  });

  it("drops a supported shortcode whose argument is not usable", () => {
    // An empty embed is worse than none: it is a frame pointing at nothing.
    expect(markdownShortcodeUrl({ name: "youtube", argument: "", raw: "" })).toBeNull();
    expect(markdownShortcodeUrl({ name: "vimeo", argument: "not-a-number", raw: "" })).toBeNull();
    expect(markdownShortcodeUrl({ name: "video", argument: 'poster="/p.png"', raw: "" })).toBeNull();
    expect(resolveMarkdownShortcodes("{{< youtube >}}")).toBe("");
  });

  it("finds every shortcode on a second call — the pattern keeps no position", () => {
    const source = "{{< youtube a >}} {{< vimeo 1 >}}";
    expect(findMarkdownShortcodes(source)).toHaveLength(2);
    expect(findMarkdownShortcodes(source)).toHaveLength(2);
  });

  it("leaves text that only looks like a shortcode alone", () => {
    expect(resolveMarkdownShortcodes("Use {{ braces }} or {{<not closed")).toBe("Use {{ braces }} or {{<not closed");
    expect(unsupportedMarkdownShortcodeNames("2 < 3 and {{ x }}")).toEqual([]);
  });
});

describe("Markdown rendering a shortcode", () => {
  it("embeds the video a supported shortcode names", () => {
    const container = mount(<Markdown markdown="{{< youtube HGoZW7MCF60 >}}" />);
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe("https://www.youtube.com/embed/HGoZW7MCF60");
  });

  it("never shows the reader template syntax", () => {
    const container = mount(<Markdown markdown={'A note.\n\n{{< figure src="/x.png" >}}\n\nAnother note.'} />);
    expect(container.textContent).not.toContain("{{");
    expect(container.textContent).toContain("A note.");
    expect(container.textContent).toContain("Another note.");
  });

  it("keeps the sentence a shortcode was written inside", () => {
    const container = mount(<Markdown markdown="See {{< youtube HGoZW7MCF60 >}} for the demo." />);
    // A shortcode mid-sentence resolves to its URL and stays prose, exactly as
    // a pasted URL mid-sentence does — embedding it would drop the words.
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("See ");
    expect(container.textContent).toContain("for the demo.");
    expect(container.textContent).not.toContain("{{");
  });
});

describe("the contract an author writes against", () => {
  it("accepts every supported shortcode", () => {
    for (const name of SUPPORTED_MARKDOWN_SHORTCODES) {
      expect(organizationEditableContentSchema.safeParse({ contentMarkdown: `{{< ${name} x >}}` }).success).toBe(true);
    }
  });

  it("refuses an unsupported one, and says which ones work", () => {
    const result = organizationEditableContentSchema.safeParse({
      contentMarkdown: '{{< figure src="/x.png" >}}',
    });
    expect(result.success).toBe(false);
    const message = result.success ? "" : result.error.issues[0].message;
    expect(message).toContain("{{< figure >}}");
    for (const name of SUPPORTED_MARKDOWN_SHORTCODES) expect(message).toContain(name);
  });

  it("reports the refusal against the field the author is editing", () => {
    const result = organizationEditableContentSchema.safeParse({ contentMarkdown: "{{< cards >}}" });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues[0].path).toEqual(["contentMarkdown"]);
  });
});
