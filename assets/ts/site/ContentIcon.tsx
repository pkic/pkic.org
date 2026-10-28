/// <reference types="vite/client" />

const icons = import.meta.glob<string>("../../icons/*.svg", { eager: true, query: "?raw", import: "default" });

/** Render the same authored SVG assets used by Hugo's icon partial. */
export function contentIconMarkup(name: string): string | undefined {
  return icons[`../../icons/${name}.svg`]?.replace('class="ICON_CLASS"', 'class="pk-icon" width="1em" height="1em"');
}

export function ContentIcon({ name, className = "bento-icon" }: { name: string; className?: string }) {
  const icon = contentIconMarkup(name);
  return icon ? (
    <span
      class={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{
        __html: icon,
      }}
    />
  ) : null;
}
