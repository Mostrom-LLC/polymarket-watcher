import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { Construct } from "constructs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: path.join(__dirname, "../../application/.env"), override: false });

const environment = process.env.ENVIRONMENT ?? "prod";
const vpcId = process.env.CDK_DEFAULT_VPC!;
const secretVariables = ["GEMINI_API_KEY", "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_CHANNEL_ID", "REDIS_URL"];

const constructorPrefix = `${environment}-polymarket-watcher`;

export class PolymarketWatcherStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ==========================================================================
    // VPC
    // ==========================================================================
    const vpc = ec2.Vpc.fromLookup(this, `${constructorPrefix}-vpc`, {
      isDefault: false,
      vpcId,
    });

    // ==========================================================================
    // Secrets Manager — single secret with all key/value pairs
    // ==========================================================================
    const appSecret = new secretsmanager.Secret(this, `${constructorPrefix}-secret`, {
      secretName: "polymarket-watcher",
      description: `Environment variables for polymarket-watcher (${environment})`,
      secretObjectValue: {
        GEMINI_API_KEY: cdk.SecretValue.unsafePlainText(process.env.GEMINI_API_KEY ?? ""),
        SLACK_BOT_TOKEN: cdk.SecretValue.unsafePlainText(process.env.SLACK_BOT_TOKEN ?? ""),
        SLACK_APP_TOKEN: cdk.SecretValue.unsafePlainText(process.env.SLACK_APP_TOKEN ?? ""),
        SLACK_CHANNEL_ID: cdk.SecretValue.unsafePlainText(process.env.SLACK_CHANNEL_ID ?? ""),
        REDIS_URL: cdk.SecretValue.unsafePlainText(process.env.REDIS_URL ?? ""),
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const generateSecrets = (list: string[]) => {
      const containerSecrets: { [key: string]: ecs.Secret } = {};
      list.forEach((item) => {
        containerSecrets[item] = ecs.Secret.fromSecretsManager(appSecret, item);
      });
      return containerSecrets;
    };

    // ==========================================================================
    // ECS Cluster
    // ==========================================================================
    const cluster = new ecs.Cluster(this, `${constructorPrefix}-cluster`, {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
      clusterName: "polymarket",
    });

    // ==========================================================================
    // CloudWatch Logs
    // ==========================================================================
    const logGroup = new logs.LogGroup(this, `${constructorPrefix}-log-group`, {
      logGroupName: `/ecs/polymarket-watcher/${environment}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const inngestLogGroup = new logs.LogGroup(this, `${constructorPrefix}-inngest-log-group`, {
      logGroupName: `/ecs/polymarket-watcher/${environment}/inngest`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ==========================================================================
    // IAM Task Role
    // ==========================================================================
    const role = new iam.Role(this, `${constructorPrefix}-ecs-task-role`, {
      assumedBy: new iam.CompositePrincipal(
        new iam.AccountPrincipal(this.account),
        new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        new iam.ServicePrincipal("ecs.amazonaws.com"),
      ),
      roleName: `polymarket-watcher-${environment}-ecs-task-role`,
    });

    appSecret.grantRead(role);

    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"));

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ["*"],
        actions: [
          "logs:*",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability",
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:RegisterTaskDefinition",
          "iam:PassRole",
        ],
      }),
    );

    // ==========================================================================
    // Security Group
    // ==========================================================================
    const fargateSecurityGroup = new ec2.SecurityGroup(this, `${constructorPrefix}-fargate-sg`, {
      vpc,
      securityGroupName: `polymarket-watcher-${environment}`,
      allowAllOutbound: true,
    });

    fargateSecurityGroup.addIngressRule(fargateSecurityGroup, ec2.Port.tcp(8288), "Allow Inngest sidecar within task");

    // ==========================================================================
    // Task Definition
    // ==========================================================================
    const taskDef = new ecs.FargateTaskDefinition(this, `${constructorPrefix}-task-definition`, {
      family: "polymarket-watcher",
      executionRole: role,
      taskRole: role,
      memoryLimitMiB: 2048,
      cpu: 512,
    });

    // Main application container
    taskDef.addContainer(`${constructorPrefix}-container`, {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, "../../application"), {
        exclude: ["node_modules", "dist", ".env", "cdk.out"],
        platform: Platform.LINUX_AMD64,
      }),
      memoryLimitMiB: 1024,
      cpu: 256,
      essential: true,
      logging: new ecs.AwsLogDriver({
        streamPrefix: "ecs",
        logGroup,
        multilinePattern: "^(INFO|DEBUG|WARN|ERROR|CRITICAL)",
      }),
      portMappings: [{ containerPort: 80, protocol: ecs.Protocol.TCP }],
      secrets: generateSecrets(secretVariables),
      environment: {
        NODE_ENV: environment === "prod" ? "production" : environment,
        PORT: "80",
        LOG_LEVEL: "info",
        CONFIG_PATH: "config/user-config.yaml",
        INNGEST_DEV: "1",
        INNGEST_BASE_URL: "http://localhost:8288",
      },
    });

    // Inngest dev server sidecar
    taskDef.addContainer(`${constructorPrefix}-inngest-sidecar`, {
      image: ecs.ContainerImage.fromRegistry("public.ecr.aws/mostrom/inngest:latest"),
      memoryLimitMiB: 512,
      cpu: 256,
      essential: false,
      command: ["inngest", "dev", "-u", "http://localhost/api/inngest"],
      logging: new ecs.AwsLogDriver({
        streamPrefix: "ecs",
        logGroup: inngestLogGroup,
      }),
      portMappings: [{ containerPort: 8288, protocol: ecs.Protocol.TCP }],
    });

    // ==========================================================================
    // Fargate Service
    // ==========================================================================
    const service = new ecs.FargateService(this, `${constructorPrefix}-fargate-service`, {
      cluster,
      taskDefinition: taskDef,
      serviceName: "polymarket-watcher-svc",
      desiredCount: 1,
      assignPublicIp: false,
      securityGroups: [fargateSecurityGroup],
      vpcSubnets: { subnets: vpc.privateSubnets, availabilityZones: ["us-east-1a"] },
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: false },
    });

    service.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    service.node.addDependency(appSecret);

    // ==========================================================================
    // CloudWatch Alarms
    // ==========================================================================
    service.metricCpuUtilization().createAlarm(this, "CpuAlarm", {
      alarmName: `${constructorPrefix}-cpu-high`,
      threshold: 80,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      alarmDescription: "CPU utilization is above 80%",
    });

    service.metricMemoryUtilization().createAlarm(this, "MemoryAlarm", {
      alarmName: `${constructorPrefix}-memory-high`,
      threshold: 80,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      alarmDescription: "Memory utilization is above 80%",
    });

    // ==========================================================================
    // Outputs
    // ==========================================================================
    new cdk.CfnOutput(this, "LogGroupName", {
      value: logGroup.logGroupName,
      description: "CloudWatch log group",
    });
  }
}
