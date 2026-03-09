# Polymarket Watcher

Autonomous monitoring service for Polymarket prediction markets with AI-powered analysis and Slack notifications.

## Features

- **Real-time Market Monitoring**: Poll and track prediction market prices and volumes
- **AI-Powered Analysis**: Claude-based analysis of market movements and trends
- **Smart Alerts**: Configurable thresholds for price changes and volume spikes
- **Slack Integration**: Rich notifications with AI summaries
- **Caching**: Redis-backed caching for efficient API usage
- **Workflow Orchestration**: Inngest-powered reliable background processing

## Quick Start

### Prerequisites

- Node.js 20+
- Redis (or Docker)
- Anthropic API key
- Slack Bot token

### Installation

```bash
# Clone the repository
git clone https://github.com/Mostrom-LLC/polymarket-watcher.git
cd polymarket-watcher

# Install dependencies
npm install

# Copy environment file and configure
cp .env.example .env
# Edit .env with your API keys

# Edit market configuration
vim config/user-config.yaml
```

### Development

```bash
# Start development server with Inngest
npm run dev

# Type check
npm run typecheck

# Build for production
npm run build
```

### Docker

```bash
# Build and run with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f polymarket-watcher
```

## Configuration

### Environment Variables

See `.env.example` for all available environment variables.

### User Configuration

Markets and settings are configured in `config/user-config.yaml`:

```yaml
markets:
  - slug: "will-trump-win-2024"
    enabled: true
    thresholds:
      priceChangePercent: 5
      volumeThreshold: 100000
    analysis:
      intervalMinutes: 60

settings:
  pollingIntervalSeconds: 30
  notifications:
    cooldownMinutes: 15
```

## Architecture

```
src/
├── api/           # Polymarket API clients
├── agents/        # AI analysis agents
├── workflows/     # Inngest workflow definitions
├── notifications/ # Slack handlers
├── cache/         # Redis cache layer
└── config/        # Configuration loading
```

## License

MIT
