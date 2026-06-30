export function stripBuffers(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return '[binary]';
  if (Array.isArray(value)) return value.map(stripBuffers);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripBuffers(v)]));
  return value;
}
