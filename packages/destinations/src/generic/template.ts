export function substituteTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, path: string) => {
    const value = resolveDotPath(vars, path);
    return value != null ? String(value) : '';
  });
}

function resolveDotPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
