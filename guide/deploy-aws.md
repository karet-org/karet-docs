# Deploying Karet to AWS

This doc walks through taking the Karet stack (`karet`, `karet-worker`, and the dev-time `rustfs` S3 emulator) and running it on AWS.

## TL;DR

- Replace `rustfs` with a real **S3 bucket**.
- Replace the `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` static creds with **IAM roles** attached to the compute.
- Push both container images to **ECR**.
- Run both services on **ECS Fargate** behind an **ALB**, with only `karet` exposed publicly.
- Wire S3 upload events to `karet-worker`'s `/webhooks/s3/on-upload` via **EventBridge → API destination** (or SQS + a small poller).

```
         ┌────────┐   HTTPS     ┌───────────────┐
 users ──▶   ALB  ├────────────▶│ ECS: karet    │──┐
         └────────┘             └───────────────┘  │
                                                   │ internal ALB / service discovery
                                                   ▼
                                         ┌───────────────────┐
                                         │ ECS: karet-worker │
                                         └────────┬──────────┘
                                                  │
                                                  ▼
                                              ┌───────┐
                                              │  S3   │◀── EventBridge ──▶ /webhooks/s3/on-upload
                                              └───────┘
```

---

## 1. Prerequisites

- AWS account with permissions to create IAM, VPC, ECR, ECS, ALB, S3, and CloudWatch resources.
- AWS CLI v2, Docker, and (optionally) `aws-cdk` or `terraform` for repeatable infra.
- A domain + ACM certificate if you want HTTPS on a custom hostname.

Pick a region up front. The example uses `us-east-1`:

```sh
export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

---

## 2. S3 bucket

Karet stores three things in S3: raw CSV uploads, `Pipeline_Config` JSON, and generated Parquet output. One bucket is enough.

```sh
aws s3api create-bucket \
  --bucket karet-data-${ACCOUNT_ID} \
  --region ${AWS_REGION}

aws s3api put-bucket-versioning \
  --bucket karet-data-${ACCOUNT_ID} \
  --versioning-configuration Status=Enabled

aws s3api put-public-access-block \
  --bucket karet-data-${ACCOUNT_ID} \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Seed the config object the same way `scripts/seed-rustfs.sh` does locally:

```sh
aws s3 cp scripts/mock/pipeline.json \
  s3://karet-data-${ACCOUNT_ID}/config/pipeline.json
```

---

## 3. IAM roles

Two task roles, one per service, following least-privilege.

**`karet-worker-task-role`** needs full read/write on the bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::karet-data-<ACCOUNT_ID>",
        "arn:aws:s3:::karet-data-<ACCOUNT_ID>/*"
      ]
    }
  ]
}
```

**`karet-task-role`** reads config and dashboards, and writes uploads:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::karet-data-<ACCOUNT_ID>",
        "arn:aws:s3:::karet-data-<ACCOUNT_ID>/*"
      ]
    }
  ]
}
```

Also create the standard **`ecsTaskExecutionRole`** (AWS managed policy `AmazonECSTaskExecutionRolePolicy`) for pulling images and writing logs.

---

## 4. Push images to ECR

```sh
for repo in karet karet-worker; do
  aws ecr create-repository --repository-name $repo --region $AWS_REGION || true
done

aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

docker build -t karet            src/karet
docker build -t karet-worker     src/karet-worker

for repo in karet karet-worker; do
  docker tag  $repo:latest ${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/$repo:latest
  docker push              ${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/$repo:latest
done
```

The worker Dockerfile already handles multi-arch; if you're on Apple Silicon and deploying to `X86_64` Fargate, build with `--platform linux/amd64`.

---

## 5. Networking

- One VPC with two public subnets (for the ALB) and two private subnets (for tasks).
- NAT gateway in each public subnet so Fargate tasks can pull from ECR and reach S3. Alternatively, add **VPC endpoints** for S3 (gateway) and ECR/CloudWatch Logs (interface) to avoid NAT egress cost.
- Security groups:
  - `sg-alb`: inbound 443 from `0.0.0.0/0`.
  - `sg-web`: inbound 3000 from `sg-alb`.
  - `sg-worker`: inbound 8080 from `sg-web`.

---

## 6. ECS Fargate services

Create an ECS cluster, then one task definition + service per container.

### karet-worker task definition (fragment)

```json
{
  "family": "karet-worker",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::<ACCOUNT_ID>:role/ecsTaskExecutionRole",
  "taskRoleArn":      "arn:aws:iam::<ACCOUNT_ID>:role/karet-worker-task-role",
  "containerDefinitions": [{
    "name": "karet-worker",
    "image": "<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/karet-worker:latest",
    "portMappings": [{ "containerPort": 8080, "protocol": "tcp" }],
    "environment": [
      { "name": "PORT",                "value": "8080" },
      { "name": "S3_BUCKET",           "value": "karet-data-<ACCOUNT_ID>" },
      { "name": "AWS_REGION",          "value": "<REGION>" },
      { "name": "PIPELINE_CONFIG_KEY", "value": "config/pipeline.json" },
      { "name": "POLARS_MAX_THREADS",  "value": "2" }
    ],
    "healthCheck": {
      "command": ["CMD-SHELL", "wget -qO- http://localhost:8080/health || exit 1"],
      "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 10
    },
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/karet/worker",
        "awslogs-region": "<REGION>",
        "awslogs-stream-prefix": "worker"
      }
    }
  }]
}
```

