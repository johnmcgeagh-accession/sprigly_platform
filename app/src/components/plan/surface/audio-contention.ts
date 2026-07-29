'use client';

/**
 * audio-contention.ts — may this browser hold two microphone captures at once?
 *
 * ── The question, and why it has to be asked at all ──────────────────────────────────
 *
 * The voice sheet used to open three captures on one tap: a `getUserMedia` warm-up in
 * `useSpeechInput`, the `SpeechRecognition` session itself, and a second `getUserMedia` in
 * `Waveform` for the analyser. Two of those were live simultaneously by design — the meter's
 * comment said so out loud: *"The stream is a SECOND consumer of the microphone… Browsers allow
 * that."*
 *
 * Chromium does allow it. iOS Safari arbitrates a single audio session per page, and a
 * `getUserMedia` acquisition while `SpeechRecognition` is running interrupts the recognition
 * session — which is precisely the reported symptom: the sheet says "Listening…", the meter
 * flatlines because its own stream has been interrupted too, and no words ever arrive.
 *
 * ── Why this is a positive allow-list and not a block-list ───────────────────────────
 *
 * The safe answer is one capture. A browser we have not established is safe gets the safe
 * behaviour, so a new engine, a new iOS version, or an embedded webview we have never seen
 * cannot silently reintroduce the fault. The cost of being wrong in the safe direction is a
 * coarser meter; the cost of being wrong the other way is a microphone that does not work.
 *
 * This is user-agent sniffing, and it is the right tool here for one reason: the thing being
 * detected is not a feature, it is an *arbitration policy*, and there is no capability query for
 * it. Anything we could feature-detect would require opening the second capture to find out —
 * which is the very act that breaks it.
 */

/**
 * Chromium (desktop or Android) reports both `chrome/` and no `Version/…Safari` pairing, and is
 * the only family we have positively established coexistence on. Everything else — iOS Safari,
 * macOS Safari, every WKWebView-based in-app browser, and anything unrecognised — gets one
 * capture.
 *
 * iOS in-app browsers matter here specifically: a client opening the plan link from Instagram or
 * Mail gets a WKWebView, which shares WebKit's single-audio-session behaviour while carrying a
 * user-agent string that mentions neither Safari nor Chrome in the usual places.
 */
export function canRunTwoCaptures(
  ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  /**
   * Touch points, for the iPadOS case only — an iPad on 13+ reports a Macintosh user-agent, and
   * this is the documented way to tell one from a real Mac.
   *
   * It is a PARAMETER rather than a read of the live `navigator` because those two facts have to
   * describe the same device. Reading the global while accepting a `ua` argument meant a test
   * passing a desktop Chrome string was answered against whatever touch count the environment
   * happened to have — which is not a test of anything.
   */
  touchPoints: number = typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints ?? 0),
): boolean {
  const s = ua.toLowerCase();
  // Any Apple mobile device is WebKit whatever the browser claims — Chrome on iOS is WKWebView.
  if (/iphone|ipad|ipod/.test(s)) return false;
  if (/macintosh/.test(s) && touchPoints > 1) return false;
  if (/\bcrios\b|\bfxios\b/.test(s)) return false;
  // Desktop Safari is WebKit too, and we have not established it. Named rather than defaulted,
  // so the reason is on the record: same engine, same audio-session model, untested.
  if (/safari/.test(s) && !/chrome|chromium|edg\//.test(s)) return false;
  return /chrome|chromium|edg\//.test(s);
}
