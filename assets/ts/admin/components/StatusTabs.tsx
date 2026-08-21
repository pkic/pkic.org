export function StatusTabs<Status extends string>({
  statuses,
  active,
  onChange,
  label = (status) => status.replace(/_/g, " "),
}: {
  statuses: readonly Status[];
  active: Status;
  onChange: (status: Status) => void;
  label?: (status: Status) => string;
}) {
  return (
    <ul class="nav nav-tabs mb-3">
      {statuses.map((status) => (
        <li class="nav-item" key={status}>
          <button
            type="button"
            class={`nav-link text-capitalize${active === status ? " active" : ""}`}
            onClick={() => onChange(status)}
          >
            {label(status)}
          </button>
        </li>
      ))}
    </ul>
  );
}
