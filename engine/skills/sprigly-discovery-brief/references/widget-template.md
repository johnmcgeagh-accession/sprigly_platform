# Sprigly discovery brief — widget template

This is the canonical HTML structure for the discovery brief widget. Adapt the content to the prospect; keep the structure, brand tokens, and styling exactly as below.

## Brand tokens

- Coral primary: `#E87766`
- Navy headlines/body: `#1E2A4A`
- Amber accent: `#F59E0B`
- Off-white surface: `#F7F5F0` / `#FAF6F0` (interchangeable for stat cards)
- Primary type: Plus Jakarta Sans (weights 400, 500, 600)
- Editorial accent: DM Serif Display (use sparingly — header company name + one-question card only)

## Structural rules

1. Single `<h2 class="sr-only">` accessibility summary at the top
2. Google Fonts link for Plus Jakarta Sans + DM Serif Display
3. One `<style>` block with class definitions
4. Coral header block with sprig SVG mark
5. Stat card grid (6 cards, `repeat(auto-fit, minmax(120px, 1fr))`)
6. Tab buttons row
7. Six tab panels, only first active by default
8. Vanilla JS tab switcher at the bottom

## Pipeline accent rule

- Pipeline 1 (primary, highest fit): coral `#E87766` left border, `pill-coral` badge
- Pipeline 2 (secondary): navy `#1E2A4A` left border, `pill-navy` badge
- Pipeline 3 (strategic): amber `#F59E0B` left border, `pill-amber` badge

If only 2 pipelines warranted, drop the amber one. If only 1, just use coral.

## Card border accent rule

When using a left-border accent (`border-left: 3px solid #COLOR`), always pair it with `border-radius: 0 var(--border-radius-lg) var(--border-radius-lg) 0` to avoid rounded corners on the accented side.

## Icon usage

Use Tabler outline icons inline. Always pair with `aria-hidden="true"`. Common icons for this skill:
- `ti-mail` — customer service / email workflows
- `ti-package` — fulfilment / returns / inventory
- `ti-world` — international / shipping
- `ti-file-text` — copy / content production
- `ti-brand-instagram` — social
- `ti-info-circle` — review / feedback signal
- `ti-bulb` — homework hooks
- `ti-message-circle` — the one question
- `ti-eye-off` — don't mention
- `ti-alert-circle` — risk
- `ti-coin` — pricing
- `ti-users` — decision-makers
- `ti-clock` — trust-pace / timing
- `ti-arrows-maximize` — scope creep
- `ti-search` — competitor risk
- `ti-layout-dashboard` `ti-user` `ti-tools` `ti-arrow-right` `ti-message` `ti-alert-triangle` — tab icons (fixed)

## Full HTML template

Substitute the bracketed `[…]` placeholders. Everything else is exact.

