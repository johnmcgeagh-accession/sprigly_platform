/**
 * Generic parser for the "subject prefix + structured body" email pattern.
 *
 * Field detection rule
 * --------------------
 * A line (after trimming) is a new field declaration when:
 *   1. The part before the first `:` matches ^[A-Za-z][A-Za-z ]*$ (letters
 *      and spaces only, starting with a letter)
 *   2. The character immediately after `:` is a space or end of line
 *
 * This intentionally excludes:
 *   - Lines with digits before the colon: "2:1 ratio", "3rd point:"
 *   - Colons not followed by a space: "https://...", "site:linkedin.com"
 *
 * Indented labels ("  URL: ...") are treated as continuation lines because
 * the trimming step is applied before the regex, so the rule correctly rejects
 * indented leading whitespace — wait, actually we trim before testing, so
 * "  URL: ..." trimmed is "URL: ..." which WOULD match. The real protection
 * against indented lines is that we trim the raw line and test the result, so
 * "  URL: value" DOES get detected as a field. This is deliberate: indented
 * fields are still valid declarations. Email reply-quoting artifacts ("> URL:")
 * are not detected because ">" fails the letter-only test.
 *
 * Multi-line values
 * -----------------
 * Non-field, non-empty continuation lines after a field declaration are
 * accumulated. Blank continuation lines are preserved as paragraph separators
 * (\n\n) rather than stripped — the Notes and Why fields are often
 * multi-paragraph commentary, and downstream prompts benefit from seeing the
 * user's paragraph structure. Consecutive blank lines collapse to one.
 *
 * Unknown field labels are parsed into their own accumulation bucket and then
 * silently discarded. This prevents continuation lines for unknown fields from
 * being appended to the previous known field.
 */

export interface EmailInputSpec {
  subjectPrefix: string;
  bodyFields: BodyFieldSpec[];
}

export interface BodyFieldSpec {
  key: string;
  aliases?: string[];
  required?: boolean;
}

export interface ParsedEmailInput {
  primaryValue: string;
  bodyFields: Record<string, string | undefined>;
}

export function parseEmailInput(
  subject: string,
  body: string,
  spec: EmailInputSpec,
): ParsedEmailInput | null {
  if (!subject.toLowerCase().startsWith(spec.subjectPrefix.toLowerCase())) return null;

  const primaryValue = subject.slice(spec.subjectPrefix.length).trim();
  if (primaryValue === '') return null;

  const aliasMap = buildAliasMap(spec);
  const foundFields: Record<string, string> = {};

  const lines = body.split(/\r?\n/);

  // labelLower: the lowercased email label (e.g. "meeting date").
  // May be a known alias or unknown. null = before any field declaration.
  let currentLabel: string | null = null;
  let currentLines: string[] = [];

  const saveField = (): void => {
    if (currentLabel === null) return;
    const value = joinLines(currentLines);
    const canonicalKey = aliasMap.get(currentLabel);
    if (value !== '' && canonicalKey !== undefined) {
      foundFields[canonicalKey] = value;
    }
    currentLabel = null;
    currentLines = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const detected = detectFieldLine(trimmed);

    if (detected !== null) {
      saveField();
      currentLabel = detected.labelLower;
      currentLines = detected.value !== '' ? [detected.value] : [];
    } else if (currentLabel !== null) {
      // Accumulate: push trimmed line (empty string for blank lines).
      // joinLines will later convert consecutive blanks to \n\n.
      currentLines.push(trimmed);
    }
    // Lines before the first field declaration are ignored.
  }
  saveField();

  return { primaryValue, bodyFields: foundFields };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildAliasMap(spec: EmailInputSpec): Map<string, string> {
  const map = new Map<string, string>();
  for (const field of spec.bodyFields) {
    map.set(field.key.toLowerCase(), field.key);
    for (const alias of field.aliases ?? []) {
      map.set(alias.toLowerCase(), field.key);
    }
  }
  return map;
}

// A line is a field declaration if the part before ':' contains only letters
// and spaces (starting with a letter) and ':' is followed by a space or EOL.
// This means "2:1", "https://...", "site:linkedin.com" are all continuations.
function detectFieldLine(trimmedLine: string): { labelLower: string; value: string } | null {
  const colonAt = trimmedLine.indexOf(':');
  if (colonAt === -1) return null;

  const labelPart = trimmedLine.slice(0, colonAt);
  if (!/^[A-Za-z][A-Za-z ]*$/.test(labelPart)) return null;

  const afterColon = trimmedLine.slice(colonAt + 1);
  if (afterColon.length > 0 && afterColon[0] !== ' ') return null;

  return { labelLower: labelPart.trim().toLowerCase(), value: afterColon.trim() };
}

// Joins accumulated lines into a final value string.
// Blank lines are preserved as paragraph separators (\n\n).
// Consecutive blank lines are collapsed to one.
// Leading and trailing blank lines are dropped.
function joinLines(lines: string[]): string {
  const parts: string[] = [];
  let pendingBlank = false;

  for (const line of lines) {
    if (line === '') {
      pendingBlank = true;
    } else {
      if (pendingBlank && parts.length > 0) {
        parts.push(''); // blank line = paragraph break
      }
      parts.push(line);
      pendingBlank = false;
    }
  }

  return parts.join('\n');
}
