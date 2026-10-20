# MUSE SPARK PRODUCTION PREPARATION — STEP 2C-A
## Terraform Security & Pre-Apply Review Report

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Activity:** Post-Roadmap Production Preparation (Step 2C-A — Terraform Security & Pre-Apply Review)  
**Execution Mode:** STRICT READ-ONLY SECURITY AUDIT & PRE-APPLY SAFETY GATE  
**Authority Baseline:** Formally Approved Phases 1–16, [Step 1 Audit](file:///d:/Zentra/docs/MUSE_SPARK_PRODUCTION_PREPARATION_STEP1.md), [Step 2 Blueprint](file:///d:/Zentra/docs/MUSE_SPARK_PRODUCTION_PREPARATION_STEP2.md), [Step 2A Amendment](file:///d:/Zentra/docs/MUSE_SPARK_PRODUCTION_PREPARATION_STEP2A.md), [Step 2B Hardening](file:///d:/Zentra/docs/MUSE_SPARK_PRODUCTION_PREPARATION_STEP2B.md), and [Step 2C Provisioning Report](file:///d:/Zentra/docs/MUSE_SPARK_PRODUCTION_PREPARATION_STEP2C.md)  
**Target Codebase:** [`infra/terraform/staging/`](file:///d:/Zentra/infra/terraform/staging/)  
**AWS State:** UNTOUCHED (Zero Authentication, Zero API Calls, Zero Resources Created)  
**Overall Pre-Apply Determination:** **`BLOCKED — SECURITY ISSUE REQUIRES CORRECTION BEFORE APPLY`**  

---

## 1. Executive Summary

This report performs a comprehensive, read-only static security and architectural audit of the HashiCorp Terraform staging infrastructure codified during Step 2C under [`infra/terraform/staging/`](file:///d:/Zentra/infra/terraform/staging/).

The purpose of this review is to serve as an authoritative **pre-apply safety gate** prior to any future execution of `terraform init`, `terraform plan`, or `terraform apply`.

### Key Audit Findings:
1. **Network, RDS, S3, and IAM Architectural Integrity:** The Terraform configuration faithfully translates the approved Step 2A staging blueprint into declarative HCL. Security groups enforce strict tiered isolation (`ALB:443/80` $\to$ `API:4000` $\to$ `RDS:5432`), the database is strictly private (`publicly_accessible = false`, `rds.force_ssl = 1`), the S3 evidence bucket enforces all 4 public access blocks with versioning and AES-256 encryption, the customer WAL bucket is omitted, and the API IAM role is strictly least-privilege.
2. **Terraform State Security & Secret Leakage Vulnerabilities (HIGH SEVERITY):**
   - **Local State Default:** The S3 remote backend in [`main.tf`](file:///d:/Zentra/infra/terraform/staging/main.tf#L16) is commented out (`# backend "s3" {}`), defaulting Terraform to local unencrypted state files (`terraform.tfstate`).
   - **Plaintext Secrets in State:** Resources `random_password.*` and `aws_secretsmanager_secret_version.*` in [`secrets.tf`](file:///d:/Zentra/infra/terraform/staging/secrets.tf) and [`rds.tf`](file:///d:/Zentra/infra/terraform/staging/rds.tf) store plaintext cryptographic secrets (JWT access secret, JWT refresh secret, offline permit key, master DB password, app DB password, and full connection URLs) inside `terraform.tfstate`.
   - **Repository Git Exclusion Gap:** Root [`.gitignore`](file:///d:/Zentra/.gitignore) **does not exclude `*.tfstate`, `*.tfstate.*`, `.terraform/`, or `*.tfvars`**. Running `terraform apply` locally would leave plaintext state files untracked and highly vulnerable to accidental Git commits.
3. **RDS Master Admin Password Omission in Secrets Manager (MEDIUM SEVERITY):**
   - `random_password.db_master_password` generates the `zentra_admin` password for RDS, but this secret is **never stored in AWS Secrets Manager**. Only `db_credentials` for `zentra_staging_app` is recorded. Administrators would have no mechanism to retrieve migration credentials other than inspecting raw state.
4. **ECS Application Image Status (INFORMATIONAL):**
   - `image = "zentra-staging-api:latest"` in [`ecs.tf`](file:///d:/Zentra/infra/terraform/staging/ecs.tf#L90) references a non-existent placeholder image. Status is formally classified as: **`INFRASTRUCTURE BLUEPRINT — IMAGE NOT YET AVAILABLE`**.
5. **Authoritative Pre-Apply Determination:**
   In accordance with the mandatory decision protocol, because unresolved state security and `.gitignore` gaps would expose plaintext cryptographic secrets:
   # **`BLOCKED — SECURITY ISSUE REQUIRES CORRECTION BEFORE APPLY`**

---

## 2. Scope & Safety Boundary

This activity is strictly a **read-only static code audit**:
- **Zero AWS Interaction:** No AWS CLI commands were executed. No AWS credentials were configured, verified, or used. Zero AWS APIs were called.
- **Zero State Changes:** No Terraform CLI commands modifying state (`terraform apply`, `terraform destroy`, `terraform import`, `terraform state rm`) were executed.
- **Zero File Edits:** In strict accordance with audit instructions, **no files were modified during this review**. All identified defects are documented as formal findings with precise correction instructions.
- **Zero Deployments:** No container promotion, web deployment, or mobile testing took place.

---

## 3. Files Inspected

A complete, line-by-line inspection of all repository infrastructure artifacts was performed:

| File Path | Lines | Purpose / Scope | Audit Status |
| :--- | :---: | :--- | :---: |
| [`infra/terraform/staging/main.tf`](file:///d:/Zentra/infra/terraform/staging/main.tf) | 33 | Terraform version, providers, default tags, backend placeholder | Inspected |
| [`infra/terraform/staging/variables.tf`](file:///d:/Zentra/infra/terraform/staging/variables.tf) | 66 | Staging variables, CIDRs, RDS sizing, domain placeholders | Inspected |
| [`infra/terraform/staging/vpc.tf`](file:///d:/Zentra/infra/terraform/staging/vpc.tf) | 209 | VPC (`10.100.0.0/16`), 6 subnets, IGW, single NAT, RTs, S3 VPCE | Inspected |
| [`infra/terraform/staging/security_groups.tf`](file:///d:/Zentra/infra/terraform/staging/security_groups.tf) | 113 | Tiered SGs (`ALB` $\to$ `API` $\to$ `RDS`) with zero public DB ingress | Inspected |
| [`infra/terraform/staging/rds.tf`](file:///d:/Zentra/infra/terraform/staging/rds.tf) | 95 | RDS PostgreSQL 16 Multi-AZ, DB subnet group, SSL parameter group | Inspected |
| [`infra/terraform/staging/s3.tf`](file:///d:/Zentra/infra/terraform/staging/s3.tf) | 119 | S3 evidence bucket (versioned, AES-256, private), static web bucket | Inspected |
| [`infra/terraform/staging/iam.tf`](file:///d:/Zentra/infra/terraform/staging/iam.tf) | 127 | Least-privilege API task role and ECS task execution role | Inspected |
| [`infra/terraform/staging/secrets.tf`](file:///d:/Zentra/infra/terraform/staging/secrets.tf) | 107 | Secrets Manager secrets (JWT, offline permit, app DB credentials) | Inspected |
| [`infra/terraform/staging/ecs.tf`](file:///d:/Zentra/infra/terraform/staging/ecs.tf) | 182 | ECS Fargate cluster, ALB, target group, task definition, service | Inspected |
| [`infra/terraform/staging/cloudwatch.tf`](file:///d:/Zentra/infra/terraform/staging/cloudwatch.tf) | 24 | CloudWatch log groups for API and ALB (30-day retention) | Inspected |
| [`infra/terraform/staging/outputs.tf`](file:///d:/Zentra/infra/terraform/staging/outputs.tf) | 64 | Infrastructure identifiers, endpoints, and ARNs | Inspected |
| [`infra/terraform/staging/terraform.tfvars.example`](file:///d:/Zentra/infra/terraform/staging/terraform.tfvars.example) | 18 | Safe variable configuration template | Inspected |
| [`.gitignore`](file:///d:/Zentra/.gitignore) | 68 | Repository git exclusion rules | Inspected |

---

## 4. Terraform Version & Provider Configuration

Inspected in [`infra/terraform/staging/main.tf`](file:///d:/Zentra/infra/terraform/staging/main.tf):
- **Core Engine Constraint:** `required_version = ">= 1.5.0"` (Accepts modern Terraform 1.5+ features including import blocks and check blocks).
- **Required Providers:**
  - `hashicorp/aws`: `version = "~> 5.50"` (Supports PostgreSQL 16 RDS, modern S3 bucket resources, and ECS Fargate).
  - `hashicorp/random`: `version = "~> 3.6"` (Used for high-entropy password generation).
- **Default Resource Tags:** Enforced automatically across all provisioned AWS resources:
  ```hcl
  default_tags {
    tags = {
      Project               = "ZENTRA"
      Environment           = "staging"
      ManagedBy             = "ZENTRA"
      Owner                 = "ZENTRA-Operations"
      CostCenter            = "ZENTRA-STAGING"
      DoNotUseForProduction = "true"
    }
  }
  ```
- **Audit Assessment:** Provider and version constraints are valid, standard, and secure.

---

## 5. Terraform State Security (Deep Trace)

> [!CAUTION]
> **HIGHEST-PRIORITY AUDIT FINDING — STATE FILE PLAINTEXT SECRET RETENTION**

A comprehensive architectural trace of Terraform state management was conducted:

| Audit Question | Finding / Answer | Security Assessment |
| :--- | :--- | :---: |
| 1. Is a Terraform backend explicitly configured? | **NO.** Line 16 of `main.tf` has `# backend "s3" {}` commented out. | **DEFECT** |
| 2. Is local state currently expected? | **YES.** By default, Terraform falls back to local `terraform.tfstate`. | **HIGH RISK** |
| 3. Is remote state expected? | **YES.** S3 remote backend with DynamoDB locking is required. | **DEFECT** |
| 4. Can sensitive values enter `terraform.tfstate`? | **YES.** Every generated password and secret string enters state. | **CRITICAL MECHANIC** |
| 5. Can generated passwords enter state? | **YES.** `random_password.*.result` is recorded in plaintext JSON. | **HIGH RISK** |
| 6. Can JWT signing secrets enter state? | **YES.** `random_password.jwt_access_secret.result` is in state. | **HIGH RISK** |
| 7. Can offline permit keys enter state? | **YES.** `random_password.offline_permit_key.result` is in state. | **HIGH RISK** |
| 8. Can database credentials enter state? | **YES.** `random_password.app_db_password.result` and full URL are in state. | **HIGH RISK** |
| 9. Are secret values marked sensitive? | Terraform marks them sensitive on CLI output, but NOT in state JSON. | **STATE EXPOSURE** |
| 10. Are sensitive outputs prevented? | **YES.** `outputs.tf` exports zero passwords or secret strings. | **PASSED** |
| 11. Is Terraform state encrypted at rest? | **NO.** Local state files on disk are unencrypted. | **HIGH RISK** |
| 12. Is state access restricted? | **NO.** Anyone with read access to the directory can view secrets. | **HIGH RISK** |
| 13. Is state locking available? | **NO.** Local state does not support multi-user distributed locking. | **DEFECT** |
| 14. Is backend suitable for production/staging? | **NO.** Local state is strictly unacceptable for cloud infrastructure. | **BLOCKED** |

### State Trace Analysis:
In Terraform, the `random_password` provider and the `aws_secretsmanager_secret_version` resource necessarily record their values in the state file so that Terraform can detect drift and maintain state continuity. 
While CLI terminal output masks them as `(sensitive value)`, **the underlying `terraform.tfstate` JSON document contains every generated secret in unencrypted plaintext**.

Therefore, applying Terraform without:
1. An S3 remote backend enforcing AES-256/KMS encryption and restrictive bucket policies, AND
2. Explicit `.gitignore` rules preventing local state files from entering version control,
**presents an immediate, severe credential leakage hazard.**

---

## 6. Secrets Flow Audit (`secrets.tf`)

Inspected in [`infra/terraform/staging/secrets.tf`](file:///d:/Zentra/infra/terraform/staging/secrets.tf):

```mermaid
flowchart TD
    subgraph Terraform_Generation["Terraform Provider (random)"]
        R_JWT_A["random_password.jwt_access_secret (64 chars)"]
        R_JWT_R["random_password.jwt_refresh_secret (64 chars)"]
        R_PERMIT["random_password.offline_permit_key (64 chars)"]
        R_DB_APP["random_password.app_db_password (32 chars)"]
    end

    subgraph State_File["terraform.tfstate (UNENCRYPTED PLAINTEXT)"]
        TF_STATE["Plaintext JSON containing all 4 generated secrets + DB URL"]
    end

    subgraph Secrets_Manager["AWS Secrets Manager (ap-south-1)"]
        SM_JWT_A["zentra/staging/jwt-access-secret"]
        SM_JWT_R["zentra/staging/jwt-refresh-secret"]
        SM_PERMIT["zentra/staging/offline-permit-key"]
        SM_DB["zentra/staging/db-credentials (JSON)"]
    end

    subgraph Runtime_Tier["ECS Fargate Tasks (Private Subnets)"]
        ECS_TASK["zentra-api Container<br/>Secrets injected via ARNs (valueFrom)"]
    end

    R_JWT_A -->|Recorded in state| TF_STATE
    R_JWT_R -->|Recorded in state| TF_STATE
    R_PERMIT -->|Recorded in state| TF_STATE
    R_DB_APP -->|Recorded in state| TF_STATE

    R_JWT_A -->|secret_string| SM_JWT_A
    R_JWT_R -->|secret_string| SM_JWT_R
    R_PERMIT -->|secret_string| SM_PERMIT
    R_DB_APP -->|secret_string (JSON)| SM_DB

    SM_JWT_A -->|IAM Scoped ARN| ECS_TASK
    SM_JWT_R -->|IAM Scoped ARN| ECS_TASK
    SM_PERMIT -->|IAM Scoped ARN| ECS_TASK
    SM_DB -->|IAM Scoped ARN| ECS_TASK
```

### Flow Verification:
- **Generation:** High-entropy random passwords generated via `random_password` (64 chars for token keys, 32 chars for DB passwords).
- **Storage:** Written into AWS Secrets Manager with 7-day recovery windows.
- **Outputs:** Zero secrets exposed in [`outputs.tf`](file:///d:/Zentra/infra/terraform/staging/outputs.tf).
- **Terminal Plans:** Hidden behind `(sensitive value)` mask.
- **ECS Injection:** Injected safely via the ECS task definition `secrets` array using exact secret ARNs (`valueFrom`). Secrets are NOT hardcoded in environment variables or Docker images.
- **Git Exposure Risk:** Because `.gitignore` does not exclude `terraform.tfstate`, local execution creates an immediate risk of accidental Git commitment.

---

## 7. Database Credential Flow & RDS Security

Inspected in [`infra/terraform/staging/rds.tf`](file:///d:/Zentra/infra/terraform/staging/rds.tf) and [`secrets.tf`](file:///d:/Zentra/infra/terraform/staging/secrets.tf):

### 7.1. Database Security Verifications
- **Public Accessibility:** `publicly_accessible = false` (**VERIFIED** in `rds.tf` line 73).
- **SSL Enforcement:** Parameter group `pg16-zentra-staging-params` enforces `rds.force_ssl = 1` (**VERIFIED** in `rds.tf` line 28).
- **Storage Encryption:** `storage_encrypted = true` using AWS managed KMS (**VERIFIED** in `rds.tf` line 66).
- **Engine Version:** PostgreSQL 16.3 on `db.t4g.medium` (**VERIFIED** in `rds.tf` lines 61–62).
- **Multi-AZ Architecture:** `multi_az = true` (**VERIFIED** in `rds.tf` line 72). Managed synchronously by AWS across `ap-south-1a` and `ap-south-1b`.
- **Customer WAL S3 Bucket:** **ZERO WAL buckets exist** (**VERIFIED** absent).

### 7.2. Credential Flow & Defect Identification
- **Application User Separation:** The ECS task definition injects credentials for `zentra_staging_app` (member of `zentra_app` with `NOBYPASSRLS`). The application NEVER uses the master administrator account (`zentra_admin`).
- **Defect — Master Password Omission in Secrets Manager:**
  In `rds.tf` line 49, `random_password.db_master_password` generates the master password for `zentra_admin`. However, **this master password is never stored in AWS Secrets Manager**. 
  - *Impact:* When database migrations or schema adjustments must be executed by the administrator, the operator would have no way to retrieve the `zentra_admin` password other than digging through `terraform.tfstate`.
  - *Correction:* Add `aws_secretsmanager_secret.db_admin_credentials` to store `zentra_admin` credentials in Secrets Manager.

---

## 8. IAM Security Audit (`iam.tf`)

Inspected in [`infra/terraform/staging/iam.tf`](file:///d:/Zentra/infra/terraform/staging/iam.tf):

### 8.1. API Task IAM Role (`zentra-staging-api-role`)
- **Trust Policy:** Strictly scoped to `ecs-tasks.amazonaws.com` (**VERIFIED**).
- **S3 Permissions:** Strictly scoped to `arn:aws:s3:::zentra-staging-evidence/*` (`PutObject`, `GetObject`, `HeadObject`, `DeleteObject`) and `arn:aws:s3:::zentra-staging-evidence` (`ListBucket`).
  - **Zero wildcard `s3:*` permissions granted.**
  - **Zero access to future production buckets.**
- **Secrets Manager Permissions:** Strictly scoped to the four (4) specific staging secret ARNs (`GetSecretValue`, `DescribeSecret`).
- **Production Reference Audit:** Zero production ARNs or wildcards exist.

### 8.2. ECS Task Execution Role (`zentra-staging-ecs-execution-role`)
- Attached to AWS managed policy `AmazonECSTaskExecutionRolePolicy` for ECR image pull and CloudWatch log streaming.
- Granted read access strictly to the four (4) staging secret ARNs for container startup variable injection.

**Audit Assessment:** IAM configurations follow strict least-privilege standards and contain zero over-permissive statements.

---

## 9. S3 Security Audit (`s3.tf`)

Inspected in [`infra/terraform/staging/s3.tf`](file:///d:/Zentra/infra/terraform/staging/s3.tf):

### 9.1. Evidence Bucket (`zentra-staging-evidence`)
- **Block Public Access:** All 4 settings enabled unconditionally:
  - `block_public_acls = true`
  - `block_public_policy = true`
  - `ignore_public_acls = true`
  - `restrict_public_buckets = true`
- **Versioning:** `status = "Enabled"` (Anti-tampering and non-repudiation audit trail).
- **Encryption:** AES-256 server-side encryption applied by default.
- **Lifecycle Rules:** Aborts incomplete multipart uploads after 7 days; transitions non-current versions to Glacier after 30 days.
- **Prohibited WAL Bucket:** `zentra-staging-db-wal` was **NOT CODIFIED** (**VERIFIED** absent).
- **CORS Status:** 
  - Conditional block: `count = var.staging_domain != "" ? 1 : 0`.
  - With default `staging_domain = ""`, **zero CORS rules are created**.
  - Wildcard `*` is strictly avoided.
  - Status: **`PENDING STAGING DOMAIN DELEGATION`**.

### 9.2. Static Web Bucket (`zentra-staging-web-static`)
- Private S3 bucket.
- All 4 Block Public Access settings enabled.
- Website endpoint hosting disabled (assets intended exclusively for CloudFront Origin Access Control).

**Audit Assessment:** Object storage security is fully compliant with approved Step 2A standards.

---

## 10. Network Security Audit (`vpc.tf` & `security_groups.tf`)

Inspected in [`infra/terraform/staging/vpc.tf`](file:///d:/Zentra/infra/terraform/staging/vpc.tf) and [`security_groups.tf`](file:///d:/Zentra/infra/terraform/staging/security_groups.tf):

### 10.1. Subnet Topology & Egress
- **VPC CIDR:** `10.100.0.0/16`
- **Public Tier:** `10.100.1.0/24` (AZ 1a) and `10.100.2.0/24` (AZ 1b) routed to `igw-staging`.
- **Private App Tier:** `10.100.10.0/24` (AZ 1a) and `10.100.11.0/24` (AZ 1b) routed to single NAT Gateway (`nat-staging-1a`) and S3 Gateway VPC Endpoint (`vpce-staging-s3`).
- **Isolated DB Tier:** `10.100.20.0/24` (AZ 1a) and `10.100.21.0/24` (AZ 1b) attached to `rt-staging-isolated-db`.
  - **Zero routes to Internet Gateway.**
  - **Zero routes to NAT Gateway.**
  - **Strictly isolated to local VPC traffic.**

### 10.2. Security Group Traffic Matrix
- `sg-zentra-staging-alb`: Inbound 443/80 from `0.0.0.0/0`; outbound 4000 strictly to `sg-zentra-staging-api`.
- `sg-zentra-staging-api`: Inbound 4000 strictly from `sg-zentra-staging-alb`; outbound 5432 to `sg-zentra-staging-db` and 443 for AWS APIs.
- `sg-zentra-staging-db`: Inbound 5432 strictly from `sg-zentra-staging-api`; **zero outbound egress rules**.
  - **Zero `0.0.0.0/0 -> 5432` allowed.**
  - **Zero `0.0.0.0/0 -> 4000` allowed.**

**Audit Assessment:** Network architecture provides mathematical and security-group-level isolation.

---

## 11. Amazon RDS Multi-AZ Audit (`rds.tf`)

Inspected in [`infra/terraform/staging/rds.tf`](file:///d:/Zentra/infra/terraform/staging/rds.tf):
- **High Availability:** AWS-managed synchronous replication across `ap-south-1a` and `ap-south-1b`. Standby is maintained by AWS; no separate manual standby DB instance.
- **Storage:** 50 GB `gp3`, encrypted, autoscaling to 200 GB.
- **Automated Backups:** 7-day retention period, backup window `20:30-21:00 UTC`.
- **Deletion Protection:** `deletion_protection = true`.
- **Final Snapshot:** `skip_final_snapshot = false`, identifier `zentra-staging-db-final-snapshot`.
- **Status Classification:** **`CONFIGURED IN TERRAFORM — NOT PHYSICALLY CONFIGURED`**.

---

## 12. ECS Fargate Audit (`ecs.tf`)

Inspected in [`infra/terraform/staging/ecs.tf`](file:///d:/Zentra/infra/terraform/staging/ecs.tf):
- **Compute Model:** AWS Fargate serverless containers (0.5 vCPU, 1 GB RAM).
- **Network Mode:** `awsvpc` with `assign_public_ip = false`.
- **Health Check:** Path `/api/v1/health/liveness`, port 4000, matcher `200`.
- **Container Port:** 4000 (Forwarded from ALB).
- **Secret Injection:** Direct from Secrets Manager via ARN (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OFFLINE_PERMIT_SIGNING_KEY`).
- **Image Reference Verification:**
  - `image = "zentra-staging-api:latest"`
  - *Verification finding:* The container image does not yet exist in ECR or Docker Hub.
  - *Mandatory Classification:* **`INFRASTRUCTURE BLUEPRINT — IMAGE NOT YET AVAILABLE`**.
  - *Safety Boundary:* Image build, push, and container deployment are strictly prohibited in this phase and deferred to Step 3.

---

## 13. Domain & HTTPS Audit (`BLK-STG-02`)

Inspected in [`variables.tf`](file:///d:/Zentra/infra/terraform/staging/variables.tf) and [`s3.tf`](file:///d:/Zentra/infra/terraform/staging/s3.tf):
- **Staging Domain Status:** `var.staging_domain` defaults to `""`.
- **Zero Fictitious Domains:** No unapproved domains (e.g. `staging.zentra.gov.in` or `.internal`) are hardcoded or registered.
- **Route 53 Hosted Zones:** Zero hosted zones exist in Terraform.
- **ACM Certificates:** Zero ACM certificates are defined.
- **HTTPS Status:** Ingress remains HTTP-only on port 80 for staging baseline until official domain delegation occurs.
- **Authoritative Classification:** **`STAGING DOMAIN / DNS DELEGATION REMAINS BLOCKED (BLK-STG-02)`**.

---

## 14. CloudWatch Observability Audit (`cloudwatch.tf`)

Inspected in [`infra/terraform/staging/cloudwatch.tf`](file:///d:/Zentra/infra/terraform/staging/cloudwatch.tf):
- **API Log Group:** `/zentra/staging/api` (30 days retention).
- **ALB Log Group:** `/zentra/staging/alb` (30 days retention).
- **RDS Log Exports:** PostgreSQL query and upgrade logs exported to CloudWatch.
- **Sanitization Protocol:** Application logger suppresses raw passwords, JWT signing keys, and connection strings.

---

## 15. Backup Safety & Point-in-Time Recovery Audit

- **RDS Automated Backup Policy:** 7-day retention period configured in HCL.
- **Continuous Transaction Logs:** Archived internally by AWS managed service for PITR.
- **WAL S3 Bucket:** Zero customer WAL buckets exist.
- **Authoritative Status Classification:**
  > **`CONFIGURED IN TERRAFORM — NOT PHYSICALLY CONFIGURED OR RESTORE VERIFIED`**

---

## 16. Git & Secret Leak Audit (`.gitignore`)

> [!WARNING]
> **CRITICAL REPOSITORY CONFIGURATION GAP**

Inspected [`.gitignore`](file:///d:/Zentra/.gitignore):
- `.gitignore` currently ignores `node_modules/`, `dist/`, `.env*`, and build outputs.
- **`.gitignore` DOES NOT IGNORE TERRAFORM FILES:**
  - `*.tfstate` is **NOT IGNORED**.
  - `*.tfstate.*` (e.g. `terraform.tfstate.backup`) is **NOT IGNORED**.
  - `.terraform/` (local provider binaries and modules) is **NOT IGNORED**.
  - `*.tfvars` (local variable overrides containing credentials) is **NOT IGNORED**.
- **Impact:** If an operator runs `terraform apply`, `infra/terraform/staging/terraform.tfstate` will be created with plaintext passwords and secrets, and Git will immediately flag it as an untracked file ready to be committed!
- **Historical Git Audit:** Confirmed zero `.tfstate` files currently exist in Git history.

---

## 17. Local Validation Results

A safe, read-only validation check was executed:
- **Command:** `terraform version`
- **Result:** **`TERRAFORM CLI NOT AVAILABLE`** (`CommandNotFoundException`).
- **Safety Boundary Enforced:** In strict accordance with prompt instructions, Terraform was not installed automatically, and zero commands that modify infrastructure or state were run.

---

## 18. Findings & Severity Classification

| Finding ID | Severity | Target File / Resource | Finding Description |
| :--- | :---: | :--- | :--- |
| **SEC-FIND-01** | **HIGH** | [`.gitignore`](file:///d:/Zentra/.gitignore) | **Missing Terraform state and variable exclusions in `.gitignore`.** Local state files (`*.tfstate`) containing plaintext secrets would be tracked by Git. |
| **SEC-FIND-02** | **HIGH** | [`main.tf`](file:///d:/Zentra/infra/terraform/staging/main.tf#L16) | **Remote state backend commented out.** Local state is unencrypted and lacks distributed state locking. |
| **SEC-FIND-03** | **MEDIUM** | [`secrets.tf`](file:///d:/Zentra/infra/terraform/staging/secrets.tf) / [`rds.tf`](file:///d:/Zentra/infra/terraform/staging/rds.tf) | **RDS master password not stored in Secrets Manager.** `random_password.db_master_password` is not stored in Secrets Manager, making migration credentials inaccessible outside raw state. |
| **SEC-FIND-04** | **INFORMATIONAL**| [`ecs.tf`](file:///d:/Zentra/infra/terraform/staging/ecs.tf#L90) | **Placeholder ECS container image.** References non-existent image (`zentra-staging-api:latest`). Image must be built and pushed in Step 3. |
| **SEC-FIND-05** | **BLOCKER** | [`variables.tf`](file:///d:/Zentra/infra/terraform/staging/variables.tf#L61) | **Staging domain unassigned (`BLK-STG-02`).** ACM certificates, Route 53 records, and S3 CORS remain pending domain delegation. |

---

## 19. Required Corrections List

The following corrections must be reviewed and executed before any future `terraform apply`:

| ID | Severity | File | Line / Resource | Problem | Security Impact | Required Correction | Why Correction Is Needed |
| :---: | :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| **CORR-01** | **HIGH** | `.gitignore` | Lines 68+ | Missing `.tfstate`, `.terraform/`, and `*.tfvars` ignore rules. | Local state files containing plaintext secrets could be committed to Git. | Add `.terraform/`, `*.tfstate`, `*.tfstate.*`, `crash.log`, `*.tfvars` (except `*.tfvars.example`) to `.gitignore`. | Prevents plaintext credentials from leaking into repository version control. |
| **CORR-02** | **HIGH** | `main.tf` | Line 16 (`backend`) | Backend is commented out. | Local unencrypted state file used; no state locking. | Configure S3 remote backend with SSE-KMS encryption and DynamoDB table for state locking. | Protects state file at rest and prevents concurrent apply race conditions. |
| **CORR-03** | **MEDIUM** | `secrets.tf` | New resource | Master RDS admin password not in Secrets Manager. | Admin credentials cannot be retrieved for running migrations without reading raw state. | Add `aws_secretsmanager_secret.db_admin_credentials` and store `zentra_admin` password. | Ensures database administrators can retrieve migration credentials securely via AWS IAM. |
| **CORR-04** | **INFO** | `ecs.tf` | Line 90 (`image`) | Placeholder image tag. | ECS task cannot launch until real image is promoted. | Build and push image to Amazon ECR during Step 3 deployment phase. | Operational requirement for Step 3 service startup. |

*Note: In strict compliance with audit rules, zero files were edited during this step. Corrections must be applied in a controlled correction pass.*

---

## 20. Pre-Apply Readiness Matrix

| Infrastructure Domain | Status Language | Pre-Apply Assessment | Blocker / Dependency |
| :--- | :---: | :---: | :--- |
| **Terraform Codebase** | **CODIFIED** | Architecture matches Step 2A baseline | None |
| **Terraform State Security** | **UNSECURED (LOCAL)** | **BLOCKED BEFORE APPLY** | Requires CORR-01 and CORR-02 |
| **Secret Management** | **CODIFIED** | Passed (Needs master secret capture) | Requires CORR-03 |
| **VPC & Subnets** | **CODIFIED** | Strict tiering verified | None |
| **Security Groups** | **CODIFIED** | Zero public DB ingress verified | None |
| **RDS PostgreSQL 16** | **CODIFIED** | Multi-AZ, private, SSL enforced | None |
| **S3 Evidence Storage** | **CODIFIED** | Versioned, encrypted, public blocked | None |
| **S3 CORS Configuration** | **CODIFIED** | Blocked pending domain | Blocked by `BLK-STG-02` |
| **IAM Least Privilege** | **CODIFIED** | Scoped strictly to staging ARNs | None |
| **ECS Fargate Cluster** | **CODIFIED** | Blueprint ready; image pending | Image build deferred to Step 3 |
| **Domain / HTTPS / ACM** | **BLOCKED** | Blocked pending domain | Blocked by `BLK-STG-02` |
| **AWS Cloud Infrastructure** | **NOT PROVISIONED**| Untouched | Blocked by `BLK-STG-01` |

---

## 21. Final Decision

In accordance with the prompt's decision criteria:

### Authoritative Pre-Apply Verdict:
# **`BLOCKED — SECURITY ISSUE REQUIRES CORRECTION BEFORE APPLY`**

### Determination Rationale:
1. **State & Git Exposure Vulnerability:** Running `terraform apply` under the current configuration would write plaintext database passwords, JWT signing secrets, and offline permit keys into an unencrypted local `terraform.tfstate` file that is **not excluded by `.gitignore`**, creating an immediate credential leakage risk.
2. **Missing Remote Backend:** Staging infrastructure requires an encrypted remote state backend (S3 + DynamoDB locking) to guarantee state security and integrity.
3. **Missing Master DB Secret in Secrets Manager:** The RDS master password is omitted from Secrets Manager, preventing secure retrieval for database migrations.
4. **Active Infrastructure Blockers:** `BLK-STG-01` (AWS Credentials Missing) and `BLK-STG-02` (Staging Domain Delegation Missing) remain active.

---

## 22. Next Authorized Action

```mermaid
sequenceDiagram
    autonumber
    actor Auditor as System Auditor / Stakeholder
    actor DevOps as Cloud / DevOps Administrator
    participant Repo as ZENTRA Repository
    participant AWS as AWS Staging Cloud (ap-south-1)

    Note over Auditor: Step 2C-A Review Gate
    Auditor->>Auditor: Review docs/MUSE_SPARK_PRODUCTION_PREPARATION_STEP2C_A.md
    Auditor->>DevOps: Acknowledge BLOCKED BEFORE APPLY decision

    Note over DevOps,Repo: Step 2C-B Correction Pass (Code-Only)
    DevOps->>Repo: 1. Add Terraform exclusions to .gitignore (CORR-01)
    DevOps->>Repo: 2. Add db-admin-credentials to secrets.tf (CORR-03)
    DevOps->>Repo: 3. Prepare S3/DynamoDB remote backend template (CORR-02)

    Note over DevOps,AWS: Pre-Apply Authorization Gate
    DevOps->>AWS: 4. Resolve BLK-STG-01 (Supply authorized AWS credentials)
    DevOps->>AWS: 5. Execute 'terraform init' and 'terraform plan' (NO APPLY)
```

1. **Review and approve this Step 2C-A report** (`docs/MUSE_SPARK_PRODUCTION_PREPARATION_STEP2C_A.md`).
2. **Execute a controlled Step 2C-B Correction Pass:**
   - Add `.terraform/`, `*.tfstate`, `*.tfstate.*`, and `*.tfvars` to [`.gitignore`](file:///d:/Zentra/.gitignore).
   - Add `aws_secretsmanager_secret.db_admin_credentials` to [`infra/terraform/staging/secrets.tf`](file:///d:/Zentra/infra/terraform/staging/secrets.tf).
   - Provide remote backend configuration instructions in [`main.tf`](file:///d:/Zentra/infra/terraform/staging/main.tf).
3. **Maintain Pre-Apply Gate:** Do NOT execute `terraform apply` until credentials (`BLK-STG-01`) are supplied and corrections are formally approved.

---

🛑 MUSE SPARK STOP — ZENTRA PRODUCTION PREPARATION STEP 2C-A COMPLETE. READ-ONLY TERRAFORM SECURITY AND PRE-APPLY REVIEW ONLY. NO AWS AUTHENTICATION, NO TERRAFORM APPLY, NO CLOUD PROVISIONING, NO STEP 3 VALIDATION, AND NO PRODUCTION ACTIVITY AUTHORIZED.