```html
<h2 class="sr-only">Sprigly discovery call prep brief for [COMPANY] ([URL]) with stat cards and six tabs covering exec summary, founder profile, operational tells, pipelines, call tactics and risks.</h2>

<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=DM+Serif+Display&display=swap" rel="stylesheet">

<style>
.sprigly { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
.sprigly * { font-family: inherit; }
.sprigly .editorial { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; }
.tab-btn { background: transparent; border: 0.5px solid var(--color-border-tertiary); padding: 8px 14px; font-size: 13px; color: var(--color-text-secondary); cursor: pointer; border-radius: var(--border-radius-md); font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
.tab-btn:hover { background: #FAF6F0; }
.tab-btn.active { background: #1E2A4A; color: #F7F5F0; border-color: #1E2A4A; font-weight: 500; }
.card { background: var(--color-background-primary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-lg); padding: 14px 16px; }
.card h3 { font-size: 14px; font-weight: 500; margin: 0 0 8px; color: #1E2A4A; }
.card p { font-size: 13px; line-height: 1.6; margin: 0 0 6px; color: var(--color-text-primary); }
.card p.muted { color: var(--color-text-secondary); }
.card ul { margin: 4px 0 0; padding-left: 18px; }
.card li { font-size: 13px; line-height: 1.6; margin-bottom: 4px; color: var(--color-text-primary); }
.coral-em { color: #E87766; font-style: italic; font-weight: 500; }
.label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-secondary); margin: 0 0 4px; font-weight: 500; }
.pill { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #FAF6F0; color: #1E2A4A; margin-right: 6px; border: 0.5px solid rgba(30,42,74,0.15); }
.pill-coral { background: #E87766; color: #F7F5F0; font-weight: 500; border-color: #E87766; }
.pill-navy { background: #1E2A4A; color: #F7F5F0; font-weight: 500; border-color: #1E2A4A; }
.pill-amber { background: #F59E0B; color: #1E2A4A; font-weight: 500; border-color: #F59E0B; }
.pipeline-card-coral { border-left: 3px solid #E87766; border-radius: 0 var(--border-radius-lg) var(--border-radius-lg) 0; }
.pipeline-card-navy { border-left: 3px solid #1E2A4A; border-radius: 0 var(--border-radius-lg) var(--border-radius-lg) 0; }
.pipeline-card-amber { border-left: 3px solid #F59E0B; border-radius: 0 var(--border-radius-lg) var(--border-radius-lg) 0; }
.tab-panel { display: none; }
.tab-panel.active { display: grid; gap: 12px; }
.stat-card { background: #FAF6F0; border-radius: var(--border-radius-md); padding: 12px; border: 0.5px solid rgba(30,42,74,0.08); }
.stat-card .label { color: #1E2A4A; opacity: 0.7; }
.stat-card .value { font-size: 22px; font-weight: 500; margin: 0; color: #1E2A4A; }
.stat-card .sub { font-size: 11px; color: #1E2A4A; opacity: 0.6; margin: 2px 0 0; }
</style>

<div class="sprigly" style="padding: 1rem 0;">

  <div style="background: #E87766; border-radius: var(--border-radius-lg); padding: 18px 20px; margin-bottom: 1rem; display: flex; align-items: center; gap: 14px;">
    <svg width="32" height="40" viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="flex-shrink: 0; opacity: 0.4;">
      <path d="M16 4 C 10 8, 7 14, 8 20 C 9 24, 13 26, 16 26 C 19 26, 23 24, 24 20 C 25 14, 22 8, 16 4 Z" fill="#F7F5F0"/>
      <path d="M16 26 L 16 36" stroke="#F7F5F0" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <div style="flex: 1;">
      <p style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #F7F5F0; opacity: 0.8; margin: 0 0 4px; font-weight: 500;">Sprigly · Discovery prep</p>
      <h1 class="editorial" style="font-size: 26px; margin: 0 0 4px; color: #F7F5F0; line-height: 1.1;">[COMPANY] <span style="font-style: italic; opacity: 0.85;">— [URL]</span></h1>
      <p style="font-size: 13px; color: #F7F5F0; opacity: 0.9; margin: 0;">[FOUNDER NAME] · [POSITIONING] · [LOCATION]</p>
    </div>
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-bottom: 1.25rem;">
    <div class="stat-card">
      <p class="label">[STAT 1 LABEL]</p>
      <p class="value">[VALUE]</p>
      <p class="sub">[SUB]</p>
    </div>
    <!-- 5 more stat cards -->
  </div>

  <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 1rem;">
    <button class="tab-btn active" data-tab="exec"><i class="ti ti-layout-dashboard" style="font-size:14px; vertical-align:-2px; margin-right:4px" aria-hidden="true"></i>Exec summary</button>
    <button class="tab-btn" data-tab="founder"><i class="ti ti-user" style="font-size:14px; vertical-align:-2px; margin-right:4px" aria-hidden="true"></i>Founder</button>
    <button class="tab-btn" data-tab="ops"><i class="ti ti-tools" style="font-size:14px; vertical-align:-2px; margin-right:4px" aria-hidden="true"></i>Ops tells</button>
    <button class="tab-btn" data-tab="pipelines"><i class="ti ti-arrow-right" style="font-size:14px; vertical-align:-2px; margin-right:4px" aria-hidden="true"></i>Pipelines</button>
    <button class="tab-btn" data-tab="tactics"><i class="ti ti-message" style="font-size:14px; vertical-align:-2px; margin-right:4px" aria-hidden="true"></i>Call tactics</button>
    <button class="tab-btn" data-tab="risks"><i class="ti ti-alert-triangle" style="font-size:14px; vertical-align:-2px; margin-right:4px" aria-hidden="true"></i>Risks</button>
  </div>

  <div id="panel-exec" class="tab-panel active">
    <!-- 4-5 cards: what they do, local/spelling intel, revenue model, distinctive -->
  </div>

  <div id="panel-founder" class="tab-panel">
    <!-- 5 cards: background (with employer pills), voice & tone, public profile, self-named pain points, what they care about -->
  </div>

  <div id="panel-ops" class="tab-panel">
    <!-- 5-6 cards with icons, each a specific operational sink with evidence -->
  </div>

  <div id="panel-pipelines" class="tab-panel">
    <div class="card pipeline-card-coral">
      <span class="pill pill-coral">Pipeline 1 · Primary</span>
      <h3 style="margin-top: 8px;">[PIPELINE NAME]</h3>
      <p class="muted" style="font-size: 12px;">[ONE-LINE QUALIFIER]</p>
      <p style="margin-top: 8px;"><strong style="font-weight:500;">Brief in:</strong> [...]</p>
      <p><strong style="font-weight:500;">Trigger:</strong> [...]</p>
      <p><strong style="font-weight:500;">Work out:</strong> [...]</p>
      <p><strong style="font-weight:500;">Replaces:</strong> [...]</p>
      <p><strong style="font-weight:500;">Why it fits:</strong> [...]</p>
    </div>
    <!-- Pipeline 2 navy + Pipeline 3 amber (if warranted) -->
  </div>

  <div id="panel-tactics" class="tab-panel">
    <div class="card">
      <h3><i class="ti ti-bulb" style="font-size:16px; vertical-align:-2px; margin-right:4px; color:#E87766" aria-hidden="true"></i>Three homework hooks</h3>
      <ul>
        <li><strong style="font-weight:500;">[HOOK 1 LABEL]</strong> — "[OPENING LINE]"</li>
        <li><strong style="font-weight:500;">[HOOK 2 LABEL]</strong> — "[OPENING LINE]"</li>
        <li><strong style="font-weight:500;">[HOOK 3 LABEL]</strong> — "[OPENING LINE]"</li>
      </ul>
    </div>
    <div class="card pipeline-card-coral">
      <h3><i class="ti ti-message-circle" style="font-size:16px; vertical-align:-2px; margin-right:4px; color:#E87766" aria-hidden="true"></i>The one question</h3>
      <p class="editorial" style="font-size: 16px; color: #1E2A4A; line-height: 1.4; margin: 4px 0 8px;">"[THE QUESTION]"</p>
      <p class="muted" style="font-size: 12px;">[WHY THIS QUESTION]</p>
    </div>
    <div class="card" style="border-left: 3px solid #F59E0B; border-radius: 0 var(--border-radius-lg) var(--border-radius-lg) 0;">
      <h3><i class="ti ti-eye-off" style="font-size:16px; vertical-align:-2px; margin-right:4px; color:#F59E0B" aria-hidden="true"></i>Don't mention</h3>
      <ul>
        <li>[TOPIC TO AVOID]</li>
      </ul>
    </div>
    <div class="card" style="background: #1E2A4A; border-color: #1E2A4A;">
      <h3 style="color: #F7F5F0;">The three-fragment close</h3>
      <p style="color: #F7F5F0; opacity: 0.9; margin: 0;">End the call the Sprigly way: <span style="color: #E87766; font-weight: 500;">20 minutes. Free. No pitch.</span> Next step is the Audit, one page, by end of week.</p>
    </div>
  </div>

  <div id="panel-risks" class="tab-panel">
    <!-- 5-6 cards: vertical fit, price sensitivity, decision-making, trust-pace, scope creep, competitor risk -->
  </div>

</div>

<script>
document.querySelectorAll('.tab-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    var tab = btn.getAttribute('data-tab');
    document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.remove('active'); });
    var panel = document.getElementById('panel-' + tab);
    if (panel) panel.classList.add('active');
  });
});
</script>
```

