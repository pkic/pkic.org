import { renderToStringAsync as render } from "preact-render-to-string";
import { ContentFaq } from "../../../assets/ts/site/ContentFaq";
import { headingAnchor } from "./site-headings";
import { objectList, objectValue, type ContentCall } from "./site-shortcodes";

/** FAQ groups whose questions each get a unique permalink, slugged like the site's headings. */
export async function renderContentFaq(
  call: ContentCall,
  markdownHtml: (value: unknown) => Promise<string>,
): Promise<string> {
  const used = new Map<string, number>();
  const uniqueId = (text: string) => {
    const base = headingAnchor(text) || "question";
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return seen ? `${base}-${seen}` : base;
  };
  const groups = await Promise.all(
    objectList(objectValue(call.inner).groups).map(async (group) => {
      const title = typeof group.title === "string" ? group.title : undefined;
      return {
        id: title ? uniqueId(title) : undefined,
        title,
        questions: await Promise.all(
          objectList(group.questions)
            .filter((item) => typeof item.question === "string" && item.question.trim())
            .map(async (item) => ({
              id: uniqueId(String(item.question)),
              question: String(item.question),
              answerHtml: await markdownHtml(item.answer),
              open: item.open === true,
            })),
        ),
      };
    }),
  );
  return render(<ContentFaq groups={groups} />);
}
