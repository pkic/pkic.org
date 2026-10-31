import type { EmbeddedRasterImage } from "../../utils/image-format";

/** CSS object-fit:cover plus object-position, with a single uniform scale. */
export function promotionImageCover(
  image: Pick<EmbeddedRasterImage, "width" | "height">,
  width: number,
  height: number,
  position: { x: number; y: number },
) {
  const scale = Math.max(width / image.width, height / image.height);
  const renderedWidth = image.width * scale,
    renderedHeight = image.height * scale;
  return {
    x: (width - renderedWidth) * position.x,
    y: (height - renderedHeight) * position.y,
    width: renderedWidth,
    height: renderedHeight,
    scale,
  };
}
