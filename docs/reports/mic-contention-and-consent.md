# The microphone, and where consent happens

Branch `dev`. Three commits, never pushed, never promoted.

| | |
|---|---|
| `292201b` | fix: one microphone, and a way to prove it from the phone |
| `0c60164` | feat: consent happens on the interpretation, in the sheet |
| `f64e181` | fix: the interpretation takes focus when it lands *(the audit's own finding)* |

---

## PART 0 — the microphone

### The evidence

An operator screen recording: the voice sheet showing **"Listening…"** with a **flatline
waveform** while they spoke for many seconds. No words ever arrived.

### The flatline is the tell

This is the line that separates the mechanism from the last theory. The waveform is not driven
by recognition — it is a **completely independent `getUserMedia` stream** feeding an
`AnalyserNode` (`Waveform.tsx`, as it was: *"The stream is a SECOND consumer of the microphone…
Browsers allow that, and the two are deliberately independent"*).

So if only the recogniser had died, the meter would still have been drawing bars off the
operator's voice. It was flat. **Both consumers were silent at once**, and two independent
consumers of one device failing simultaneously is not two coincidences — it is one audio session
with two claimants.

That rules out (b) and (c) from the brief's suspect list as the *primary* cause, and confirms
(a). It also explains why the fault has been invisible to every test and every desktop check:
Chromium genuinely does permit concurrent captures, and everything in this repo runs on Chromium
or jsdom.

### The mechanism, cited

**Three captures were opened on one tap.**

| # | Where | What |
|---|---|---|
| 1 | `useSpeechInput.prime()` — **added by the previous fix** | `getUserMedia({audio:true})`, tracks stopped immediately |
| 2 | `useSpeechInput.spawn()` | `new webkitSpeechRecognition()` → `rec.start()` |
| 3 | `Waveform.tsx` effect | a second `getUserMedia({audio:true})`, held open for the analyser |

(2) and (3) were live **simultaneously, by design**. On WebKit, which arbitrates a single audio
session per page, the analyser's acquisition interrupts the recognition session — and the
interrupted session's own stream stops delivering, which is the flatline.

And (1) made it worse in two distinct ways, both introduced by the fix that was aimed at this bug:

```ts
// the previous fix, useSpeechInput.ts
if (!canPrime()) { spawn(); return; }
void prime().then((ok) => { if (ok && wantRef.current) spawn(); });
```

- **A getUserMedia teardown is asynchronous.** `prime()` stopped its tracks and resolved, but the
  WebKit audio session was still releasing when `rec.start()` fired. That is exactly the race the
  last fix identified for recognition-on-closing-recognition, reintroduced one layer down between
  a *different* pair of consumers.
- **`spawn()` ran inside a `.then()`** — a microtask after an `await`. WebKit's transient user
  activation does not survive that boundary, so on a **cold** open, where the permission prompt is
  still required, recognition asked for the microphone from a context that no longer counted as
  user-initiated. That is suspect (b) from the brief, and it is real — but it is a consequence of
  the same fix rather than an independent cause.

The previous session's `useLayoutEffect`-less start compounded it: `useEffect` is scheduled after
paint, in a later task than the tap that opened the sheet.

**What I could not establish from the code**, and am not claiming: exactly which of the three
WebKit punishes first on the operator's specific iOS build, and whether the interruption arrives
as `onerror('aborted')`, a bare `onend`, or a silent stall. All three produce the same screen.
That is what the trace is for.

### The instrument, so the next report carries a log

`?mic=trace` on the end of the plan link arms an on-screen event log (`mic-trace.ts`,
`MicTracePanel.tsx`). It is remembered in `sessionStorage` for the tab so the magic-link redirect
cannot drop it, gone when the tab closes, and renders **nothing at all** unless armed — safe to
leave in the build.

It records every acquisition, every lifecycle event and every teardown with a millisecond offset,
and answers the three questions the screen cannot:

- **`gum:open` / `gum:close`** — how many captures are open, and whose.
- **`rec:end` / `rec:error`** — when recognition actually died, and what preceded it.
- **`gum:frames`** — `nonZero/total` samples from the analyser. A flatline with a stream still
  "open" is an *interrupted* stream, not a quiet room. This is the line that distinguishes them.

`copy` puts the whole log on the clipboard.

### The fix

**ONE audio pipeline.**

- **No `getUserMedia` in `useSpeechInput` at all.** The warm-up bought exactly one thing — the
  ability to say "denied" out loud — and `navigator.permissions.query({name:'microphone'})` says
  it for free. A query takes no audio session, spends no user activation, and cannot be
  interrupted. It runs *after* `start()` and can never delay it.
- **`rec.start()` is synchronous on the gesture's own task.** Nothing is awaited before it, and
  the sheet starts from `useLayoutEffect` rather than `useEffect` so it is still the tap's task.
- **The meter runs off the recogniser's own events** (`onspeechstart` / `onspeechend` /
  `onresult`) on every browser not positively established as safe for two captures. No second
  stream. The real analyser is kept on Chromium.
- `audio-contention.ts` is an **allow-list**, not a block-list: iOS Safari, macOS Safari, Chrome
  on iOS, in-app WKWebViews, and anything unrecognised all get one capture. A new engine cannot
  silently reintroduce the fault. Being wrong in the safe direction costs a coarser meter; being
  wrong the other way costs a microphone.

**Is the activity meter honest?** More so than the analyser, arguably. `speaking` is the
recogniser reporting it has detected speech — which is the question the client is actually asking
the meter ("are my words getting in?"). The analyser answers a near-miss of it: amplitude, which
rises for a passing lorry. What it must never do is move when nothing is being heard, and it does
not — `speaking` false holds every bar at the flatline.

**And the heading stopped lying.** `state === 'recording'` means *we asked*. `audioLive`
(`onaudiostart` fired, `onaudioend` not) means the capture actually opened. The sheet was reading
the first and printing "Listening…", which is how the operator came to talk into a dead
microphone under a heading that said everything was fine. It now requires `audioLive`, held
behind a 2.5s grace so the ordinary gap between utterances does not strobe it, and says **"We've
lost the microphone — nothing is reaching us"** when the capture never opened.

### What the operator should verify on device

Acceptance is behavioural: **sheet open → speak → words appear, ten times out of ten.**

1. **Cold start.** Delete the site data (Settings → Safari → Advanced → Website Data), open the
   link, tap the mic. The permission prompt must appear, and after allowing, words must appear.
   *This is the case the gesture-chain break killed, and the one no warm run can test.*
2. **Warm.** Close the sheet, reopen it. Listening should start with no prompt and no pause.
3. **Fast reopen ×10.** Open/close/open as quickly as you can, then speak. This is the teardown
   race; it is the run that used to fail intermittently.
4. **A long pause mid-sentence.** Speak, stop for ~5 seconds, speak again. Both halves must land,
   and the heading must not flicker to "We've lost the microphone".
5. **The meter.** It must be flat when you are silent and moving when you speak. If it moves
   while the room is quiet, the activity mode is wrong and worth reporting.
6. **Backgrounded.** Open the sheet, switch apps, come back. Either it is listening or it says it
   is not — never "Listening…" over nothing.
7. **From Instagram/Mail.** Open the plan link from inside another app (a WKWebView). Same run.
8. **If ANY of these fails**, reopen with `?mic=trace`, reproduce it, tap **copy**, and paste the
   log. The log is the deliverable, not the description.

---

## FIX B — proposals die as a concept on mobile

### What was there

`VoiceSheet.onSubmit` closed the sheet on send. `data.ask` created pending **proposals** and the
surface set a message: *"I've put that up for you. 1 change to approve."* Approvals is a
`PlanDesktop` view. On a phone that sentence pointed at a screen the client could not open, and
the change sat unapplied — the north-star gesture ending in a dead end.

### The consent object

Three things could be shown after somebody speaks, and only one is worth agreeing to:

| | |
|---|---|
| the **transcript** | what they said. They know. It asks them to check our *hearing*. |
| the **intent** | `{action:'move_post', postId:'…', toDate:'2026-08-12'}`. A fact about our datastore. |
| the **interpretation** | *"Move 'Fragrance Note Deep Dive: Summer' → Wed 12 Aug"*. |

Only the third is checkable at a glance, and a misheard word shows up in it as a **wrong title**
rather than as a surprise next week.

### The derivation rule, and how it is enforced

`InterpretedItem` (`agent/types.ts`) carries only computed fields: the action, the **resolved**
post title, **resolved** ISO dates, the format, the refine target. It is built in `turn.ts` at the
point each task resolves — the only place where both the structured task and the post row it
resolved to are in hand. Rebuilding it later from the proposal payload would mean re-reading the
post for its title, and a second read is where a second answer starts.

**`task.reason` is deliberately excluded.** That field is the model's paraphrase of the client's
phrasing — the transcript echo this whole rendering replaces. `screenshot-cases.test.ts` asserts
it does not ride along, by checking the serialised items for the phrase the client used.

`Interpretation.tsx` composes the words from those fields and formats the dates itself, because
date rendering is a property of the surface. Nothing on the wire is a sentence.

### What ambiguity looks like

The honest state the intake receipts already use:

- an unplaceable note → **"Saved to your ideas — couldn't place a date."** Nothing to apply; it is
  already saved.
- an unresolvable reference → the real question, in the list, beside the changes that *did* land.
- **Apply is ABSENT, not disabled**, when nothing is applicable. A primary action that can only
  refuse is worse than no primary action, and the lines above have already said why.

### Apply

Runs the existing machinery: `decide(id, 'approve')` per proposal, **sequentially**. That is
load-bearing — an ask can create a post *and* generate hooks for it, and the hook proposal
resolves its target from the ledger row the add wrote (`proposals.ts`, `refProposalId`). Firing
them together would race the dependency and the second would come back blocked.

A partial failure is reported honestly rather than rolled back: *"2 of 3 changes went through.
The rest are still here."* The changes that landed have landed, and pretending otherwise would
mean a plan that disagrees with its own receipt.

The sheet then closes into the standard what-changed treatment — which is now **confirming what
the list promised**, rather than reporting something the client is seeing for the first time.

Per-item discard is a `reject` on that one proposal row, which is why it was cheap.

**The draft month is deliberately unchanged.** A reshape there applies directly and returns a
receipt; there is nothing to consent to after the fact, and asking would be asking about
something already done. `onSubmit` returning no items closes the sheet, which is that shape.

### "Approve" is fenced

`terminology.fence.test.ts` gains `approve/approved/approval/approvals`, **scoped to the voice
flow** — `VoiceSheet`, `Interpretation`, `AgentVoice`, `Feedback`, `CommittedSurface`,
`DraftSurface`. The scope is the argument: `PlanDesktop` and `ExtractionSummary` have a real
review queue and their copy is correct for what it does; renaming that would be renaming a real
concept to satisfy a rule about a different surface.

The fence caught the framing blurb on its first run — *"we'll put the change up for you to
approve"* — which had been promising a desktop review queue to a client on a phone since the
sheet shipped. It now says what happens: *"I'll show you exactly what I'll change before anything
moves."*

---

## The audit — changed components

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 3 | One real defect, found here and fixed: the phase switch stranded focus |
| 2 | Performance | 4 | One fewer stream and one fewer `AudioContext` on WebKit than before |
| 3 | Theming | 4 | Detector clean; the tokens fence caught an alpha-on-ink and it was fixed |
| 4 | Responsive | 4 | Nothing new is fixed-width; asserted at 320px |
| 5 | Implementation integrity | 4 | Detector: 0 findings across every changed component |
| **Total** | | **19/20** | Excellent |

### The finding, and it was mine

**[P1] The interpretation did not take focus when it appeared.**
`Interpretation.tsx` · Accessibility · WCAG 2.4.3 (Focus Order)

The client presses Send; the control they pressed is unmounted; the sheet's focus trap runs on
**open**, so it does not re-place focus when the sheet's entire body is replaced mid-life. A
keyboard or screen-reader user got a brand-new decision in front of them with focus on `<body>`.

Fixed: the region takes focus, `tabIndex={-1}`, `preventScroll` as everywhere else on this
surface. **Not the Apply button** — landing there is one Enter from changing their plan without
having read a word of what it says. The region is the thing to read, so the region is the thing
to focus.

### Also caught, by the fences rather than by me

- **`text-coral-800/70`** on the per-item discard control — alpha on an ink utility, which
  `tokens.fence.test.ts` bans. Replaced with a solid tier.
- **A leaked promise** in the new 320px test: it returned `act(...).then(...)` instead of
  awaiting, and the pending chain broke the *next* test in the file. Real, and the kind that
  looks like a product bug for an hour.

### Verified, not assumed

- **Contrast.** The interpretation reuses the agent register: `accent-800` on `accent-100` at
  **6.67:1**, the pairing the spec checks by name. Apply is `accent-650` + white at **3.40:1**,
  the recorded filled-control deviation.
- **Touch targets.** Apply and Discard at 52px; per-item discard is a 44×44 box around a small
  glyph, visually inert.
- **Announcement.** The interpretation is `role="status"` + `aria-live="polite"` with **no**
  `aria-atomic` — it appears whole once and then only shrinks, so the default (announce what
  changed) is right. The per-item control carries the line it would remove in its label.
- **One less capture.** On WebKit the sheet now opens **zero** `getUserMedia` streams;
  `one-capture.interaction.test.tsx` counts them.

### What the audit could not cover

Nothing here measured a frame or an audio session. jsdom has no `AudioContext` and no arbitration
policy, and Chromium — where the e2e runs — is precisely the engine that does *not* exhibit the
bug. **Every claim about WebKit in this report is reasoned from the code and from the shape of
the evidence, not observed.** The trace exists because that gap cannot be closed from here.

---

## Gates

| gate | result |
|---|---|
| `tsc --noEmit` | clean |
| unit / interaction | **867 passed**, 14 skipped |
| tokens fence | 10 passed |
| terminology fence | 6 passed — now including approve/approval in the voice flow |
| draft invisibility | 5 passed |
| detector | 0 findings on `Interpretation`, `VoiceSheet`, `Waveform`, `AgentVoice`, `MicTracePanel`, `audio-contention` |

**Fence proof.** `git diff HEAD~3 -- app/src/lib/draft-invisibility.test.ts
app/src/components/plan/surface/tokens.fence.test.ts` is **empty**. The terminology fence was
edited only to add a rule, never to relax one.

### Pre-existing, and not fixed here

`src/lib/edit-scope.test.ts` and `src/lib/post-generation.test.ts` fail on a missing
`DATABASE_URL`. Unchanged from the last two sessions; they fail identically on a clean tree.

### Deliberate test changes, and the argument for each

1. **`sheets.interaction.test.tsx`** — *"reports what the agent DID, and says the change is
   waiting rather than done"* asserted the toast contained "1 change to approve." It was right
   that nothing may claim to have applied, and that half still holds. It was wrong about where
   the client goes next. Replaced by three tests: the interpretation renders and applies nothing;
   Apply executes and the receipt confirms; Discard rejects.
2. **`voice-sheet.interaction.test.tsx`** — the blurb assertion required the word "approve".
3. **The `FakeRecognition` fakes** now fire `onaudiostart`, because the real API does and the
   sheet requires it. A fake without it models a browser that says "recording" and never
   records — which is the bug, not the baseline.

---

## Still open

- **Nothing in Part 0 is verified on hardware.** The eight steps above are the verification, and
  the trace is there for when one of them fails.
- **The cross-month move limit** still stands (carried from the last session): an in-month move
  works from any month; a move across a month boundary refuses honestly.
- **The desktop Approvals view is now a second consent path** for the same proposals. It is
  correct where it lives, and nothing about this session broke it — but the two flows now express
  different products, and which one survives is a decision worth taking deliberately rather than
  by drift.