## Card patterns

### Standard card
```html
<div class="card">
  <h3>[Title]</h3>
  <p>[Body]</p>
</div>
```

### Card with employer/tag pills
```html
<div class="card">
  <h3>Background</h3>
  <p>[Bio]. 12+ years at <span class="pill">Employer1</span><span class="pill">Employer2</span><span class="pill">Employer3</span>.</p>
</div>
```

### Card with coral italic emphasis (founder quote, key framing)
```html
<div class="card">
  <h3>Self-named pain points</h3>
  <p>2019 interview: <span class="coral-em">"[direct quote]"</span></p>
</div>
```

### Card with icon header (ops tells, tactics, risks)
```html
<div class="card">
  <h3><i class="ti ti-mail" style="font-size:16px; vertical-align:-2px; margin-right:4px; color:#E87766" aria-hidden="true"></i>[Title]</h3>
  <p>[Body]</p>
</div>
```

## Voice checklist for card copy

Before writing each card, mentally check:
- Short sentences. One idea each.
- Concrete specifics over vague claims. Numbers, names, direct quotes preferred.
- No "seamlessly", "unlock", "empower", "game-changing", "solutions"
- No hedging ("might be worth considering"). Say it or don't.
- Founder-to-founder tone. Not consultant-speak.
- If a card could apply to any company in any industry, it's too generic — rewrite.
