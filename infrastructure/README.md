# Polymarket Watcher Infrastructure

AWS CDK infrastructure for deploying Polymarket Watcher to AWS Fargate.

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 20+
- CDK CLI (`npm install -g aws-cdk`)

## Setup

1. Install dependencies:

```bash
cd infrastructure
npm install
```

2. Configure secrets in AWS Secrets Manager:

```bash
# Create secrets (replace with your actual values)
aws secretsmanager create-secret \
  --name /polymarket-watcher/anthropic-api-key \
  --secret-string "sk-ant-..."

aws secretsmanager create-secret \
  --name /polymarket-watcher/slack-bot-token \
  --secret-string "xoxb-..."

aws secretsmanager create-secret \
  --name /polymarket-watcher/redis-url \
  --secret-string "redis://..."

aws secretsmanager create-secret \
  --name /polymarket-watcher/inngest-event-key \
  --secret-string "..."

aws secretsmanager create-secret \
  --name /polymarket-watcher/inngest-signing-key \
  --secret-string "..."
```

3. Bootstrap CDK (first time only):

```bash
cdk bootstrap
```

## Deploy

```bash
# Synthesize CloudFormation template
cdk synth

# Deploy to AWS
cdk deploy
```

## Destroy

```bash
cdk destroy
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                         VPC                              │
│  ┌──────────────────┐  ┌──────────────────────────────┐ │
│  │   Public Subnet   │  │      Private Subnet          │ │
│  │                   │  │                              │ │
│  │  ┌─────────────┐  │  │  ┌────────────────────────┐ │ │
│  │  │     ALB     │──┼──┼──│   Fargate Service      │ │ │
│  │  └─────────────┘  │  │  │   (0.5 vCPU, 1GB)      │ │ │
│  │                   │  │  └────────────────────────┘ │ │
│  └──────────────────┘  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │       Secrets Manager          │
              │  - anthropic-api-key           │
              │  - slack-bot-token             │
              │  - redis-url                   │
              │  - inngest-*                   │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │       CloudWatch Logs          │
              │  /ecs/polymarket-watcher       │
              └───────────────────────────────┘
```

## Cost Estimate

| Service                      | Monthly Cost |
|------------------------------|-------------|
| Fargate (0.5 vCPU, 1GB, 24/7) | ~$15-20     |
| Application Load Balancer     | ~$18        |
| NAT Gateway                   | ~$35        |
| Secrets Manager (5 secrets)   | ~$2         |
| CloudWatch Logs              | ~$2-5       |
| **Total**                    | **~$70-80** |

> Note: To reduce costs, consider using a NAT instance instead of NAT Gateway, or running the service on a schedule.

## Monitoring

- Health check: `http://<alb-dns>/health`
- CloudWatch Logs: `/ecs/polymarket-watcher`
- CPU alarm: triggers at 80% utilization
- Memory alarm: triggers at 80% utilization
