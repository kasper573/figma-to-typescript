export type Result<V, E> = { ok: true; value: V } | { ok: false; error: E };

export function ok<V, E>(value: V): Result<V, E> {
  return { ok: true, value };
}

export function err<V, E>(error: E): Result<V, E> {
  return { ok: false, error };
}
