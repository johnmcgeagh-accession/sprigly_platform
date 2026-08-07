/**
 * json-salvage.ts — recover the model's ANSWER from a response that is not only JSON.
 *
 * Four call sites asked a model for one JSON object and got prose around it. Each grew the
 * same salvage independently:
 *
 *     if (!raw.startsWith('{')) { slice first '{' to last '}' }
 *     JSON.parse(raw)
 *
 * and each inherited the same blind spot, which reached production through the decomposer:
 * a model that SELF-CORRECTS emits two complete objects with a sentence between them —
 *
 *     {"parts":[ …a coarse 3-way split… ]}
 *
 *     Wait, I need to re-examine this more carefully and split each instruction separately.
 *
 *     {"parts":[ …the correct 7-way split… ]}
 *
 * That output starts with '{', so the salvage branch never ran, JSON.parse saw two objects
 * and threw at position 843, and a six-item client brief fell to `couldnt_apply`. The second
 * object was correct and complete. Nothing was wrong with the model's answer — we discarded
 * it. (docs/reports/brief-decomposer.md; the UAT bytes are pinned in brief-decompose.test.ts.)
 *
 * The rule: A SELF-CORRECTION SUPERSEDES WHAT IT CORRECTS. Take the LAST complete top-level
 * object, not the first, and never first-brace-to-last-brace — that span covers BOTH objects
 * and parses as neither.
 *
 * ── WIDENING THE SCAN CANNOT NARROW THE RESULT ───────────────────────────────────
 *
 * This matters most on the classifier path, which runs on every input the product takes, so
 * state it plainly: for any response containing exactly ONE complete top-level object — which
 * is every response the three documented shapes (bare, fenced, prose-wrapped) produce — this
 * returns the identical value the old salvage did. It cannot return less. Anything the old
 * code parsed successfully was, by definition, a single complete top-level object, and the
 * scan below finds that object too.
 *
 * The behaviour only differs where the old code THREW or picked wrong: two or more objects.
 * There the last one wins. That is the fix, not a side effect of it.
 *
 * ── WHY THE SCAN IS STRING-AWARE, AND WHY THAT IS NOT PEDANTRY ───────────────────
 *
 * A brace counter that does not know it is inside a string literal will anchor a span
 * mid-string and slice garbage. For the decomposer this is a live hazard, not a theoretical
 * one: every `parts[].text` is a VERBATIM span of the client's own message, and
 * `validateDecomposition` requires those spans be byte-exact substrings of the source. A
 * client can type a brace — and we cannot sanitise it out, because the byte-exactness IS the
 * contract. So the scanner tracks string state and backslash escapes.
 *
 * ── AND WHY IT SCANS FORWARD ─────────────────────────────────────────────────────
 *
 * Scanning back from the end reads like the shorter route to "the last object", but escape
 * handling is only unambiguous left-to-right. Reading a `"` while walking backwards, you
 * cannot tell whether it is escaped without counting the backslashes that precede it, and one
 * miscount anchors the span inside a string. Forward is a single clean pass; the "from the
 * end" part is the candidate WALK, not the scan.
 *
 * ── A TRUNCATED TAIL FALLS BACK INSTEAD OF THROWING ──────────────────────────────
 *
 * `maxTokens` cutting the response mid-second-object is a real shape — the emphasis-field
 * overrun in intake-classify.ts is the same family of systematic-output problem. An unclosed
 * object never reaches depth 0, so it contributes no candidate at all, and the last COMPLETE
 * object is returned. A coarse answer beats a thrown one, and the callers' own validators
 * (`validateDecomposition`, the zod schemas) still decide whether it is good enough.
 *
 * ── FENCES ARE THE SECOND DOOR TO THE SAME BUG ───────────────────────────────────
 *
 * The old fence regex was non-greedy and unanchored, so it matched the FIRST ```-block. A
 * model that self-corrects in two fenced blocks therefore handed back the block it had just
 * disowned — the identical defect wearing a different hat. Fenced blocks are still honoured
 * (an explicit delimiter beats a heuristic, and prose after a fenced answer may legitimately
 * contain braces), but ALL of them are collected and the last parseable object wins.
 */

/**
 * The complete top-level JSON objects in `text`, in source order, as raw substrings.
 *
 * Depth 0→1 opens a span, 1→0 closes it. Braces inside string literals are inert, and a
 * backslash escapes the next character. An object left unclosed at the end of the input
 * contributes nothing — see the truncated-tail note above.
 */
function sliceObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (c === '}') {
      if (depth === 0) continue;                 // a stray closer in prose, not our object
      depth--;
      if (depth === 0 && start !== -1) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

/**
 * Candidate JSON objects from a model response, in source order — last is the model's final
 * word. Fenced blocks win when present: an explicit delimiter beats a scan of the whole text,
 * and prose following a fenced answer may contain braces of its own.
 */
export function jsonObjectCandidates(text: string): string[] {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1] ?? '');
  const fromFences = fenced.flatMap(sliceObjects);
  return fromFences.length > 0 ? fromFences : sliceObjects(text);
}

/**
 * Parse the LAST complete top-level JSON object in a model response.
 *
 * Walks candidates newest-first and returns the first that parses, so a self-correction
 * supersedes what it corrects while a malformed final object still falls back to an earlier
 * good one. Throws when nothing parses — every caller already treats a throw as "unusable
 * output" and has its own fallback.
 */
export function parseLastJsonObject(text: string): unknown {
  const candidates = jsonObjectCandidates(text);
  let lastErr: unknown;
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(candidates[i]!) as unknown;
    } catch (err) {
      if (lastErr === undefined) lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new SyntaxError('no parseable JSON object in model output');
}
