/**
 * One-time workbench initialization. Contribs push setup callbacks (event
 * subscriptions, store wiring) here at module load; the Workbench mount
 * effect drains the registry.
 */
export const initRegistry: Array<() => void> = [];

let ran = false;

/**
 * Drain the registry exactly once per renderer lifetime. React StrictMode
 * double-invokes mount effects in dev; without this guard every unguarded
 * init re-subscribed its IPC listeners (duplicate `evt:workspace.changed`
 * handlers, MaxListenersExceededWarning). Returns true only on the call
 * that performed the initialization, so callers can gate one-time
 * side effects on it.
 */
export function runInitsOnce(): boolean {
  if (ran) return false;
  ran = true;
  for (const init of initRegistry) init();
  return true;
}
