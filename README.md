# Polymarket Watcher

Autonomous monitoring service for Polymarket prediction markets with AI-powered analysis and Slack notifications.

## Repository Layout

- `application/`: runtime service code, app config, Dockerfile, and tests
- `infrastructure/`: AWS CDK deployment code and local Docker Compose config

## Quick Start

### Application

```bash
cd application
npm install
cp .env.example .env
$EDITOR config/user-config.yaml
npm run dev
```

`config/user-config.yaml` is topic-driven. The `markets[].slug` entries are currently used as topic/category keywords, not exact Polymarket event slugs.

### Infrastructure

```bash
cd infrastructure
npm install
npm run synth
```

### Local Docker

```bash
docker compose -f infrastructure/docker-compose.yml up -d
docker compose -f infrastructure/docker-compose.yml logs -f polymarket-watcher
```

## What It Does

The service currently runs three scheduled jobs:

- `discover-markets`: finds active binary markets that match your configured topics
- `monitor-surveillance`: watches grouped market families and multi-contract markets for anomalous activity
- `daily-summary`: posts a daily operational summary

The surveillance path is family-aware. It treats grouped Polymarket structures such as date-bucket, candidate-field, and range-style event families differently from simple binary yes/no markets.

## Slack Alerts

The app now uses one compact market-activity alert shape.

Current fields:

- `Market`
- `Direction`
- `Price Move`
- `Largest Bet`
- `wallet_age` when available
- `Recommendation`

Current example:

```text
🚨 MARKET ACTIVITY

Market
Military action against Iran ends Mar 21

Direction
Heavy YES buying

Price Move
0.28 → 0.39 (+11 pts)

Largest Bet
$48k YES @ 0.31
wallet_age: 2h

Recommendation
Lean YES
```

The alert links directly to the relevant Polymarket page:

- standalone markets use the market event slug
- grouped surveillance alerts use the family slug plus the impacted child market slug so `Open Market` lands on the specific contract

## Verification

Application verification commands:

```bash
cd application
npm run typecheck
npm run build
set -a && . ./.env && set +a
npm run test
```

That suite includes:

- real Gemini integration tests
- real Polymarket public Data API integration tests
- real Slack post tests against the configured app channel path for the consolidated `MARKET ACTIVITY` alert

## License

MIT
