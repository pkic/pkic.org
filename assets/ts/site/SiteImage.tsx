import { createContext, type ComponentChildren, type JSX, type ComponentType } from "preact";
import { lazy } from "preact/compat";
import { useContext } from "preact/hooks";
import { deferImageSources, noscriptImageHtml } from "./deferred-images";

export interface SiteImageAsset {
  src: string;
  srcSet?: string;
  avifSrcSet?: string;
  width?: number;
  height?: number;
}
/** Portraits are drawn small; `auto` reads the laid-out width where the browser supports it. */
export const PORTRAIT_IMAGE_SIZES = "auto, 96px";
export type SiteImageProps = JSX.ImgHTMLAttributes<HTMLImageElement> & { portrait?: boolean };
type RenderedImageProps = SiteImageProps & { deferred?: boolean };
type Resolver = (src: string, portrait: boolean) => Promise<SiteImageAsset | null>;
let resolveAsset: Resolver | undefined;
interface CachedImage {
  promise: Promise<void>;
  value?: SiteImageAsset | null;
  Component: ComponentType<RenderedImageProps>;
}
const assets = new Map<string, CachedImage>();

/** Installed once by Astro's prerender entry; runtime/browser rendering needs no build dependency. */
export function configureSiteImages(resolver?: Resolver) {
  resolveAsset = resolver;
  assets.clear();
}

export function prepareSiteImage(src: string, portrait = false): Promise<void> | undefined {
  if (!resolveAsset) return;
  const key = JSON.stringify([src, portrait]);
  if (!assets.has(key)) {
    const entry: CachedImage = {
      promise: resolveAsset(src, portrait).then((value) => {
        entry.value = value;
      }),
      Component: lazy(async () => {
        await entry.promise;
        return { default: (props: RenderedImageProps) => renderSiteImage(props, entry.value ?? null) };
      }),
    };
    assets.set(key, entry);
  }
  return assets.get(key)!.promise;
}

/** Prepare exact current publication references before cached pages can skip
 * rendering. The existing resolver registers transforms with Astro's global
 * image pipeline even outside per-page render metadata collection. */
export async function preparePublicationImages(
  refs: readonly { source: string; portrait?: SiteImageProps["portrait"] }[],
): Promise<boolean> {
  if (!resolveAsset) return false;
  for (const { source, portrait = false } of refs) await prepareSiteImage(source, portrait);
  return true;
}

const ImageDeferral = createContext(false);

/**
 * Images inside a surface that opens later — a dialog, a popover, a panel that
 * starts hidden — keep their sources in `data-deferred-*` until it is shown
 * (deferred-images.ts). Wrap only what a reader must open to see; a reader
 * without scripts gets the image from its `<noscript>` copy.
 */
export function DeferredImages({ children }: { children: ComponentChildren }) {
  return <ImageDeferral.Provider value={true}>{children}</ImageDeferral.Provider>;
}

/** Render framework-prepared attributes directly, preserving authored crop and accessibility. */
export function SiteImage({ portrait = false, ...props }: SiteImageProps) {
  const deferred = useContext(ImageDeferral);
  const src = typeof props.src === "string" ? props.src : undefined;
  if (!src || !resolveAsset) return <Img {...props} deferred={deferred} />;
  void prepareSiteImage(src, portrait);
  const asset = assets.get(JSON.stringify([src, portrait]))!;
  if (asset.value === undefined) return <asset.Component {...props} portrait={portrait} deferred={deferred} />;
  return renderSiteImage({ ...props, portrait, deferred }, asset.value);
}

/** The `<img>` itself, with its sources deferred when its surface opens later. */
type ImgProps = JSX.ImgHTMLAttributes<HTMLImageElement> & { deferred?: boolean; noscript?: boolean };

/** A reader without scripts gets the deferred image from this copy. */
function NoscriptImage(props: JSX.ImgHTMLAttributes<HTMLImageElement>) {
  return <noscript dangerouslySetInnerHTML={{ __html: noscriptImageHtml(props as Record<string, unknown>) }} />;
}

/** `noscript: false` when the caller places the fallback itself, outside a `<picture>`. */
function Img({ deferred = false, noscript = true, ...props }: ImgProps) {
  if (!deferred) return <img {...props} />;
  return (
    <>
      <img {...deferImageSources(props)} />
      {noscript && <NoscriptImage {...props} />}
    </>
  );
}

function renderSiteImage(
  { portrait = false, deferred = false, ...props }: RenderedImageProps,
  image: SiteImageAsset | null,
) {
  if (!image) return <Img {...props} deferred={deferred} />;
  const hero = String(props.class ?? "").includes("pkic-hero-media__image");
  const sizes =
    props.sizes ??
    (hero ? "100vw" : portrait ? PORTRAIT_IMAGE_SIZES : "auto, (min-width: 80rem) 76rem, calc(100vw - 2rem)");
  const picture = Boolean(image.avifSrcSet);
  const imageProps = {
    ...props,
    src: image.src,
    srcSet: image.srcSet,
    width: props.width ?? image.width,
    height: props.height ?? image.height,
    sizes: image.srcSet ? sizes : props.sizes,
  };
  const rendered = (
    <Img
      {...props}
      deferred={deferred}
      noscript={!picture}
      src={image.src}
      srcSet={image.srcSet}
      width={props.width ?? image.width}
      height={props.height ?? image.height}
      sizes={image.srcSet ? sizes : props.sizes}
      loading={hero ? "eager" : (props.loading ?? "lazy")}
      decoding="async"
      fetchpriority={hero ? "high" : props.fetchpriority}
    />
  );
  const figure = picture ? (
    <picture class="pkic-responsive-picture">
      {deferred ? (
        <source type="image/avif" {...deferImageSources({ srcSet: image.avifSrcSet, sizes })} />
      ) : (
        <source type="image/avif" srcSet={image.avifSrcSet} sizes={sizes} />
      )}
      {rendered}
    </picture>
  ) : (
    rendered
  );
  // A <noscript> is not valid inside <picture>, so a deferred picture's fallback follows it.
  return picture && deferred ? (
    <>
      {figure}
      <NoscriptImage {...imageProps} />
    </>
  ) : (
    figure
  );
}
