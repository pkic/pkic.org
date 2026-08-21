interface ContactRepresentative {
  userId: string;
  name: string | null;
  email: string;
}

export function RepresentativeContactSelect({
  label,
  value,
  representatives,
  onChange,
}: {
  label: string;
  value: string;
  representatives: ContactRepresentative[];
  onChange: (value: string) => void;
}) {
  return (
    <div class="col-md-6">
      <label class="form-label small mb-1">{label}</label>
      <select
        class="form-select form-select-sm"
        value={value}
        onChange={(event) => onChange((event.target as HTMLSelectElement).value)}
      >
        <option value="">— None —</option>
        {representatives.map((representative) => (
          <option key={representative.userId} value={representative.userId}>
            {representative.name} ({representative.email})
          </option>
        ))}
      </select>
    </div>
  );
}