Notes:
- **Do not set** `S3_ENDPOINT` or `AWS_ENDPOINT_URL` in prod. The AWS SDK hits real S3 by default.
- **Do not set** `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. Credentials come from the task role.

### karet task definition

Same shape, but:
- image: `karet:latest`
- container port `3000`
- task role: `karet-task-role`
- extra env:
  - `KARET_API_KEY`: pull from **Secrets Manager** via the `secrets` field, not `environment`.
  - add an internal URL for the worker if web-side code needs it (e.g. `WORKER_URL=http://karet-worker.karet.local:8080` using ECS Service Discovery).

### Services

- `karet-svc`: desired count 2, target group on the ALB (port 3000), health check path `/`.
- `karet-worker-svc`: desired count 1–2, no ALB needed for the UI path, but register it with **AWS Cloud Map** (`karet-worker.karet.local`) so `karet` can reach it by name. For the S3 webhook, expose it on an **internal ALB** with listener on 8080 and target path `/webhooks/s3/on-upload`.

---

## 7. Application Load Balancer

- Internet-facing ALB in the public subnets.
- Listener 443 (ACM cert) → target group for `karet` on 3000.
- Listener 80 → redirect to 443.
- Health check: `GET /` returns 200.

Point your DNS (`karet.example.com`) at the ALB via a Route 53 alias record.

---

## 8. S3 → worker webhook wiring

The local dev setup doesn't wire S3 events. In AWS you probably want them.

Option A: **EventBridge + API destination** (simplest if the worker has a stable internal URL):

1. Enable EventBridge notifications on the bucket.
2. Create a rule matching `Object Created` events with prefix `raw/`.
3. Target: API destination pointing at the internal ALB URL for the worker `+ /webhooks/s3/on-upload`.

Option B: **SQS queue** (more resilient; survives worker restarts):

1. Bucket event notification → SQS queue.
2. Add a small poller to the worker (or a sidecar) that reads SQS and calls the existing `/webhooks/s3/on-upload` handler. This is a code change, but it's the right shape for production.

---

## 9. Secrets and configuration

- `KARET_API_KEY`: store in **AWS Secrets Manager** (`/karet/prod/api-key`), reference from the task definition's `secrets` block.
- `Pipeline_Config`: lives in S3 at `config/pipeline.json`. Update it by re-uploading the file. Both services re-read it on demand.
- Database creds, API tokens, etc.: always Secrets Manager or SSM Parameter Store, never task `environment`.

---

## 10. Observability

- **CloudWatch Logs**: groups `/karet/web` and `/karet/worker` (auto-created by the task defs above).
- **CloudWatch Container Insights**: enable on the cluster for CPU/memory/task metrics.
- **Alarms** worth starting with:
  - ALB 5xx rate > 1% over 5 min.
  - Worker task CPU > 85% for 10 min.
  - S3 `4xxErrors` on the bucket.
- **Tracing**: optional. Add the AWS Distro for OpenTelemetry sidecar to each task if you want traces in X-Ray.

---

## 11. CI/CD

Minimal GitHub Actions / CodePipeline flow:

1. On push to `mainline`: build both images, tag with the git SHA, push to ECR.
2. Update each ECS service with the new image tag (`aws ecs update-service --force-new-deployment`).
3. Rely on ECS rolling deploys + ALB health checks for zero-downtime.

For IaC, pick one:
- **CDK** (TypeScript): matches the JS side of the stack.
- **Terraform**: pick this if you already run Terraform.
- **CloudFormation** via `aws ecs` and `aws elbv2`: fine for a proof of concept.

---

## 12. Cost sanity check

Rough monthly estimate for a small prod deployment in `us-east-1`:

| Item | Config | ~USD/mo |
|------|--------|---------|
| Fargate (web, 2× 0.5 vCPU / 1 GB, 24×7) | `2 * 0.5 * 730h` | ~15 |
| Fargate (worker, 1× 1 vCPU / 2 GB, 24×7) | `1 * 1 * 730h` | ~30 |
| ALB | 1 LCU avg | ~20 |
| S3 | 50 GB + light traffic | ~2 |
| NAT gateway | 1 AZ | ~35 |
| CloudWatch Logs | 5 GB ingest | ~3 |

Total is roughly **$100–120/mo** before data transfer. Replacing NAT with VPC endpoints cuts it further.

---

## 13. Local → AWS parity checklist

Before flipping prod traffic:

- [ ] Task roles replace the static `AWS_*` keys from `docker-compose.yaml`.
- [ ] `S3_ENDPOINT` / `AWS_ENDPOINT_URL` are **unset** in prod.
- [ ] `KARET_API_KEY` is set (and non-empty) so `/api/*` isn't open.
- [ ] Bucket has versioning + public access block on.
- [ ] `/health` returns 200 from the worker task behind its target group.
- [ ] ALB listener has ACM cert and redirects 80 → 443.
- [ ] CloudWatch log groups exist and are receiving data.
- [ ] S3 event notifications land a test job on the worker.
