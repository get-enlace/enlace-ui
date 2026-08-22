/**
 * Static values are always typed by the user as plain text, but the
 * request field they fill may be numeric/boolean per the schema (e.g.
 * `qty: integer`). Send them as-typed and a strict target API — like this
 * project's own sample API — will 400 on `"3"` where it wants `3`. Coerce
 * on the way out instead of only on the way in.
 */
export function coerceStaticValue(raw: string, schemaType: string | undefined): unknown {
  if (schemaType === 'integer' || schemaType === 'number') {
    if (raw.trim() === '') return raw; // let required-field validation see the blank, not 0
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }

  if (schemaType === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return raw;
  }

  return raw;
}
