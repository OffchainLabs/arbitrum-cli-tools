// Stringify top-level mixed, and compact the value we want, other values use 2-space pretty print.
export function stringifyTopLevelMixed(
  obj: Record<string, unknown>,
  options?: { orderedKeys?: string[]; compactKey?: string },
): string {
  const orderedKeys =
    options?.orderedKeys && options.orderedKeys.length > 0 ? options.orderedKeys : Object.keys(obj);
  const compactKey = options?.compactKey ?? 'config';
  const lines: string[] = ['{'];
  orderedKeys.forEach((key, index) => {
    if (!(key in obj)) return;
    const value = (obj as Record<string, unknown>)[key];
    let serializedValue: string;
    if (key === compactKey) {
      serializedValue = JSON.stringify(value);
    } else {
      serializedValue = JSON.stringify(value, null, 2);
    }
    // Indent subsequent lines to align with top-level key (2 leading spaces)
    const adjusted = serializedValue.includes('\n')
      ? serializedValue.replace(/\n/g, '\n  ')
      : serializedValue;
    const line = `  ${JSON.stringify(key)}: ${adjusted}`;
    const isLast = index === orderedKeys.length - 1;
    lines.push(isLast ? line : `${line},`);
  });
  lines.push('}');
  return lines.join('\n');
}
