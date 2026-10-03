import { renderToStringAsync as render } from "preact-render-to-string";
import { ContentCards, type ContentCardData } from "../../../assets/ts/site/ContentComponents";
import type { ContentComponentContext } from "./site-components";
import { objectValue, type ContentCall } from "./site-shortcodes";

export function buttonVariant(value?: string): "danger" | "link" | "primary" | "secondary" {
  if (value === "danger" || value === "link") return value;
  return value === "primary" || value === "success" ? "primary" : "secondary";
}

export async function renderContentCards(
  call: ContentCall,
  context: Pick<ContentComponentContext, "assetUrl">,
  markdownHtml: (value: unknown) => Promise<string>,
): Promise<string> {
  const data = objectValue(call.inner);
  const rawCards = Array.isArray(data.cards) ? data.cards : [];
  const cardStyle = typeof data.card_style === "string" ? data.card_style : undefined;
  const normalized: ContentCardData[] = await Promise.all(
    rawCards.map(async (value) => {
      const card = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      const rawLinks = Array.isArray(card.links) ? card.links : [];
      return {
        color: typeof card.color === "string" ? card.color : undefined,
        icon: typeof card.icon === "string" ? card.icon : undefined,
        // A card image is written beside the page, so it resolves the same way
        // a figure's does: as a bundled asset, not as a page-relative URL.
        image: typeof card.image === "string" ? (context.assetUrl(card.image) ?? card.image) : undefined,
        links: rawLinks.map((item) => {
          const link = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          return {
            text: typeof link.text === "string" ? link.text : undefined,
            url: typeof link.url === "string" ? link.url : undefined,
            variant: buttonVariant(typeof link.variant === "string" ? link.variant : undefined),
          };
        }),
        textHtml: await markdownHtml(card.text),
        title: typeof card.title === "string" ? card.title : undefined,
      };
    }),
  );
  return render(<ContentCards cards={normalized} style={cardStyle} />);
}
