// Standalone so both chainExecutor.ts and nodeHandlers.ts can depend on it
// without depending on each other — chainExecutor.ts re-exports both names
// (see its own imports) so `import { getByPath } from './chainExecutor.js'`
// keeps working for every existing caller/test.

/** Minimal dot/bracket path getter, e.g. "items[0].id" or "order.id". */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

  let current: any = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

/** Exported for reuse by utils/bodyTemplate.ts, which needs the same dotted-path write when reconstructing a body from form fieldValues to detect a lossy Raw->Form conversion. */
export function setByPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.').filter(Boolean);
  let current = target;
  parts.forEach((part, i) => {
    if (i === parts.length - 1) {
      current[part] = value;
    } else {
      current[part] = current[part] ?? {};
      current = current[part] as Record<string, unknown>;
    }
  });
}
