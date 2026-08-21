export function NotFoundPanel({
  message,
  backHref,
  backLabel,
}: {
  message: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div class="container py-5 text-center">
      <p class="lead">{message}</p>
      <a href={backHref}>&larr; {backLabel}</a>
    </div>
  );
}
