import type { JSX, ComponentType } from "preact";
import { lazy } from "preact/compat";

export interface SiteImageAsset {
  src: string;
  srcSet?: string;
  avifSrcSet?: string;
  width?: number;
  height?: number;
}
export type SiteImageProps = JSX.ImgHTMLAttributes<HTMLImageElement> & { portrait?: boolean };
type Resolver = (src: string, portrait: boolean) => Promise<SiteImageAsset | null>;
let resolveAsset: Resolver | undefined;
interface CachedImage {
  promise: Promise<void>;
  value?: SiteImageAsset | null;
  Component: ComponentType<SiteImageProps>;
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
        return { default: (props: SiteImageProps) => renderSiteImage(props, entry.value ?? null) };
      }),
    };
    assets.set(key, entry);
  }
  return assets.get(key)!.promise;
}

/** Render framework-prepared attributes directly, preserving authored crop and accessibility. */
export function SiteImage({ portrait = false, ...props }: SiteImageProps) {
  const src = typeof props.src === "string" ? props.src : undefined;
  if (!src || !resolveAsset) return <img {...props} />;
  void prepareSiteImage(src, portrait);
  const asset = assets.get(JSON.stringify([src, portrait]))!;
  if (asset.value === undefined) return <asset.Component {...props} portrait={portrait} />;
  return renderSiteImage({ ...props, portrait }, asset.value);
}

function renderSiteImage({ portrait = false, ...props }: SiteImageProps, image: SiteImageAsset | null) {
  if (!image) return <img {...props} />;
  const hero = String(props.class ?? "").includes("pkic-hero-media__image");
  const sizes =
    props.sizes ?? (hero ? "100vw" : portrait ? "auto, 96px" : "auto, (min-width: 80rem) 76rem, calc(100vw - 2rem)");
  const rendered = (
    <img
      {...props}
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
  return image.avifSrcSet ? (
    <picture class="pkic-responsive-picture">
      <source type="image/avif" srcSet={image.avifSrcSet} sizes={sizes} />
      {rendered}
    </picture>
  ) : (
    rendered
  );
}
