import { useId } from "preact/hooks";

/** The /countdown emblem, centered in its square box, with the room's authoritative timer in its center. */
export function LiveCountdownEmblem({ text, running, over }: { text: string; running: boolean; over: boolean }) {
  const gradient = `countdown-${useId()}`;
  return (
    <svg
      class="pk-live-overlay__countdown-logo"
      viewBox="0 0 434 434"
      role="img"
      aria-label={`${text} remaining`}
      data-running={running ? "" : undefined}
      data-over={over ? "" : undefined}
    >
      <defs>
        <linearGradient id={gradient} x1="0%" y1="0%" x2="100%">
          <stop offset="0%" class="pk-live-overlay__countdown-green" />
          <stop offset="50%" class="pk-live-overlay__countdown-blue" />
          <stop offset="100%" class="pk-live-overlay__countdown-orange" />
        </linearGradient>
      </defs>
      <g class="pk-live-overlay__countdown-ring" fill={`url(#${gradient})`}>
        <path d="M245.803 360.222C237.41 374.77 235.765 394.85 217 394.85C198.235 394.85 196.59 374.77 188.197 360.222A146.09 146.09 0 0 1 115.134 321.717L129.552 308.088A126.27 126.27 0 0 0 304.448 308.088L318.866 321.717A146.09 146.09 0 0 1 245.803 360.222ZM326.632 120.444C343.428 120.439 361.64 111.824 371.023 128.075C380.405 144.326 363.838 155.791 355.436 170.333A146.09 146.09 0 0 1 358.62 252.86L339.608 247.188A126.27 126.27 0 0 0 252.161 95.724L256.754 76.423A146.09 146.09 0 0 1 326.632 120.444ZM78.564 170.333C70.162 155.791 53.595 144.326 62.977 128.075C72.36 111.824 90.572 120.439 107.368 120.444A146.09 146.09 0 0 1 177.246 76.423L181.839 95.724A126.27 126.27 0 0 0 94.392 247.188L75.38 252.86A146.09 146.09 0 0 1 78.564 170.333Z" />
        <path
          fill-rule="evenodd"
          d="M226.905 118.165A99.33 99.33 0 0 1 307.546 257.839L348.47 281.467L338.565 298.623L297.641 274.995A99.33 99.33 0 0 1 136.359 274.995L95.435 298.623L85.53 281.467L126.454 257.839A99.33 99.33 0 0 1 207.095 118.165L207.095 70.91L226.905 70.91ZM217 137.48A79.52 79.52 0 0 0 217 296.52A79.52 79.52 0 0 0 217 137.48Z"
        />
      </g>
      <text
        x="217"
        y="219"
        text-anchor="middle"
        dominant-baseline="central"
        font-size={Math.min(90, 380 / text.length)}
      >
        {text}
      </text>
    </svg>
  );
}
