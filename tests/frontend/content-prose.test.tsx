import { render } from "preact-render-to-string";
import { expect, it } from "vitest";
import { Markdown } from "../../assets/ts/ui/Markdown";
import { ContentProse } from "../../assets/ts/site/ContentProse";

it("shares a reading presentation without changing compact content or chat", () => {
  const body = "## Reading material\n\nAn explanation with **emphasis**.";
  expect(render(<Markdown markdown={body} layout="reading" />)).toContain("pk-content-prose");
  expect(render(<Markdown markdown={body} />)).not.toContain("pk-content-prose");
  expect(render(<Markdown markdown={body} profile="chat" layout="reading" />)).not.toContain("pk-content-prose");
});

it("composes authored components and keeps their contents intact during server rendering", () => {
  const html = render(
    <ContentProse>
      <Markdown markdown={":::aside\n### Supporting context\n\nA [source](https://example.org/).\n:::"} />
    </ContentProse>,
  );
  expect(html).toContain("pk-content-aside");
  expect(html).toContain("Supporting context");
  expect(html).toContain('href="https://example.org/"');
  expect(html).not.toContain(":::aside");
});
