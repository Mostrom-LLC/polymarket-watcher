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

## License

MIT
