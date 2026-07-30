/**
 * agent-prose.ts — the agent's free-text answer, made renderable (F7d).
 *
 * A "what's planned this week?" answer comes back from the model as markdown-ish prose —
 * `**Friday 14th:**`, `* Reel — Weekend Style Guide` — and the surface was passing that string
 * to a text node, asterisks and all. The digest the model reads IS structured (a line per post,
 * grouped by date), so the minimal honest rendering is to keep that structure: strip the
 * markdown markers, one line per post, day-group headers kept as headers. The full
 * conversational rendering arrives with the sheet redesign; nothing here should survive it.
 *
 * Pure and small on purpose: this is a formatter, not a markdown engine.
 */

export interface AgentLine {
  text: string;
  /** A day-group header ("Friday 14 August:") rather than a post line. */
  header: boolean;
}

/** Strip the markdown the model writes: bold/italic markers, bullets, heading hashes, backticks. */
export function stripMarkdown(line: string): string {
  return line
    .replace(/^\s*#{1,4}\s+/, '')            // heading hashes
    .replace(/^\s*[•\-*+]\s+/, '')           // bullet markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')       // **bold**
    .replace(/\*([^*]+)\*/g, '$1')           // *italic*
    .replace(/__([^_]+)__/g, '$1')           // __bold__
    .replace(/`([^`]+)`/g, '$1')             // `code`
    .trim();
}

/** The answer as lines: markdown stripped, empties dropped, day headers marked. */
export function agentLines(message: string): AgentLine[] {
  return message
    .split('\n')
    .map((raw) => {
      // A header is a SHORT line ending ':' — the shape the model's day grouping takes
      // ("Friday 14 August:"). A post line with a colon mid-sentence stays a line.
      const wasHeading = /^\s*(#{1,4}\s|\*\*[^*]+\*\*:?\s*$)/.test(raw);
      const text = stripMarkdown(raw);
      return { text, header: !!text && (wasHeading || (/:$/.test(text) && text.length <= 40)) };
    })
    .filter((l) => l.text.length > 0);
}
