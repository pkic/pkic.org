export function EventScheduleFields({
  startsAt,
  endsAt,
  timezone,
  onStartsAtChange,
  onEndsAtChange,
  onTimezoneChange,
  timezonePlaceholder,
  idPrefix = "event-schedule",
}: {
  startsAt: string;
  endsAt: string;
  timezone: string;
  onStartsAtChange: (value: string) => void;
  onEndsAtChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  timezonePlaceholder?: string;
  idPrefix?: string;
}) {
  const startId = `${idPrefix}-starts-at`;
  const endId = `${idPrefix}-ends-at`;
  const timezoneId = `${idPrefix}-timezone`;
  return (
    <div class="row g-2 mb-2">
      <div class="col-md-4">
        <label class="form-label small fw-semibold" for={startId}>
          Start date
        </label>
        <input
          id={startId}
          class="form-control form-control-sm"
          type="datetime-local"
          value={startsAt}
          onInput={(event) => onStartsAtChange((event.target as HTMLInputElement).value)}
        />
      </div>
      <div class="col-md-4">
        <label class="form-label small fw-semibold" for={endId}>
          End date
        </label>
        <input
          id={endId}
          class="form-control form-control-sm"
          type="datetime-local"
          value={endsAt}
          onInput={(event) => onEndsAtChange((event.target as HTMLInputElement).value)}
        />
      </div>
      <div class="col-md-4">
        <label class="form-label small fw-semibold" for={timezoneId}>
          Timezone
        </label>
        <input
          id={timezoneId}
          class="form-control form-control-sm"
          type="text"
          value={timezone}
          onInput={(event) => onTimezoneChange((event.target as HTMLInputElement).value)}
          placeholder={timezonePlaceholder}
          required
        />
      </div>
    </div>
  );
}
