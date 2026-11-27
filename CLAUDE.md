# CLAUDE.md: Sentire PMS

Instructions for Claude Code sessions working in this repository. Read this file fully before changing code. The planning documents in `docs/` (Build Plan, Blueprint, System Design) are the source of truth for scope and requirements; this file is the source of truth for how to work.

## 1. What this repo is

Sentire PMS (working name) is an installed, offline-capable property management system for independent Philippine hotels, resorts, inns and hostels: reservations, calendar, check-in and check-out, housekeeping, folios, payments, BIR-ready invoices, a direct booking engine, night audit and reports.

It runs in two places from one codebase:

- **Hub** (`apps/web` in `hub` mode inside the Tauri desktop app on the hotel's Windows PC): the authority for everything at the property; works with no internet; other PCs and tablets connect to it over the hotel network.
- **Cloud** (`apps/web` in `cloud` mode on Dokploy): sync API, booking engine, payment webhooks, backups, owner view; the authority for online bookings and online payments until the hub applies them.

Platform order: Windows desktop with built-in hub (MVP), Android and iPad tablets as hub clients (P2), macOS (later).

Its screens follow the Cloudbeds workflow, recreated from public material only. The visual reference is the mockup at https://claude.ai/artifact/38WkRbrpdW9NDpLtNAgEAf.

Do not copy Cloudbeds code, text, logos, icons or brand names. Recreate layouts and workflows in Sentire's own design.

## 2. Session workflow (always)

1. Start: call Sentire Projects `start_session` with the project key in `.sentire-projects.json`, then `get_project_context`. Pick the issue to work on; move it to In progress.
2. Branch: `pms/<ISSUE-KEY>-short-name` from `main`.
3. Build in small commits. Reference the issue key in every commit message.
4. Before opening a PR: `pnpm lint && pnpm typecheck && pnpm test`. All must pass.
5. Open the PR with "fixes <ISSUE-KEY>" in the description, merge it yourself once CI is green, and watch the Dokploy deployment of `pms-staging` until it is healthy. If it fails, read the build and runtime logs and fix it.
6. Write the UAT workbook for the process (section 13), hand it off, and fix what the UAT run finds. You never mark your own UAT.
7. Update the issue (status, short factual comment) after each finished item, and call `end_session` with what was done and the next steps.
8. Report to the owner after each step of multi-step work. End reports with a numbered list of decisions he needs to make, each with a recommended action.

Never look up or invent issue keys from memory; use `search_issues`.

## 3. Stack

- pnpm monorepo
- Next.js 16 App Router, React, TypeScript (strict); one app, run mode set by `PMS_MODE=hub|cloud`
- Tauri 2 desktop shell (Windows now, macOS later) and mobile shell (Android, iPadOS in P2); Tauri updater with signed releases
- Hub runtime: bundled Node.js running the Next.js standalone server as a Windows service, bundled Postgres 18
- Tailwind CSS with Sentire design tokens from `sentire-kit`
- Cloud database: Postgres 18 (shared Dokploy instance). Hub database: bundled Postgres 18. Same Drizzle schema (`packages/db`), ULID primary keys, migrations applied on boot (on the hub only by the hub service)
- Zod for all input validation (forms, server actions, route handlers, webhooks)
- pg-boss job queue in a separate worker process on both hub and cloud (night audit, sync, backups, emails)
- Sync: own outbox and inbox protocol in `packages/sync`
- RustFS (S3-compatible) for files, Postal for email, Semaphore for SMS
- Payment providers: PayMongo and Maya for Business behind `src/server/payments/provider.ts`
- Tests: Vitest (unit and integration with a real test database), Playwright (end-to-end)

## 4. Commands

```bash
pnpm install
pnpm dev:hub          # app in hub mode on :3000 (local Postgres)
pnpm dev:cloud        # app in cloud mode on :3001 (second local database)
pnpm worker:hub       # hub worker (night audit, sync, backups)
pnpm worker:cloud     # cloud worker (sales guard, emails, webhooks)
pnpm desktop:dev      # Tauri desktop shell pointing at the dev hub
pnpm desktop:build    # Windows installer (CI signs it)
pnpm db:generate      # generate a migration from schema changes
pnpm db:migrate       # apply migrations
pnpm db:seed          # seed the demo property (same data as the mockup)
pnpm lint
pnpm typecheck
pnpm test             # unit + integration
pnpm test:sync        # hub and cloud side by side with network cuts
pnpm test:e2e         # Playwright
```

Local Postgres for both sides: `docker compose up -d` (databases `pms_hub_dev` and `pms_cloud_dev`).

## 5. Folder structure

```
apps/
  web/                         Next.js app (hub and cloud modes)
    src/app/
      (auth)/                  sign-in, invitation, pairing
      p/[propertySlug]/        staff app (hub mode)
      book/[propertySlug]/     public booking engine (cloud mode)
      api/                     sync API (cloud), webhooks (cloud), health, QA endpoints
    src/server/<module>/       iam, property, inventory, rates, reservations, guests,
                               folio, payments, invoicing, housekeeping, night-audit,
                               reports, audit-log, notifications, backups, jobs
    src/worker.ts              pg-boss worker entry
  desktop/                     Tauri 2 shell: hub service manager, pairing, printing, updater
  mobile/                      Tauri 2 mobile shell (P2)
packages/
  core/                        pure domain logic: money, VAT, pricing, policies, state machine
  db/                          Drizzle schema and migrations (shared by hub and cloud)
  sync/                        outbox, inbox, protocol types, apply-once logic
  ui/                          shared components and Sentire tokens
docs/                          build plan, blueprint, system design, uat/
tests/                         unit/, integration/, sync/, e2e/, installer/
```

Module rule: a module calls another module only through that module's exported service functions. Never query another module's tables directly. Code that must run in only one mode checks `isHub()` or `isCloud()` at the module boundary, not deep inside logic.

## 6. Domain rules (do not break)

1. **Money is integer centavos** (`bigint`, names end in `Centavos` / `_centavos`). Use `@sentire-pms/core` (`packages/core/src/money.ts`) for arithmetic and formatting. Never use floating point for money.
2. **VAT** is 12% and rates are VAT-inclusive by default: `vat = roundHalfUp(amount * 12 / 112)` per line.
3. **Senior citizen and PWD:** 20% discount and VAT exemption on the qualifying guest's share; store ID number and name; show on the invoice.
4. **Availability:** every write that changes availability locks the `inventory_days` rows for the room type and dates with `SELECT ... FOR UPDATE` inside the same transaction. Never compute availability in application memory and write later.
5. **Rooms:** unique index on `room_nights (room_id, stay_date)` for active stays. Do not work around a unique violation; return a collision error.
6. **Folio is append-only.** Never UPDATE or DELETE `folio_transactions`, `invoice_lines` or `audit_log`. Corrections are reversing transactions.
7. **Invoice numbers** come only from `invoicing.nextNumber()` (row-locked sequence). Never reuse a number.
8. **Business date** belongs to the property and changes only through night audit. Operational screens use the business date, not `new Date()`.
9. **Dates and time:** timestamps are `timestamptz` in UTC; stay dates are `date`; display in the property time zone (default Asia/Manila).
10. **Reservation status** changes only through `reservations.transition()` which enforces the state machine in the System Design (section 6.1).
11. **Webhooks:** verify the signature, insert into `webhook_events` with unique `(provider, event_id)`, then process in a job. The HTTP handler returns quickly.
12. **Audit:** every create, update, status change and money movement writes an `audit_log` entry with before and after.
13. **Authority split:** the hub owns property operations (reservations made there, rooms, folios, invoices, night audit, business date); the cloud owns online bookings and online payment confirmations until the hub applies them. Never write property operational data directly in the cloud.
14. **Outbox:** every write on the hub goes through the data layer, which inserts an `outbox_events` row in the same transaction. Never write tables in a way that skips the outbox.
15. **Apply once:** inbound events are applied through `sync.applyOnce(eventId, ...)`; never apply an event without recording it in `inbox_events`.
16. **IDs are ULIDs** created where the record is born. Never use database sequences for primary keys.
17. **Invoices only on the hub.** Never issue or number an invoice in the cloud or on a client device.
18. **Online sales guard:** the cloud booking engine must check the hub's last sync time before showing availability; do not bypass the guard in code or tests.
19. **Offline first:** a hub feature must work with the internet off. Anything that needs the internet (pay-by-link, emails, SMS) is queued and shows "will send when online".

## 7. Security rules

- Every server action and route handler starts with `const ctx = await requireTenant()` and `authorize(ctx, '<permission>')`.
- Every repository function takes `ctx` and filters by `organizationId` and `propertyId`. No unscoped queries.
- Card data never reaches our servers; use provider-hosted checkout and tokens only. Payment provider secret keys live only in the cloud, never on a hub.
- Hub: local TLS with the per-property certificate, device tokens from pairing, encrypted data folder and backups.
- ID images and invoices go to the private bucket; serve with short-lived signed URLs.
- Secrets only in Dokploy environment variables. Never print, log or commit secret values. Update `.env.example` with names only.
- Do not ask the owner for secret values in chat; tell him which variable names to set in Dokploy.

## 8. UI rules

- Match the mockup layouts. Neutral greys, orange accent only (`--accent`), Inter font, cards with 12 px radius.
- Status colours: Confirmed blue, Checked in green, Not confirmed amber, Group purple, Out of service red hatched, Checked out grey.
- Accessibility: real buttons and links, labels on every input, 4.5:1 text contrast, keyboard reachable.
- Peso amounts with the peso sign and two decimals; dates like "24 Nov 2026".
- User-facing copy and documents: plain English, no em dashes.

## 9. Testing expectations

- New domain rule: unit test.
- New use case or endpoint: integration test against the test database, including a tenant-isolation case.
- Anything touching inventory: a concurrency test.
- Top flows: keep the Playwright suite green.
- Anything that adds or changes a table or event: a sync test (offline edit, reconnect, both sides match, no double apply).
- Installer changes: install, update and rollback on a clean Windows VM.
- When a test fails, fix the cause and re-run until it passes; do not skip or weaken tests.

## 10. Environments

| Environment | Where | Database | Deploys |
|---|---|---|---|
| Cloud staging | https://pms-staging.apps.sentire.solutions | sentire_pms_staging | every merge to `main` |
| Staging hub (server stand-in for a hotel hub PC; demo data, `PMS_DEMO_SHELL=1`) | https://pms-hub-staging.apps.sentire.solutions | sentire_pms_hub_staging (demo seed) | every merge to `main` |
| Cloud production | https://pms.apps.sentire.solutions | sentire_pms | end of each phase, after UAT passes |
| Test hub | Windows test PC or VM, `beta` update channel, synced to cloud staging | bundled Postgres | every merge (signed installer from CI) |
| Pilot and customer hubs | Hotel PCs, `pilot` then `stable` channel | bundled Postgres | promoted at the end of each phase |

## 11. Out of scope unless the owner asks

Tablet apps (P2), macOS app (later), channel manager, unified inbox, groups, RMS, websites, marketing, POS, AI assistant, and any link to other Sentire products (Ledger, Payroll). Keep this product separate until the owner decides to interconnect.

## 12. Project tracking (Sentire Projects)
This repo is tracked in Sentire Projects; the project key is in .sentire-projects.json.
- At the start of a session, if the SessionStart hook did not already print a briefing with a session_id, call start_session with the project key.
- Keep issues current while you work: move status with update_issue (In progress when you start, In review when a PR is open, Done when merged), add_comment for decisions and blockers, create_issue for bugs or follow-ups you find. Search before creating to avoid duplicates.
- Put the issue key in branch names, commit messages and PR titles (e.g. "PMS-12: add 2316 export"). Write "fixes PMS-12" in the PR body to close it on merge.
- Before finishing, call end_session with a short summary and next steps, passing the session_id.
- Before closing a release milestone, run the security-audit skill on this repo (a quick run scoped to what changed is fine) and import the results with import_security_audit. Open critical or high security issues block the milestone.

## 13. UAT (Sentire UAT Standard v1.0)
Every process that changes what a user sees or does ships with a UAT document. A separate UAT session runs it; you never mark your own UAT. Full rules: docs/uat/UAT_STANDARD.md.
1. Before coding, list the process's acceptance criteria. Each becomes at least one test case.
2. Deploy to the test environment, never production. Confirm the build number shows in the app.
3. Copy docs/uat/UAT_TEMPLATE.xlsx to docs/uat/<process-slug>/UAT_<KEY>_<process-slug>_<build>.xlsx.
4. Fill every Cover field. Write one row per case on Test Cases, columns A to L only; leave M to S empty. Never rename, reorder or merge columns.
5. Follow the case rules: one behaviour per case; exact, checkable expected results; figures computed outside the app; permission and cross-tenant cases; Side Effects on every case; HUMAN: for steps only a person can do; fake data tagged with the case ID; no passwords in the workbook.
6. Meet the Definition of Ready, commit, create the Sentire Projects task "UAT: <process> <build>" (label uat-ready, status In review) with the UAT HANDOFF block, and print the block at the end of your report.
7. After the run: fix with "fixes KEY-n", deploy a new build, and post a UAT RETEST block. Never change an expected result to match the app without the owner's approval.
