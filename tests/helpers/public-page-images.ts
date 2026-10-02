/** Read actual image markup through the platform HTML parser, including publication derivatives. */
export async function publicPageImages(html: string, selector: string) {
  const images: Array<{ src: string; srcset: string; alt: string }> = [];
  await new HTMLRewriter()
    .on(selector, {
      element(element) {
        images.push({
          src: element.getAttribute("src") ?? "",
          srcset: element.getAttribute("srcset") ?? "",
          alt: element.getAttribute("alt") ?? "",
        });
      },
    })
    .transform(new Response(html, { headers: { "content-type": "text/html; charset=UTF-8" } }))
    .arrayBuffer();
  return images;
}
