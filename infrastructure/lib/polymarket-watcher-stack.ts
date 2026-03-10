import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

export interface PolymarketWatcherStackProps extends cdk.StackProps {
  /**
   * Use existing VPC instead of creating a new one
   */
  vpcId?: string;
}

export class PolymarketWatcherStack extends cdk.Stack {
  public readonly service: ecsPatterns.ApplicationLoadBalancedFargateService;
  public readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props?: PolymarketWatcherStackProps) {
    super(scope, id, props);

    // ==========================================================================
    // VPC
    // ==========================================================================
    const vpc = props?.vpcId
      ? ec2.Vpc.fromLookup(this, "Vpc", { vpcId: props.vpcId })
      : new ec2.Vpc(this, "Vpc", {
          maxAzs: 2,
          natGateways: 1,
          subnetConfiguration: [
            {
              name: "Public",
              subnetType: ec2.SubnetType.PUBLIC,
              cidrMask: 24,
            },
            {
              name: "Private",
              subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
              cidrMask: 24,
            },
          ],
        });

    // ==========================================================================
    // Secrets Manager
    // ==========================================================================
    const anthropicSecret = new secretsmanager.Secret(this, "AnthropicApiKey", {
      secretName: "/polymarket-watcher/anthropic-api-key",
      description: "Anthropic API key for Claude",
    });

    const slackSecret = new secretsmanager.Secret(this, "SlackBotToken", {
      secretName: "/polymarket-watcher/slack-bot-token",
      description: "Slack bot token for notifications",
    });

    const redisSecret = new secretsmanager.Secret(this, "RedisUrl", {
      secretName: "/polymarket-watcher/redis-url",
      description: "Redis connection URL",
    });

    const inngestEventKey = new secretsmanager.Secret(this, "InngestEventKey", {
      secretName: "/polymarket-watcher/inngest-event-key",
      description: "Inngest event key",
    });

    const inngestSigningKey = new secretsmanager.Secret(this, "InngestSigningKey", {
      secretName: "/polymarket-watcher/inngest-signing-key",
      description: "Inngest signing key",
    });

    // ==========================================================================
    // ECS Cluster
    // ==========================================================================
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      containerInsights: true,
      clusterName: "polymarket-watcher",
    });

    // ==========================================================================
    // CloudWatch Logs
    // ==========================================================================
    this.logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: "/ecs/polymarket-watcher",
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ==========================================================================
    // Fargate Service
    // ==========================================================================
    this.service = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      "Service",
      {
        cluster,
        serviceName: "polymarket-watcher",
        cpu: 512, // 0.5 vCPU
        memoryLimitMiB: 1024, // 1 GB
        desiredCount: 1,
        publicLoadBalancer: true,
        assignPublicIp: false,
        taskImageOptions: {
          image: ecs.ContainerImage.fromAsset("../application"),
          containerPort: 3000,
          environment: {
            NODE_ENV: "production",
            PORT: "3000",
            LOG_LEVEL: "info",
            CONFIG_PATH: "config/user-config.yaml",
            SLACK_DEFAULT_CHANNEL: "polymarket-alerts",
          },
          secrets: {
            ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(anthropicSecret),
            SLACK_BOT_TOKEN: ecs.Secret.fromSecretsManager(slackSecret),
            REDIS_URL: ecs.Secret.fromSecretsManager(redisSecret),
            INNGEST_EVENT_KEY: ecs.Secret.fromSecretsManager(inngestEventKey),
            INNGEST_SIGNING_KEY: ecs.Secret.fromSecretsManager(inngestSigningKey),
          },
          logDriver: ecs.LogDrivers.awsLogs({
            logGroup: this.logGroup,
            streamPrefix: "polymarket-watcher",
          }),
        },
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        circuitBreaker: { rollback: true },
      }
    );

    // Configure health check
    this.service.targetGroup.configureHealthCheck({
      path: "/health",
      healthyHttpCodes: "200",
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(10),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    // ==========================================================================
    // CloudWatch Alarms
    // ==========================================================================
    const cpuAlarm = this.service.service
      .metricCpuUtilization()
      .createAlarm(this, "CpuAlarm", {
        alarmName: "polymarket-watcher-cpu-high",
        threshold: 80,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        alarmDescription: "CPU utilization is above 80%",
      });

    const memoryAlarm = this.service.service
      .metricMemoryUtilization()
      .createAlarm(this, "MemoryAlarm", {
        alarmName: "polymarket-watcher-memory-high",
        threshold: 80,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        alarmDescription: "Memory utilization is above 80%",
      });

    // ==========================================================================
    // Outputs
    // ==========================================================================
    new cdk.CfnOutput(this, "ServiceUrl", {
      value: `http://${this.service.loadBalancer.loadBalancerDnsName}`,
      description: "Load balancer URL",
    });

    new cdk.CfnOutput(this, "HealthCheckUrl", {
      value: `http://${this.service.loadBalancer.loadBalancerDnsName}/health`,
      description: "Health check endpoint",
    });

    new cdk.CfnOutput(this, "InngestUrl", {
      value: `http://${this.service.loadBalancer.loadBalancerDnsName}/api/inngest`,
      description: "Inngest webhook endpoint",
    });

    new cdk.CfnOutput(this, "LogGroupName", {
      value: this.logGroup.logGroupName,
      description: "CloudWatch log group",
    });
  }
}
