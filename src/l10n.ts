/** Separator used by the official localization files. */
export const L10N_SEPARATOR = '┃'

/** Parses a localization file (`key┃value` per line) into a map. */
export function parseL10n(text: string): Map<string, string> {
  const entries = new Map<string, string>()
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const at = line.indexOf(L10N_SEPARATOR)
    if (at <= 0) continue
    entries.set(line.slice(0, at), line.slice(at + L10N_SEPARATOR.length).trim())
  }
  return entries
}
