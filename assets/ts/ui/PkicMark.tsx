import type { SvgProps } from "./MediaIcons";
import "./PkicMark.css";

/** The part of the mark a caller points at; the rest of the mark recedes. */
export type PkicMarkElement = "arcs" | "table";

/**
 * The PKI Consortium mark: its three arcs around the table and keyhole, drawn
 * in one color, the current text color, like every other icon. The color logo
 * is the brand's own mark and is never reused as an icon. It stands for membership wherever a role sits beside a name.
 *
 * `highlight` names one element: the three arcs (the members) or the table
 * with its spokes (the groups). That element draws at full strength and the
 * rest of the logo draws at `--pk-mark-recede`, so a menu icon or a card is
 * still recognizably the whole mark while pointing at one part of it.
 */
export function PkicMark({ class: className, highlight, ...props }: SvgProps & { highlight?: PkicMarkElement }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="20 30 320 330"
      aria-hidden="true"
      focusable="false"
      {...props}
      data-highlight={highlight}
      class={["pk-pkic-mark", className].filter(Boolean).join(" ")}
    >
      <path
        class="pk-pkic-mark__arc"
        fill="currentColor"
        d="M208.803 323.222C200.41 337.77 198.765 357.85 180 357.85C161.235 357.85 159.59 337.77 151.197 323.222A146.09 146.09 0 0 1 78.134 284.717L92.552 271.088A126.27 126.27 0 0 0 267.448 271.088L281.866 284.717A146.09 146.09 0 0 1 208.803 323.222Z"
      />
      <path
        class="pk-pkic-mark__arc"
        fill="currentColor"
        d="M289.632 83.444C306.428 83.439 324.64 74.824 334.023 91.075C343.405 107.326 326.838 118.791 318.436 133.333A146.09 146.09 0 0 1 321.62 215.86L302.608 210.188A126.27 126.27 0 0 0 215.161 58.724L219.754 39.423A146.09 146.09 0 0 1 289.632 83.444Z"
      />
      <path
        class="pk-pkic-mark__arc"
        fill="currentColor"
        d="M41.564 133.333C33.162 118.791 16.595 107.326 25.977 91.075C35.36 74.824 53.572 83.439 70.368 83.444A146.09 146.09 0 0 1 140.246 39.423L144.839 58.724A126.27 126.27 0 0 0 57.392 210.188L38.38 215.86A146.09 146.09 0 0 1 41.564 133.333Z"
      />
      <path
        class="pk-pkic-mark__table"
        fill="currentColor"
        fill-rule="evenodd"
        d="M189.905 81.165A99.33 99.33 0 0 1 270.546 220.839L311.47 244.467L301.565 261.623L260.641 237.995A99.33 99.33 0 0 1 99.359 237.995L58.435 261.623L48.53 244.467L89.454 220.839A99.33 99.33 0 0 1 170.095 81.165L170.095 33.91L189.905 33.91ZM180 100.48A79.52 79.52 0 0 0 180 259.52A79.52 79.52 0 0 0 180 100.48Z"
      />
      <path
        class="pk-pkic-mark__keyhole"
        fill="currentColor"
        d="M169.025 175.7L155.295 228.84L204.705 228.84L190.975 175.7A23.625 23.625 0 1 0 169.025 175.7Z"
      />
    </svg>
  );
}
