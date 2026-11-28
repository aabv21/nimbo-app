# Audits

The eight audits made before v1.0.0, each run with a named skill over a fixed commit. Each file lists its scope, its
skill, the date and the commit, then a findings table: id, severity (high, medium or low), location, finding, fix, test
and status. A `fixed` row names the test that pins it; an `accepted` row gives the reason and the cost; a `deferred live`
row needs a hosted project, an account or a device and is a step of [`../owner-session.md`](../owner-session.md#5-live-checks).

| Audit | Covers | Fixed | Accepted | Deferred live |
|---|---|---|---|---|
| [`security.md`](security.md) | The service role, the gateway's JWT check, the monitor's secret, the session on the phone, deep links, logs, `.gitignore`, the supply chain, the export file, Apple 5.1.3 and account deletion | 8 | 9 | 1 |
| [`api.md`](api.md) | The OWASP API Top 10 (2023) over PostgREST and the six Edge Functions | 8 | 15 | 0 |
| [`agent-guardrails.md`](agent-guardrails.md) | The companion's guardrails and the AI red team in three languages | 9 | 13 | 1 |
| [`database.md`](database.md) | RLS, grants, functions, indexes, constraints, the jobs, retention against the privacy policy and `supabase db lint` | 10 | 10 | 2 |
| [`accessibility.md`](accessibility.md) | Tab labels, large text, contrast in the three themes, targets, screen-reader names and announcements, reduce motion | 11 | 7 | 1 |
| [`motion.md`](motion.md) | Every animation against the motion spec, on the UI thread, with its reduced and Dim variants | 5 | 3 | 2 |
| [`react-native-performance.md`](react-native-performance.md) | The lists, the local store's reads, context fan-out, the minute clock, startup and assets | 2 | 9 | 2 |
| [`over-engineering.md`](over-engineering.md) | Dead code, hand-rolled standard library, speculative layers | 4 | 13 | 0 |

The pins each audit added run in the gate and CI ([`../testing.md`](../testing.md)). A new finding goes into its audit's
table, and a change to a control an audit row cites updates that row ([`../../AGENTS.md`](../../AGENTS.md)).
