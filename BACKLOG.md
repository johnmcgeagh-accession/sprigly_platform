# Sprigly Backlog

Running list of work to do, in rough priority order within each section. Items marked **NEXT** are the immediate focus.

---

## 🚧 In flight / next up

- **NEXT: Option 1 — second non-blog workflow on generic output table.** Validate the engine with a workflow that writes to `workflow_outputs` (not a specialised table). Probably migrate or rebuild `sprigly-prospect-research` to use the generic path. Proves the abstraction holds before building the paid product.

- **NEXT: Option 2 — client email drafting product.** The actual paid Sprigly service. Reads emails from a client mailbox, drafts replies, writes to Drafts folder, approval-gated. FCA-aware. Bigger scope. After Option 1.

---

## 🔥 High priority — data hygiene and security

- **Stop persisting every polled email.** Currently every email read by the Gmail poller creates an `incoming_events` row, including ones that don't match any routing rule (visible in logs as `no matching rules`). This bloats the DB and processes data without purpose. Change: route in memory first, only persist `incoming_events` if at least one rule matches. Emails that don't match should be marked as read in Gmail (so they don't re-poll) but leave no DB record.

- **Resolve Opus 4.7 availability.** AWS Bedrock returns `AccessDeniedException` for Opus 4.7 on our account. No current workflow needs Opus, but worth resolving before one does. Action: open AWS Support case under Account & Billing → "Cannot subscribe to Bedrock Marketplace models." Include account ID, region, model ID, and that Haiku and Sonnet work fine.

- **Quarterly key rotation reminder.** Both `sprigly-bedrock-worker` and `sprigly-kms-tokens` IAM users have long-lived access keys. Calendar reminder every 90 days to rotate. Eventually move to IAM Roles Anywhere or AWS workload identity for short-lived credentials.

- **Cost precision in audit logger.** `computeCostPence()` uses `Math.ceil` which rounds every sub-penny call up to 1p. Internal audit is fine, but if cost is ever surfaced to clients ("your usage cost was £X this month"), this systematically overstates. Either store cost in thousandths-of-a-penny (integer) or sum raw float costs and round at display time.

---

## 🟡 Medium priority — operational improvements

- **Google OAuth app verification.** Our OAuth consent screen is in "Testing" mode — tokens expire after 7 days and only pre-approved test users can authorise. Before onboarding paying clients, submit the app for Google's OAuth verification process (requires privacy policy URL, app description, and a security assessment for sensitive scopes including `gmail.modify`). Estimated 4-6 week review time; start early.

- **Restore Watch Paths in Railway.** Cleared during Docker debug. Worker should only rebuild when `/apps/worker/**`, `/packages/**`, `/pnpm-lock.yaml`, `/package.json`, `/Dockerfile` change. Without this, every push to docs or marketing site rebuilds the worker unnecessarily.

- **Drift detection UI for client-specific prompts.** When a client customises a shared default prompt, we record `copiedFromTemplateId` and `copiedFromVersion`. If the shared default later updates to a newer version, the client-specific copy has "drifted." Build a UI indicator showing "this client prompt was copied from shared v3, current shared is v5 — review?" Don't auto-update; just flag.

- **"Test this routing rule" button in admin.** Currently to test a routing rule, you have to send a real email and wait for the cron to poll. Add a button that synthesises an `IncomingEvent` from a form (subject, body, sender) and runs it through the full router → workflow → destination pipeline in dry-run mode. Massive iteration speed improvement.

- **CloudWatch alarm on Bedrock quotas.** Bedrock has per-minute token rate limits. We're nowhere near them now, but worth alerting when we cross 80% of any limit. Configure once, mostly never thinks about it.

- **Upgrade local Node to 22 LTS.** Worker runs on Node 22 in production (Docker), but local dev is on Node 20. AWS SDK warns about this. Bump local to match production. `brew install node@22 && brew unlink node && brew link node@22`.

- **Audit log cost dashboard.** Audit table captures token counts and cost per call. Build a simple `/admin/costs` page that aggregates: cost per client, cost per workflow, cost per step, daily/weekly/monthly. Helps spot prompt regressions that quietly double cost.

---

## 🟢 Low priority — nice to have

- **OAuth setup flow in admin UI.** Currently `setup-gmail` is a CLI script. For onboarding clients, a UI flow (with Clerk auth gating it) would be cleaner. Click "Connect Gmail" → OAuth dance → tokens stored encrypted via KMS → mailbox shows as connected on client page.

- **Webhook source implementation.** We scaffolded the `Source` interface for non-email triggers. Webhook is the obvious next one to implement — a POST endpoint per routing rule that produces an `IncomingEvent`. Proves the multi-source abstraction.

- **Streaming model responses.** No workflow needs streaming yet. When a workflow surfaces output to a human in real-time (e.g. a "thinking" indicator in a UI), implement `InvokeModelWithResponseStreamCommand` on the Bedrock client.

- **Connection pooler for Postgres.** When Vercel admin's connection count climbs, may need PgBouncer or Railway's pooled connection string. Not an issue yet (single user) but watch for "too many connections" errors.

- **PII auto-redaction in audit log.** Currently audit log stores token counts and metadata, not prompt/output content. If we ever start logging content (for debugging), implement PII redaction — names, emails, phone numbers, addresses redacted by default.

---

## 🔵 Documentation / process

- **DEPLOYMENT.md.** Capture the exact Railway/Vercel deploy setup (Dockerfile pattern, env vars, monorepo build flags). Currently spread across chat history. Will save hours on the next deploy of any kind.

- **CLIENT-ONBOARDING.md.** Step-by-step runbook for onboarding a new paying client: create client row → OAuth → customise prompts → routing rules → test. Refine as we onboard the first few.

- **DPA template review with solicitor.** Before any paying client signs up, the DPA template needs legal review. Sub-processor list, breach notification timelines, audit clauses, liability caps.

- **DPIA template.** Per-client Data Protection Impact Assessment. One-pager that documents what data is processed, lawful basis, transfer mechanisms, risks, mitigations. Required for GDPR for AI-scale processing of personal data.

- **Sub-processor list published on sprigly.co.uk.** Currently in `DATA_HANDLING.md`. Should be a public page clients can link to.

---

## 🐛 Bugs / oddities to investigate

- **Punycode deprecation warning** at worker startup (`(node:15) [DEP0040] DeprecationWarning`). One of our deps (probably googleapis or zod) is using the deprecated module. Annoying but harmless. Track upstream fix.

- **Postgres logs marked as `error` severity in Railway** when they're routine `LOG:` info entries. Cosmetic — Railway's log aggregator misclassifies. Not actionable; document for future-self so we don't chase ghost errors.

---

## 🚀 Future / longer-term

- **L3 readiness: per-client login.** Currently L2 (admin only). For paying clients to self-serve (view their own drafts, approve, see audit), need Clerk multi-tenancy, row-level security in queries scoped to `clientId`, and client-facing UI distinct from admin.

- **Workflow versioning.** Workflows are code today, deployed atomically. Once we have multiple clients on different prompt versions, we may need workflow-level versioning so we can iterate workflow structure without breaking existing clients.

- **Email-drafting product variations.** Once Option 2 ships, sector-specific tunings: solicitor email drafts (precedent-aware), estate agent enquiry drafts (lettings/sales triage), IFA correspondence (FCA disclaimer auto-insertion).

- **Voice and SMS sources.** Twilio integration for SMS triggers. Eventually voice → transcript → workflow. Significant lift; only when a client genuinely needs it.

---

*Last updated: 14 May 2026. Maintained as a working doc — pruned and re-prioritised after each meaningful milestone.*
