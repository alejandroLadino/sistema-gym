export function FormMessage({ error, message }: { error?: string; message?: string }) {
  if (error) return <p className="alert alert-error" role="alert">{error}</p>;
  if (message) return <p className="alert alert-success" role="status">{message}</p>;
  return null;
}
