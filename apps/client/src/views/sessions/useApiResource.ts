import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError } from "../../api/agent";

export type Resource<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

interface Settled<T> {
  key: string;
  outcome: Resource<T>;
}

/**
 * Loads one API resource, only while `enabled` (the view is active). The
 * request re-runs when `enabled` turns true, when `key` changes and when
 * `reload()` is called. A failure is returned as `{status:"error"}`; nothing
 * is substituted for it. A result that belongs to an older `key` is reported
 * as "loading" rather than shown against the wrong filters.
 */
export function useApiResource<T>(
  enabled: boolean,
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
): { resource: Resource<T>; reload: () => void } {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    loadRef
      .current(controller.signal)
      .then((data) => setSettled({ key, outcome: { status: "ready", data } }))
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setSettled({
          key,
          outcome: {
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      });
    return () => controller.abort();
  }, [enabled, key, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const resource: Resource<T> =
    settled && settled.key === key ? settled.outcome : { status: "loading" };
  return { resource, reload };
}

/** Message of any thrown value (ApiError already carries code and detail). */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Local date-time; the raw string is shown when it does not parse. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("vi-VN");
}
