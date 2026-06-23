# AWS Deployment Runbook

This branch is set up for a small AWS deployment of B2 Savings Analyzer V2 with Postgres-backed structured data and Backblaze B2 object storage for uploaded bills and binary artifacts.

## Target Shape

- ECS Fargate runs the Next.js standalone server from a Docker image in ECR.
- RDS PostgreSQL stores users, analyses, parsed bill JSON, model configs, snapshots, and upload metadata.
- Backblaze B2 remains the object store for uploaded bills.
- Secrets Manager stores B2 credentials, auth/email secrets, and the generated `DATABASE_URL`.
- An internet-facing ALB is security-group restricted to Backblaze VPN/full-tunnel egress CIDRs.

## VPN Access Caveat

The ALB allowlist only works when the user's web traffic exits from a Backblaze public egress IP. OpenVPN/Viscosity full-tunnel users should match the Backblaze CIDRs. GlobalProtect split-tunnel users may still reach the ALB from their home/office ISP unless NetEng adds the AWS application destination to the split-tunnel include routes.

Do not use raw ALB public IPs as GlobalProtect route targets because ALB IPs are not stable. For a stricter production path, use corporate private routing into the VPC, or put a static public ingress layer such as AWS Global Accelerator or an NLB with EIPs in front of the app and coordinate those destination IPs with NetEng.

## Prerequisites

- AWS CLI configured for account `514936917379`.
- Terraform 1.6 or newer installed locally.
- Docker Desktop running locally.
- An ACM certificate in `us-west-2` for the app hostname.
- `.env.local` populated with the current B2, auth, and Resend values.
- Backblaze/NetEng confirmation that the ingress CIDRs and GlobalProtect routing plan are acceptable.

## First Deploy

1. Copy the Terraform example:

   ```bash
   cp infra/aws/terraform.tfvars.example infra/aws/terraform.tfvars
   ```

2. Edit `infra/aws/terraform.tfvars`:

   - Set `app_base_url` to the final HTTPS URL.
   - Set `certificate_arn` to the ACM certificate ARN.
   - Keep `desired_count = 0` for the first apply.
   - Keep or update `allowed_ingress_cidrs` after NetEng confirms the VPN egress plan.

3. Create the AWS infrastructure shell with no running app tasks:

   ```bash
   terraform -chdir=infra/aws init
   terraform -chdir=infra/aws plan
   terraform -chdir=infra/aws apply
   ```

4. Upload runtime secrets from `.env.local` into Secrets Manager:

   ```bash
   node scripts/aws-put-runtime-secrets.mjs --region us-west-2
   ```

5. Build and push the app image:

   ```bash
   AWS_REGION=us-west-2 IMAGE_TAG=latest scripts/aws-build-and-push-image.sh
   ```

6. Run the database migration once on ECS:

   ```bash
   node scripts/aws-run-db-migration.mjs --region us-west-2
   ```

7. Scale the service:

   ```hcl
   desired_count = 1
   ```

   Then apply again:

   ```bash
   terraform -chdir=infra/aws apply
   ```

8. Test from VPN:

   ```bash
   terraform -chdir=infra/aws output -raw alb_dns_name
   curl -I https://your-final-hostname.example
   ```

## Updates

For app-only changes:

1. Commit the code.
2. Build and push a new image tag:

   ```bash
   AWS_REGION=us-west-2 IMAGE_TAG=$(git rev-parse --short HEAD) scripts/aws-build-and-push-image.sh
   ```

3. Set `container_image_tag` in `infra/aws/terraform.tfvars` to that tag.
4. Run `terraform -chdir=infra/aws apply`.

For schema changes, push the image first, run `node scripts/aws-run-db-migration.mjs --region us-west-2`, then apply the new service tag.

## Cost Notes

This is intentionally small: one `db.t4g.micro` RDS instance and one low-memory Fargate service is enough for the expected 2-3 occasional users. RDS is the always-on cost center. ECS service count can be set to `0` when the app is not needed, but RDS remains available unless explicitly stopped or destroyed.
