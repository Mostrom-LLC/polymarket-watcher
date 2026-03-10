#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { PolymarketWatcherStack } from "../lib/polymarket-watcher-stack";

const app = new cdk.App();

new PolymarketWatcherStack(app, "PolymarketWatcherStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  description: "Polymarket Watcher - Autonomous market monitoring service",
});
