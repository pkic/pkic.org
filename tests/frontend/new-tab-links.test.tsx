import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { ButtonLink } from "../../assets/ts/ui/Button";
import { ExternalLink } from "../../assets/ts/ui/ExternalLink";
import { Markdown } from "../../assets/ts/ui/Markdown";

const hosts: HTMLElement[] = [];
function mount(node: preact.VNode): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  render(node, host);
  return host;
}
afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

describe("the new-tab policy", () => {
  it("opens an address outside the portal in a new tab and says so, on every link primitive", () => {
    const host = mount(
      <div>
        <ButtonLink href="https://example.org/a">Out</ButtonLink>
        <ButtonLink href="/portal/">In</ButtonLink>
        <ButtonLink href="https://example.org/b" external={false}>
          Forced in
        </ButtonLink>
        <ExternalLink href="https://example.org/c">Text</ExternalLink>
        <ExternalLink href="#top">Hash</ExternalLink>
      </div>,
    );
    const [out, inside, forced, text, hash] = [...host.querySelectorAll("a")];
    for (const link of [out, text]) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.textContent).toContain("(opens in a new tab)");
    }
    for (const link of [inside, forced, hash]) {
      expect(link.hasAttribute("target")).toBe(false);
      expect(link.textContent).not.toContain("opens in a new tab");
    }
  });

  it("applies the policy to authored Markdown links", () => {
    const host = mount(<Markdown markdown={"[out](https://example.org/x) [in](/portal/) [mail](mailto:a@b.org)"} />);
    const [out, inside, mail] = [...host.querySelectorAll("a")];
    expect(out.getAttribute("target")).toBe("_blank");
    expect(out.getAttribute("rel")).toContain("noreferrer");
    expect(out.textContent).toContain("(opens in a new tab)");
    expect(inside.hasAttribute("target")).toBe(false);
    expect(mail.hasAttribute("target")).toBe(false);
  });
});
