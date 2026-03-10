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
cdk synth --profile mostrom_mgmt && cdk deploy --profile mostrom_mgmt --all --require-approval never
```
