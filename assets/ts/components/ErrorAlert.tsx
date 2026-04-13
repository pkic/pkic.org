interface ErrorAlertProps {
  error: string | Error | null | undefined;
}

export function ErrorAlert({ error }: ErrorAlertProps) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : error;
  return <div class="alert alert-danger">{msg}</div>;
}
