import type { ComponentChildren } from "preact";

export function RegistrationActionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ComponentChildren;
}) {
  return (
    <div class="col-md-4">
      <div class="card h-100">
        <div class="card-header">
          <h6 class="mb-0">{title}</h6>
        </div>
        <div class="card-body">
          {description && <p class="small text-muted mb-2">{description}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
