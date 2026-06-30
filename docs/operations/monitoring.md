# Monitoring

## Admin UI

The admin web app is the primary monitoring interface. All pages under `/admin/` are server-rendered Next.js pages with `dynamic = 'force-dynamic'` and `revalidate = 0` -- they always fetch fresh data.

### Dashboard (`/admin/`)

Shows four stat cards (live counts) and a table of the 10 most recent workflow runs.

| Stat | What it shows | Alert condition |
|---|---|---|
| Active Clients | Count of `clients` rows with `status = 'active'` | Never alerts |
| Events (24h) | Count of `incoming_events` received in the last 24 hours | Never alerts |
| Pending Approvals | Count of `approvals` rows with `status = 'pending'` | Never alerts |
| Gmail Errors (24h) | Count of unresolved `gmail_operation_errors` in last 24 hours | Shown in red if > 0 |

The Gmail Errors counter turning red is the primary signal that the Gmail integration is unhealthy. Any non-zero value warrants investigation.

### Events (`/admin/events` and `/admin/events/[id]`)

The events list shows all `incoming_events` rows. Each row links to the detail page. The detail page shows:
- The raw event content (subject, body, source metadata)
- All `workflow_runs` triggered by this event
- Per-run status (`received`, `running`, `completed`, `failed`, `ignored`)

This is the starting point for debugging why a specific email did or did not trigger a workflow run.

### Workflow Runs (`/admin/workflows`)

Lists `workflow_runs`. Useful for spotting failed runs across all clients.

### Audit Log (`/admin/audit`)

Shows the last 100 rows from `audit_log`, ordered by `created_at DESC`. Columns: action, model ID, tokens in, tokens out, cost (formatted as £X.XX), client name, timestamp.

The audit log is the only place in the UI where per-call costs are visible. It shows both `inputTokens` and `outputTokens` separately, which matters for cost calculation (input and output have different per-token rates).

Actions logged by the current workflows:

| Action | Step |
|---|---|
| `prospect-research` | sprigly-prospect-research, step 1 |
| `prospect-write` | sprigly-prospect-research, step 2 |
| `blog-research` | sprigly-blog-post, step 1 |
| `blog-structure` | sprigly-blog-post, step 2 |
| `blog-write` | sprigly-blog-post, step 3 |
| `meeting-prep-generate` | sprigly-meeting-prep, step 1 (not yet production) |

### Gmail Errors (`/admin/gmail-errors`)

Shows `gmail_operation_errors` rows. Each row records one failed Gmail API operation (mark-as-read, send, create-draft). The `resolved` flag lets you dismiss entries after investigation.

Key columns: `operation` (which Gmail API call failed), `messageId` (the Gmail message ID), `errorMessage`, `resolved`, `createdAt`.

### Prompts (`/admin/prompts` and `/admin/prompts/[id]`)

Shows all `prompt_templates` rows. Click a row to open the editor. Save creates a new version row via `saveNewVersion()`. Prior versions remain in the table and are visible on the list page.

To create a client-specific override: find the global default row, use the "Copy for client" action (if available in the UI), edit the copy.

### Routing Rules (`/admin/routing-rules`)

Shows all `routing_rules` rows. Provides a form to create new rules with condition editor (`/admin/routing-rules/new`). Rules can be enabled/disabled without deletion.

### Clients (`/admin/clients` and `/admin/clients/[id]`)

Shows client config details: brand voice, author name, signature, settings JSONB. Client detail page also shows Gmail connection status.

### Approvals (`/admin/approvals`)

Lists pending approval rows. When a destination has `requiresApproval: true`, the dispatcher creates an `approvals` row instead of delivering immediately. This page shows the output snapshot and lets an operator approve or reject.

---

## Worker logs

The worker uses pino with the logger name `sprigly-worker`. On Railway, logs are visible in the service log panel.

Key log patterns to watch:

| Log message | What it means |
|---|---|
| `Worker starting` | Process started. Normal. |
| `Registered workflows` | Worker initialised successfully. |
| `polled` | Successful poll cycle. Includes `clientId`, `count` (new events), `queued`. |
| `poll failed` | A poll cycle threw. Includes `clientId` and `err`. The next poll cycle will retry. |
| `[engine] WorkflowRunner: run completed` | A workflow run finished. Includes `workflowId`, `runId`. |
| `job failed` | A BullMQ job threw. Includes `eventId`, full error details. The job is marked FAILED. |
| `no matching rules` | An event was dequeued but the routing rule that matched during polling is now disabled. |
| `[engine] DestinationDispatcher: delivery failed` | A destination's `deliver()` threw. The run is NOT marked failed. |
| `Unhandled promise rejection` | A void'd promise rejected. Logged and swallowed. |

---

## Database queries

The admin UI is the primary monitoring surface. For ad hoc investigation, useful queries:

**Failed workflow runs in the last 24 hours:**
```sql
SELECT id, workflow_id, client_id, error, started_at
FROM workflow_runs
WHERE status = 'failed'
  AND started_at > NOW() - INTERVAL '24 hours'
ORDER BY started_at DESC;
```

**Unresolved Gmail operation errors:**
```sql
SELECT client_id, operation, message_id, error_message, created_at
FROM gmail_operation_errors
WHERE resolved = false
ORDER BY created_at DESC;
```

**Total cost by client (last 30 days):**
```sql
SELECT client_id, SUM(cost_pence) AS total_pence, COUNT(*) AS calls
FROM audit_log
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY client_id
ORDER BY total_pence DESC;
```

**Events that were never processed:**
```sql
SELECT id, client_id, source, received_at
FROM incoming_events
WHERE status = 'received'
  AND received_at < NOW() - INTERVAL '10 minutes'
ORDER BY received_at;
```

---

## Cross-references

- `operations/troubleshooting.md` (what to do when the dashboard shows errors)
- `operations/costs.md` (interpreting audit log cost data)
- `reference/database-schema.md` (`audit_log`, `gmail_operation_errors`, `approvals`, `workflow_runs`)
- `infrastructure/destinations.md` (approval gate mechanics)
