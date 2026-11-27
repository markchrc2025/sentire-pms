# Sentire PMS

Installed, offline-capable property management system for independent Philippine hotels, resorts, inns and hostels, with Sentire Cloud for online bookings, payments and backups.

> Working name. Status: planning (24 November 2026). Proprietary software of Sentire Solutions; all rights reserved.

## What it does

- **Works offline:** a Windows PC at the hotel is the property hub; every front desk PC (and, in P2, Android and iPad tablets) connects to it over the hotel network, so operations continue when the internet is down. Changes sync with Sentire Cloud when the connection returns.

- **Front desk:** dashboard, room calendar with drag and drop, reservations, check-in and check-out, registration cards
- **Rates and availability:** rate plans, daily rates and restrictions, bulk updates, deposit and cancellation policies
- **Housekeeping:** mobile room-status board (dirty, clean, inspected)
- **Money:** folios, payments (cash, card, GCash, Maya, bank transfer), pay-by-link, refunds, BIR-ready invoices with VAT and senior citizen / PWD discounts
- **Booking engine:** commission-free direct booking with online deposit
- **Night audit and reports:** automatic day close, revenue, occupancy, payments and BIR sales summary, Excel and PDF exports
- **Users:** one Sentire Account, roles per property, full audit log

Planned for the second release: Android and iPad tablet apps, owner remote view, guest inbox and SMS, channel manager partner for OTAs, city ledger, multi-property tools. Later: macOS app.

## How it runs

| Part | Where | Role |
|---|---|---|
| Desktop app with hub | Hotel's Windows PC | PMS screens, hub service, bundled Postgres, night audit, local backups; works offline |
| Desktop app (client) | Other front desk PCs | Connects to the hub over the hotel network |
| Tablet app (P2) | Android and iPad | Housekeeping and front desk, connected to the hub |
| Sentire Cloud | Dokploy | Sync API, booking engine, payment webhooks, cloud backups, owner view |

## Tech stack

pnpm monorepo. Next.js 16 (App Router) and TypeScript in two run modes (`hub`, `cloud`), Tauri 2 desktop and mobile shells, Tailwind CSS with Sentire design tokens, Postgres 18 with Drizzle ORM (bundled on the hub, shared instance in the cloud), own outbox and inbox sync, pg-boss jobs, RustFS storage, Postal email, Semaphore SMS, PayMongo and Maya for Business, Vitest and Playwright.

## Getting started (development)

Requirements: Node.js 22+, pnpm 9+, Docker, Rust toolchain (for Tauri), Windows 10/11 or a Windows VM for desktop builds.

```bash
git clone https://github.com/markchrc2025/sentire-pms.git
cd sentire-pms
pnpm install
cp .env.example .env.local          # fill in local values
docker compose up -d                # local Postgres with pms_hub_dev and pms_cloud_dev
pnpm db:migrate
pnpm db:seed                        # demo property "Bahay Kubo Suites"
pnpm dev:cloud                      # cloud mode on http://localhost:3001
pnpm dev:hub                        # hub mode on http://localhost:3000, synced to the local cloud
pnpm worker:hub                     # second terminal
pnpm desktop:dev                    # optional: Tauri desktop shell
```

### Environment variables

| Name | Purpose |
|---|---|
| `PMS_MODE` | `hub` or `cloud` |
| `DATABASE_URL` | Postgres connection string |
| `CLOUD_SYNC_URL` | Hub only: Sentire Cloud sync endpoint |
| `HUB_SALES_GUARD_MINUTES` | Cloud only: minutes without sync before online sales stop (default 10) |
| `APP_URL` | Public base URL of the app |
| `SESSION_SECRET` | Signs session cookies |
| `SENTIRE_ACCOUNT_URL`, `SENTIRE_ACCOUNT_CLIENT_ID`, `SENTIRE_ACCOUNT_SECRET` | Sentire Account sign-in (sentire-kit) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | RustFS file storage |
| `POSTAL_URL`, `POSTAL_API_KEY`, `MAIL_FROM` | Email |
| `SEMAPHORE_API_KEY`, `SEMAPHORE_SENDER` | SMS |
| `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET` | PayMongo (cloud only) |
| `MAYA_PUBLIC_KEY`, `MAYA_SECRET_KEY`, `MAYA_WEBHOOK_SECRET` | Maya for Business (cloud only) |
| `SENTRY_DSN` | Error tracking (optional) |

Never commit real values. Cloud values are set in Dokploy. A hub gets its settings during setup and pairing; it never holds payment provider secret keys.

## Scripts

| Command | Does |
|---|---|
| `pnpm dev:hub` / `pnpm dev:cloud` | Development servers in each mode |
| `pnpm worker:hub` / `pnpm worker:cloud` | Job workers |
| `pnpm desktop:dev` / `pnpm desktop:build` | Tauri desktop shell / Windows installer |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` | Migrations and demo data |
| `pnpm lint` / `pnpm typecheck` | Code checks |
| `pnpm test` / `pnpm test:sync` / `pnpm test:e2e` | Unit and integration / sync / Playwright |

## Project structure

```
apps/web/        Next.js app (hub and cloud modes)
apps/desktop/    Tauri desktop shell (Windows, later macOS)
apps/mobile/     Tauri mobile shell (Android, iPadOS; P2)
packages/core/   domain logic (money, VAT, pricing, policies, state machine)
packages/db/     Drizzle schema and migrations
packages/sync/   outbox, inbox and sync protocol
packages/ui/     shared components and Sentire tokens
docs/            build plan, blueprint, system design, UAT documents
tests/           unit, integration, sync, e2e, installer
```

## Deployment

**Cloud** (Dokploy project "Sentire PMS"):

- `pms-staging` deploys on every push to `main` (https://pms-staging.apps.sentire.solutions)
- `pms` (production) deploys at the end of each phase after UAT passes (https://pms.apps.sentire.solutions)
- A cloud worker runs as a second app from the same image
- Health check: `GET /api/health`, monitored by Sentire Cloud; backups follow the Sentire Cloud runbook

**Hub and desktop app:**

- CI builds a signed Windows installer on every merge and publishes it to the `beta` update channel
- Releases are promoted to `pilot`, then `stable`; hubs update themselves and roll back if the health check fails
- Each hub backs up hourly to a local drive and nightly (encrypted) to Sentire Cloud; a replacement PC can be restored from the cloud backup

## Documentation

- `docs/01_Build_Plan.md`: phases, tasks, estimates
- `docs/02_Blueprint.md`: scope, architecture, stack, rules
- `docs/03_System_Design.md`: requirements, actors, use cases, class and activity diagrams
- `CLAUDE.md`: how Claude Code works in this repo
- Mockup: https://claude.ai/artifact/38WkRbrpdW9NDpLtNAgEAf

## Contributing

Work is tracked in Sentire Projects. One branch and one pull request per issue; CI must pass (lint, type-check, tests) before merge. See `CLAUDE.md` for the full workflow and domain rules.
