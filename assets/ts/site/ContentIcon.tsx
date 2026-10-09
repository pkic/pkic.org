/// <reference types="vite/client" />

const icons = import.meta.glob<string>("../../icons/*.svg", { eager: true, query: "?raw", import: "default" });

/** Render the same authored SVG assets used by Hugo's icon partial. */
export function ContentIcon({ name }: { name: string }) {
  const icon = icons[`../../icons/${name}.svg`];
  return icon ? (
    <span
      class="bento-icon"
      aria-hidden="true"
      dangerouslySetInnerHTML={{
        __html: icon.replace('class="ICON_CLASS"', 'class="pk-icon" width="1em" height="1em"'),
      }}
    />
  ) : null;
}
