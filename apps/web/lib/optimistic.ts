// Optimistic mutation — one small primitive so every mutation in the app reads
// the same way: paint the change now, call the server, then either fold in the
// server's truth (reconcile) or undo the change (rollback) if the call fails.
//
// The point is consistency, not cleverness: the sidebar, settings, and offices
// all route their writes through this, so "instant, with a quiet rollback on
// error" is a property of the app, not a habit re-implemented per component.
//
//   apply     — mutate local UI state immediately (before the network)
//   commit    — perform the server call; its resolved value is the truth
//   reconcile — optional: fold server truth back in (real ids, canonical shape)
//   rollback  — undo `apply` when commit throws
//   onError   — optional: surface a quiet notice (rollback already ran)

export interface OptimisticSpec<T> {
  apply: () => void;
  commit: () => Promise<T>;
  rollback: (err: unknown) => void;
  reconcile?: (result: T) => void;
  onError?: (err: unknown) => void;
}

export async function optimistic<T>(spec: OptimisticSpec<T>): Promise<T | undefined> {
  spec.apply();
  try {
    const result = await spec.commit();
    spec.reconcile?.(result);
    return result;
  } catch (err) {
    spec.rollback(err);
    spec.onError?.(err);
    return undefined;
  }
}
