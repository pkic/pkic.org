import { useRef, useState } from "preact/hooks";
import { ImageCarousel, ImageCarouselControls } from "../ImageCarousel";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import type { PreviewSection } from "./PreviewShell";
const sources = ["Cover", "Key takeaways", "Registration"].map(
  (label) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#125c3c"/><text x="80" y="200" fill="white" font-size="64">${label}</text></svg>`)}`,
);
function CarouselPreview() {
  const [open, setOpen] = useState(false),
    [index, setIndex] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  return (
    <>
      <span data-gallery-open>
        <Button onClick={() => setOpen(true)}>Open carousel</Button>
      </span>
      <Dialog
        open={open}
        viewer
        confirmLabel="Close"
        onConfirm={() => setOpen(false)}
        size="wide"
        title="Carousel"
        closeLabel="Close preview"
        onCancel={() => setOpen(false)}
        footerActions={
          <ImageCarouselControls
            index={index}
            count={sources.length}
            onMove={(direction) => {
              const element = viewport.current;
              element?.scrollBy({ left: element.clientWidth * direction });
            }}
          />
        }
      >
        <ImageCarousel sources={sources} label="Promotion slides" viewportRef={viewport} onIndexChange={setIndex} />
      </Dialog>
    </>
  );
}
export const imageCarouselSection: PreviewSection = {
  id: "image-carousel",
  title: "Image carousel",
  render: () => <CarouselPreview />,
};
