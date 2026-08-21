export function EventScheduleFields({
  startsAt,
  endsAt,
  timezone,
  onStartsAtChange,
  onEndsAtChange,
  onTimezoneChange,
  timezonePlaceholder,
}: {
  startsAt: string;
  endsAt: string;
  timezone: string;
  onStartsAtChange: (value: string) => void;
  onEndsAtChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  timezonePlaceholder?: string;
}) {
  return (
    <div class="row g-2 mb-2">
      <div class="col-md-4">
        <label class="form-label small fw-semibold">Start date</label>
        <input
          class="form-control form-control-sm"
          type="datetime-local"
          value={startsAt}
          onInput={(event) => onStartsAtChange((event.target as HTMLInputElement).value)}
        />
      </div>
      <div class="col-md-4">
        <label class="form-label small fw-semibold">End date</label>
        <input
          class="form-control form-control-sm"
          type="datetime-local"
          value={endsAt}
          onInput={(event) => onEndsAtChange((event.target as HTMLInputElement).value)}
        />
      </div>
      <div class="col-md-4">
        <label class="form-label small fw-semibold">Timezone</label>
        <input
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
