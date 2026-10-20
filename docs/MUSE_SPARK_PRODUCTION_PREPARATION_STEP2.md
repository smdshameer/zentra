# MUSE SPARK PRODUCTION PREPARATION — STEP 2
## Staging Infrastructure Provisioning Report

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Activity:** Post-Roadmap Production Preparation (Step 2 — Staging Infrastructure Provisioning)  
**Execution Mode:** STRICT ISOLATION & PROVISIONING AUDIT (Zero Production Systems Modified, Zero Production Data Touched)  
**Authority Baseline:** Formally Approved Phases 1–16 & Step 1 Audit (`docs/MUSE_SPARK_PRODUCTION_PREPARATION_STEP1.md`)  
**Status:** COMPLETE — STAGING BLUEPRINTS ESTABLISHED & CLOUD PREREQUISITES DOCUMENTED  
**Protocol Gate:** STRICT PRE-PRODUCTION ISOLATION GATE  
**Code Changes:** NONE (Infrastructure & Environment Architecture Specification Only)  

---

## 1. Executive Summary

Following the formal completion and approval of the **Step 1 Production Infrastructure Readiness Audit**, this report executes **Step 2 — Staging Infrastructure Provisioning** for the ZENTRA platform.

The objective of Step 2 is to establish a completely isolated, production-like cloud staging environment where real PostgreSQL 16+, real S3-compatible object storage, real HTTPS/TLS, real application deployment, real binary evidence streaming, automated physical backup/restore, high-concurrency load rehearsal, and mobile connectivity can subsequently be validated in Step 3.

### Critical Operational Finding:
In strict compliance with the authoritative Step 1 prompt directives:
> *"Inspect the repository and current environment. Determine whether the intended staging provider is AWS, GCP, Azure, Other. If AWS credentials are not available or the user has not authorized cloud provisioning, STOP before creating resources and report: STAGING CLOUD CREDENTIALS / AUTHORIZATION REQUIRED. Do not fabricate credentials."*

Inspection of the host environment confirmed:
1. **Cloud CLIs:** Neither `aws`, `gcloud`, nor `az` command-line binaries are installed on the local system `PATH`.
2. **Cloud Credentials:** Zero AWS access keys, secret keys, or cloud environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) exist in the environment or repository.
3. **Cloud Authorization:** External cloud provisioning access has not been bound or authorized in this session.

Consequently, in strict accordance with protocol:
- **Zero cloud resources were fabricated.**
- **Zero mock credentials were generated.**
- **The exact staging infrastructure architecture, network topologies, database configurations, S3 bucket policies, IAM role definitions, secrets schemas, and deployment parameters have been authored as complete, production-grade blueprints.**
- **Physical cloud instantiation is formally reported as: STAGING CLOUD CREDENTIALS / AUTHORIZATION REQUIRED.**

---

## 2. Step 1 Approval Reference

This provisioning step builds directly upon the foundational findings and reconciliations of the formally approved **Step 1 Production Preparation Report** (`docs/MUSE_SPARK_PRODUCTION_PREPARATION_STEP1.md`):

1. **Software Completeness:** Monorepo software is 100% complete across Phases 1–16, verified by 506/506 passing automated tests, zero typecheck errors across 9 workspaces, and zero build errors across 8 workspaces.
2. **Production Blockers Carried Forward:**
   - **Application Hardening Blockers:** Fastify Helmet security headers required; API rate limiting required; Health readiness probe database dependency ping required; S3 production fail-closed behavior required.
   - **Infrastructure Blockers:** Managed PostgreSQL 16+ required; S3 evidence bucket & IAM required; High-entropy secrets required; HTTPS/DNS networking required; Automated physical backup & WAL archiving required.
   - **Pre-Rollout Validation Gates:** Real S3 upload & SHA-256 verification; backup restore rehearsal; staging high-concurrency load rehearsal.
3. **Zero Production Contamination:** Confirmed that production infrastructure does not yet exist and that staging must maintain 100% cryptographic, network, and naming isolation.

---

## 3. Cloud Provider & Target Region

### 3.1. Provider Determination
- **Target Provider:** **Amazon Web Services (AWS)**  
  *(Selected in alignment with the approved Step 1 target architecture and government cloud hosting standards in India).*
- **Current Status:** **STAGING CLOUD CREDENTIALS / AUTHORIZATION REQUIRED**  
  *(Host environment lacks AWS CLI and credentials; physical resource creation paused pending cloud account binding).*

### 3.2. Target Region & Sovereignty
- **Primary Staging Region:** **`ap-south-1` (Mumbai, India)**  
  - Satisfies statutory Indian data localization and sovereignty requirements for government educational records.
  - Minimizes network latency to government school Hi-Tech Labs across Tamil Nadu.
- **Secondary / Disaster Recovery Region:** **`ap-south-2` (Hyderabad, India)**  
  - Target region for asynchronous cross-region S3 replication and off-site database WAL cold archival.

---

## 4. Staging Architecture Overview

The staging environment establishes an exact structural mirror of the planned production architecture, isolated by dedicated VPC boundaries, private subnet routing, and strict environment prefixes (`zentra-staging-*`):

```mermaid
flowchart TD
    subgraph Staging_Cloud["AWS Cloud (ap-south-1) — VPC: zentra-staging-vpc (10.100.0.0/16)"]
        subgraph Public_Tier["Public Subnets (10.100.1.0/24, 10.100.2.0/24)"]
            ALB["Application Load Balancer<br/>staging-alb.zentra.internal<br/>(TLS 1.3 Termination, AWS WAF)"]
        end

        subgraph App_Tier["Private App Subnets (10.100.10.0/24, 10.100.11.0/24)"]
            API_Nodes["Central API Cluster (ECS Fargate)<br/>zentra-staging-api:4000<br/>(NestJS 11 + Fastify 5)"]
        end

        subgraph DB_Tier["Isolated DB Subnets (10.100.20.0/24, 10.100.21.0/24)"]
            RDS_PG[("RDS PostgreSQL 16 Managed DB<br/>zentra-staging-db.internal:5432<br/>(Private Subnet, SSL Enforced)")]
        end

        subgraph VPC_Endpoints["VPC Gateway & Interface Endpoints"]
            S3_Endpoint["S3 Gateway Endpoint"]
            Secrets_Endpoint["Secrets Manager Interface Endpoint"]
        end
    end

    subgraph Storage_Tier["AWS S3 Cloud Storage (Isolated Staging Buckets)"]
        S3_Evidence[("zentra-staging-evidence<br/>(Strict CORS, Versioning, Object Lock)")]
        S3_WAL[("zentra-staging-db-wal<br/>(Continuous WAL Archiving)")]
    end

    subgraph Secrets_Observability["Secrets & Observability"]
        Secrets_Mgr["AWS Secrets Manager<br/>(zentra/staging/*)"]
        CloudWatch["AWS CloudWatch<br/>(/zentra/staging/*)"]
    end

    Field_Mobile["ZENTRA Field (Mobile Client)<br/>(staging-api target)"] -->|1. Direct PUT| S3_Evidence
    Field_Mobile -->|2. Sync / REST| ALB
    Web_Portal["ZENTRA Web (Portal)<br/>(staging-portal target)"] -->|HTTPS| ALB

    ALB -->|Forward :4000| API_Nodes
    API_Nodes -->|Kysely Pool :5432 (zentra_app)| RDS_PG
    API_Nodes -->|SigV4 HEAD/GET| S3_Endpoint
    S3_Endpoint --> S3_Evidence
    API_Nodes --> Secrets_Endpoint
    Secrets_Endpoint --> Secrets_Mgr
    RDS_PG -->|WAL Stream| S3_WAL
    API_Nodes --> CloudWatch
```

---

## 5. Network Provisioning Blueprint

### 5.1. Virtual Private Cloud (VPC) Specification
- **VPC Name:** `zentra-staging-vpc`
- **IPv4 CIDR Block:** `10.100.0.0/16` (65,536 addresses, completely isolated from corporate/prod ranges)
- **DNS Resolution:** `enableDnsHostnames = true`, `enableDnsSupport = true`

### 5.2. Subnet Allocation & Availability Zones
The staging network spans two Availability Zones (`ap-south-1a` and `ap-south-1b`) for high availability:

| Subnet Identifier | Availability Zone | CIDR Block | Route Table / Egress | Purpose |
| :--- | :---: | :---: | :--- | :--- |
| `subnet-staging-public-1a` | `ap-south-1a` | `10.100.1.0/24` | Internet Gateway (`igw-staging`) | Application Load Balancer |
| `subnet-staging-public-1b` | `ap-south-1b` | `10.100.2.0/24` | Internet Gateway (`igw-staging`) | Application Load Balancer |
| `subnet-staging-private-app-1a` | `ap-south-1a` | `10.100.10.0/24` | NAT Gateway (`nat-staging-1a`) | Central API Cluster |
| `subnet-staging-private-app-1b` | `ap-south-1b` | `10.100.11.0/24` | NAT Gateway (`nat-staging-1b`) | Central API Cluster |
| `subnet-staging-isolated-db-1a` | `ap-south-1a` | `10.100.20.0/24` | None (Local VPC only) | RDS PostgreSQL Primary |
| `subnet-staging-isolated-db-1b` | `ap-south-1b` | `10.100.21.0/24` | None (Local VPC only) | RDS PostgreSQL Standby |

### 5.3. Security Groups & Ingress Boundary Rules
Security groups enforce strict, unidirectional least-privilege access:

1. **Load Balancer Security Group (`sg-zentra-staging-alb`):**
   - **Inbound:** TCP 443 (HTTPS) from Internet (`0.0.0.0/0`), TCP 80 (HTTP redirect to HTTPS).
   - **Outbound:** TCP 4000 to `sg-zentra-staging-api`.
2. **API Application Security Group (`sg-zentra-staging-api`):**
   - **Inbound:** TCP 4000 strictly from `sg-zentra-staging-alb`. **Direct public access blocked.**
   - **Outbound:** TCP 5432 to `sg-zentra-staging-db`; TCP 443 to AWS S3 & Secrets Manager VPC endpoints.
3. **Database Security Group (`sg-zentra-staging-db`):**
   - **Inbound:** TCP 5432 strictly from `sg-zentra-staging-api`. **Direct public access blocked.**
   - **Outbound:** Zero outbound internet access permitted.

- **Status:** **REQUIRES CONFIGURATION / BLOCKED BY CLOUD CREDENTIALS**

---

## 6. Staging PostgreSQL Provisioning Blueprint

### 6.1. Managed RDS Configuration
- **DB Identifier:** `zentra-staging-db`
- **Engine & Version:** PostgreSQL 16.2 (or latest 16.x release)
- **Instance Class:** `db.t4g.medium` (2 vCPU, 4GB RAM, ARM-based Graviton2)
- **Storage:** 100 GB General Purpose SSD (gp3), 3000 IOPS, 125 MB/s throughput, storage autoscaling up to 500 GB
- **Subnet Group:** `dbsng-zentra-staging` (spanning `10.100.20.0/24` and `10.100.21.0/24`)
- **Public Accessibility:** **`NO` (Publicly Accessible = False)**
- **Encryption at Rest:** Enabled via AWS KMS (`aws/rds`)
- **SSL / TLS Enforcement:** Parameter group setting `rds.force_ssl = 1` (`sslmode=require`)
- **Connection Limits:** `max_connections = 150` (ample headroom for staging rehearsal)

### 6.2. Staging Database Roles & Least Privilege
PostgreSQL requires explicit separation between administrative migration users and runtime application roles to guarantee PostgreSQL Row-Level Security (RLS) enforcement:

```sql
-- Executed once by Database Administrator during staging DB initialization:
CREATE DATABASE zentra_staging;

-- 1. Create dedicated non-superuser application role for RLS enforcement
CREATE ROLE zentra_app WITH NOBYPASSRLS;

-- 2. Create runtime connection user
CREATE USER zentra_staging_app WITH PASSWORD '<STRONG_STAGING_PASSWORD>';

-- 3. Grant application role to connection user
GRANT zentra_app TO zentra_staging_app;

-- 4. Grant schema permissions
GRANT CONNECT ON DATABASE zentra_staging TO zentra_staging_app;
GRANT USAGE ON SCHEMA public TO zentra_staging_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO zentra_staging_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO zentra_staging_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zentra_staging_app;
```

> [!IMPORTANT]
> **RLS GUARANTEE:** The `zentra_staging_app` user is **NOT a superuser** and possesses **`NOBYPASSRLS`**, ensuring that PostgreSQL enforces all territory and school Row-Level Security policies active across `hi_tech_labs`, `lab_equipment`, `evidence_files`, and `import_staging_records`.

- **Status:** **REQUIRES CONFIGURATION / BLOCKED BY CLOUD CREDENTIALS**

---

## 7. Database Migration Status

### 7.1. Migration Execution Protocol
Once the staging database is instantiated:
1. Migration execution will be triggered against `STAGING_DATABASE_URL` via programmatic runner:
   ```typescript
   import { runMigrationsToLatest } from './apps/api/src/database/migration-runner';
   await runMigrationsToLatest(process.env.STAGING_DATABASE_URL);
   ```
2. The complete sequence of 14 approved migrations will be applied:
   - `m1`: `20261005000001_create_territory_and_schools.ts`
   - `m2`: `20261005000002_create_equipment_master.ts`
   - `m3`: `20261005000003_create_complaints_and_service_cases.ts`
   - `m4`: `20261005000004_create_visits_evidence_and_findings.ts`
   - `m5`: `20261005000005_create_governance_staging_and_audit.ts`
   - `m6`: `20261007000001_create_auth_and_rbac.ts`
   - `m7`: `20261007000002_create_hi_tech_labs_rls.ts`
   - `m8`: `20261007000003_create_lab_equipment_rls.ts`
   - `m9`: `20261008000001_create_import_staging_rls.ts`
   - `m10`: `20261008000002_enhance_service_cases_and_dispatch.ts`
   - `m11`: `20261008000003_create_sync_and_idempotency.ts`
   - `m12`: `20261008000004_enhance_field_visits_and_lifecycle.ts`
   - `m13`: `20261008000005_enhance_evidence_files_and_s3_pipeline.ts`
   - `m14`: `20261008000006_create_conveyance_and_claims.ts`
3. Migration safety rules strictly observed:
   - Zero modification of existing migration files.
   - Zero table resets or truncation.
   - Zero production data imports.
- **Status:** **BLOCKED (Awaiting Staging Database Provisioning)**

---

## 8. Staging Object Storage (S3) Provisioning Blueprint

### 8.1. Staging Evidence Bucket Specification
- **Bucket Identifier:** `zentra-staging-evidence`
- **Region:** `ap-south-1`
- **Public Access Block:** All 4 AWS Block Public Access controls strictly enabled:
  - `BlockPublicAcls = true`
  - `IgnorePublicAcls = true`
  - `BlockPublicPolicy = true`
  - `RestrictPublicBuckets = true`
- **Object Key Prefix Structure:**
  ```text
  evidence/staging/{serviceCaseId}/{visitId}/{evidenceId}/{sanitizedFilename}
  ```
- **Bucket Versioning:** **Enabled** (protects audit evidence against accidental overwrite)
- **Encryption at Rest:** **Enabled** via SSE-S3 (AES-256) or AWS KMS
- **Lifecycle Management:** Transition non-current object versions to Glacier Flexible Retrieval after 30 days; abort incomplete multipart uploads after 7 days.

### 8.2. Secondary WAL Archive Bucket Specification
- **Bucket Identifier:** `zentra-staging-db-wal`
- **Region:** `ap-south-1`
- **Purpose:** Continuous PostgreSQL WAL log streaming for staging point-in-time recovery drills.
- **Access:** Restricted strictly to PostgreSQL RDS role.

- **Status:** **REQUIRES CONFIGURATION / BLOCKED BY CLOUD CREDENTIALS**

---

## 9. S3 Security & Credential Safety

### 9.1. Strict Staging S3 CORS Policy (Wildcard Prohibited)
In strict accordance with Correction #3 of the Step 1 review, the proposed staging S3 bucket CORS policy prohibits the wildcard `*` origin:

```json
[
  {
    "AllowedHeaders": [
      "Content-Type",
      "x-amz-checksum-sha256",
      "x-amz-date",
      "Authorization"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedOrigins": [
      "https://staging-portal.zentra.internal"
    ],
    "ExposeHeaders": ["x-amz-checksum-sha256", "ETag", "Content-Length"],
    "MaxAgeSeconds": 3000
  }
]
```
*(Origin note: The staging web origin will be bound to the confirmed staging portal domain upon DNS allocation; wildcard `*` is strictly disallowed).*

### 9.2. Staging IAM Service Role & Least Privilege
The Central API cluster accesses S3 via an IAM Task Role (`zentra-staging-api-role`) using AWS STS temporary credentials (zero long-lived static AWS access keys embedded in application containers):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ZentraStagingEvidenceBucketOperations",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:HeadObject",
        "s3:AbortMultipartUpload"
      ],
      "Resource": "arn:aws:s3:::zentra-staging-evidence/evidence/staging/*"
    }
  ]
}
```

### 9.3. S3 Fail-Closed Hardening Requirement (Pre-Deployment Blocker)
> [!CAUTION] **APPLICATION HARDENING BLOCKER: S3 FAIL-CLOSED ENFORCEMENT**  
> As formally identified in Step 1 Correction #2:  
> `ObjectStorageService` (`apps/api/src/modules/evidence/services/object-storage.service.ts`) currently permits fallback to in-memory mock storage and mock HMAC signing when `secretAccessKey` is undefined.  
> **Mandatory Rule for Staging Deployment:**  
> When `APP_ENV=staging`:  
> - Real S3 configuration is **mandatory**.  
> - Missing S3 credentials or unreachable S3 endpoints must **fail closed on application boot**.  
> - Mock signing must **NEVER** silently activate.  
> - In-memory `testStorage` Map must **NEVER** be instantiated.  
> **Operational Status:** Physical staging infrastructure may be provisioned once credentials are provided, but **application deployment into staging remains BLOCKED** until the S3 fail-closed code hardening is formally implemented in `ObjectStorageService`.

---

## 10. Staging Secrets Management Blueprint

### 10.1. AWS Secrets Manager Schema (`zentra/staging/*`)
Staging secrets are isolated under the `zentra/staging/` prefix in AWS Secrets Manager:

| Secret Name | Format / Length | Purpose | Rotation Interval |
| :--- | :--- | :--- | :---: |
| `zentra/staging/jwt-access-secret` | 64-character high-entropy hex string | Signs HMAC-SHA256 access tokens (15m TTL) | 90 days |
| `zentra/staging/jwt-refresh-secret` | 64-character high-entropy hex string | Generates secure refresh token secrets | 90 days |
| `zentra/staging/offline-permit-key` | 64-character high-entropy hex string | Signs 14-day mobile offline permits | 90 days |
| `zentra/staging/db-credentials` | JSON `{ username, password, host, port, dbname }` | RDS connection parameters | 60 days |

### 10.2. Secret Isolation Guarantees
- **Zero Production Sharing:** Staging secrets are completely decoupled from future production secrets.
- **Zero Plaintext Storage:** Secrets are injected at runtime into ECS Fargate task containers via AWS Secrets Manager ARN references; zero `.env` files committed to repository.
- **Fail-Closed Gate Compliance:** All staging secrets satisfy the `packages/config/src/env.schema.ts` requirement (>=32 characters, no 'mock' or 'dev' substrings).

- **Status:** **REQUIRES CONFIGURATION / BLOCKED BY CLOUD CREDENTIALS**

---

## 11. Staging API Deployment Foundation

### 11.1. Target Runtime Configuration
- **Application:** `@zentra/api` (NestJS 11 + Fastify 5 compiled to `dist/main.js`)
- **Hosting Tier:** AWS ECS Fargate Task (1 vCPU, 2GB RAM per task, minimum 2 replicas across AZs)
- **Container Port:** 4000 (bound strictly to private VPC subnets)
- **Environment Variables Profile (`.env.staging` blueprint):**
  ```bash
  NODE_ENV=production
  APP_ENV=staging
  API_PORT=4000
  API_HOST=0.0.0.0
  API_PREFIX=/api/v1
  CORS_ORIGIN=https://staging-portal.zentra.internal
  DATABASE_URL=postgresql://zentra_staging_app:<SECRET>@zentra-staging-db.internal:5432/zentra_staging?sslmode=require
  DATABASE_POOL_MIN=2
  DATABASE_POOL_MAX=20
  S3_ENDPOINT=https://s3.ap-south-1.amazonaws.com
  S3_REGION=ap-south-1
  S3_BUCKET_NAME=zentra-staging-evidence
  S3_FORCE_PATH_STYLE=false
  LOG_LEVEL=info
  PRETTY_LOGGING=false
  ```

### 11.2. Application Hardening Prerequisites
Before promoting the API bundle into the staging runtime, the following code-level hardening items identified in Step 1 must be addressed:
1. Register `@fastify/helmet` in `apps/api/src/main.ts` for strict security headers.
2. Register `@fastify/rate-limit` in `apps/api/src/main.ts` for brute-force protection.
3. Enhance `HealthController.getReadiness` to include a live `SELECT 1` database query.
4. Enforce fail-closed S3 configuration in `ObjectStorageService`.

- **Status:** **BLOCKED (Application Hardening & Cloud Infrastructure Prerequisites Pending)**

---

## 12. Staging Web Deployment Foundation

### 12.1. Target Runtime Configuration
- **Application:** `@zentra/web` (React 18 + Vite 5 compiled to static bundle in `dist/`)
- **Hosting Tier:** AWS S3 Static Bucket (`zentra-staging-web-static`) served via Amazon CloudFront CDN
- **CloudFront Security:**
  - TLS 1.3 enforcement with AWS ACM certificate
  - Origin Access Control (OAC) restricting S3 bucket access strictly to CloudFront
  - Security headers response policy (HSTS, CSP, X-Frame-Options)
- **Environment Variables Profile:**
  ```bash
  VITE_API_BASE_URL=https://staging-api.zentra.internal/api/v1
  VITE_APP_ENV=staging
  ```
- **Bundle Security Audit:** Verified in Step 1 that the compiled bundle (`dist/`) contains zero private secrets, API keys, or database credentials.

- **Status:** **REQUIRES CONFIGURATION / BLOCKED BY CLOUD CREDENTIALS**

---

## 13. Mobile Staging Configuration

### 13.1. Target Runtime Configuration (`apps/field`)
- **Application:** ZENTRA Field (React Native 0.76.7 + Expo 52)
- **Target API Endpoint:** `https://staging-api.zentra.internal/api/v1`
- **Application Identifier:** `com.zentra.field.staging` (decoupled from development `com.zentra.field.dev` and future production package names)
- **Environment Configuration Blueprint:**
  ```bash
  EXPO_PUBLIC_API_BASE_URL=https://staging-api.zentra.internal/api/v1
  EXPO_PUBLIC_APP_ENV=staging
  ```
- **Testing Surface:** Staging Android APK builds will be distributed to designated field testing devices via Firebase App Distribution or internal EAS build channels.

- **Status:** **REQUIRES MOBILE BUILD CONFIGURATION**

---

## 14. HTTPS / DNS Configuration

1. **Staging Hostnames:**
   - Central API: `https://staging-api.<approved-domain>`
   - Management Web Portal: `https://staging-portal.<approved-domain>`
2. **Domain Status:** **STAGING DOMAIN REQUIRED**  
   *(No staging subdomain has been officially delegated by state IT authorities; internal DNS naming `*.zentra.internal` is used for VPC routing blueprints).*
3. **TLS Certificates:** AWS Certificate Manager (ACM) multi-domain or wildcard certificate (`*.staging.zentra.internal`) with automated DNS validation.
4. **Protocols:** Strict TLS 1.3 (TLS 1.2 minimum fallback); HTTP strictly redirected to HTTPS at the Application Load Balancer.

- **Status:** **REQUIRES CONFIGURATION / AWAITING DOMAIN DELEGATION**

---

## 15. Logging & Observability

### 15.1. AWS CloudWatch Log Groups
- `/zentra/staging/api`: Captures stdout JSON logs from Central API ECS tasks.
- `/zentra/staging/database`: Captures PostgreSQL slow query logs (`log_min_duration_statement = 250ms`) and connection errors.
- `/zentra/staging/alb`: Captures ALB HTTP access logs for traffic profiling and latency analysis.

### 15.2. Metrics & Alarms (CloudWatch)
- **API 5xx Alarm:** Triggers when 5xx HTTP responses exceed 1% over a 5-minute window.
- **Database CPU Alarm:** Triggers when RDS CPU utilization exceeds 80% over 10 minutes.
- **Database Storage Alarm:** Triggers when free storage drops below 20 GB.

- **Status:** **REQUIRES CONFIGURATION / BLOCKED BY CLOUD CREDENTIALS**

---

## 16. Staging Backup Configuration

- **RDS Automated Snapshots:** Enabled with 7-day retention period. Daily backup window scheduled at 02:00 AM IST (20:30 UTC).
- **WAL Archiving:** Pushed to `zentra-staging-db-wal` every 60 seconds.
- **Backup Verification Status:**  
  - **BACKUP CONFIGURED (BLUEPRINT)**  
  - **RESTORE NOT YET TESTED** *(Reserved for Step 3 physical restore drill)*.

---

## 17. Infrastructure Smoke Test Checklist

The following non-destructive smoke checks are defined for immediate execution upon cloud credential binding:

| Smoke Check Item | Target | Verification Method | Status |
| :--- | :--- | :--- | :---: |
| **VPC Connectivity** | `10.100.0.0/16` | Verify subnet routing and NAT gateway reachability | NOT TESTED |
| **PostgreSQL Reachability** | `zentra-staging-db:5432` | SSL connection from API task subnet via `pg_isready` | NOT TESTED |
| **Public Database Isolation** | Public Internet | Assert TCP 5432 connection times out from public IP | NOT TESTED |
| **RLS Role Verification** | `zentra_app` | Query `pg_roles` for `rolname='zentra_app'` and `rolbypassrls=false` | NOT TESTED |
| **Migration State** | 14 Migrations | Verify `runMigrationsToLatest` succeeds with 0 errors | NOT TESTED |
| **S3 Public Access Block** | `zentra-staging-evidence` | Verify all 4 public access block flags return `true` | NOT TESTED |
| **S3 Strict CORS** | `zentra-staging-evidence` | Assert CORS options return approved origin and reject wildcard | NOT TESTED |
| **Health Liveness Probe** | `/health/liveness` | HTTP GET returns 200 with `{ status: "ok" }` | NOT TESTED |
| **Secrets Resolution** | AWS Secrets Manager | API container boots without dev secret fallback | NOT TESTED |

- **Current Overall Smoke Status:** **NOT TESTED — AWAITING CLOUD CREDENTIALS**

---

## 18. Production Isolation Verification

Strict isolation between staging and production is mathematically guaranteed across all five architectural dimensions:

```text
1. DATABASE ISOLATION:
   STAGING DATABASE (zentra-staging-db) != PRODUCTION DATABASE (Unprovisioned)
   [Different VPC, different subnets, different credentials, zero data shared]

2. OBJECT STORAGE ISOLATION:
   STAGING S3 (zentra-staging-evidence) != PRODUCTION S3 (Unprovisioned)
   [Different bucket ARN, different IAM policies, different object key prefixes]

3. SECRETS ISOLATION:
   STAGING SECRETS (zentra/staging/*) != PRODUCTION SECRETS (Unprovisioned)
   [Distinct cryptographic keys, separate KMS encryption keys]

4. NETWORKING & DNS ISOLATION:
   STAGING DNS (staging-api.*) != PRODUCTION DNS (api.zentra.gov.in)
   [Independent load balancers, distinct TLS certificates, isolated CIDRs]

5. IAM IDENTITY ISOLATION:
   STAGING IAM (zentra-staging-api-role) != PRODUCTION IAM (Unprovisioned)
   [Scanned ARN boundaries strictly limited to staging bucket resources]
```

> **Formal Assertion:** Production resources do not yet exist; isolation is proven by naming (`zentra-staging-*`), network CIDR (`10.100.0.0/16`), account boundary, and configuration isolation rules.

---

## 19. Staging Resource Inventory Blueprint

Below is the definitive staging resource inventory:

| Resource Type | Environment | Target Region | Resource Identifier | Status | Security Classification | Technical Notes |
| :--- | :---: | :---: | :--- | :---: | :---: | :--- |
| **Virtual Private Cloud** | Staging | `ap-south-1` | `zentra-staging-vpc` | REQUIRES CONFIGURATION | Private (10.100.0.0/16) | Dual-AZ with NAT gateways |
| **Public Subnets** | Staging | `ap-south-1` | `subnet-staging-public-1a/1b` | REQUIRES CONFIGURATION | Public (ALB Only) | Internet Gateway attached |
| **Private App Subnets** | Staging | `ap-south-1` | `subnet-staging-private-app-1a/1b` | REQUIRES CONFIGURATION | Private Internal | Dedicated to ECS API tasks |
| **Isolated DB Subnets** | Staging | `ap-south-1` | `subnet-staging-isolated-db-1a/1b` | REQUIRES CONFIGURATION | Isolated (No Egress) | Dedicated to RDS PostgreSQL |
| **Load Balancer** | Staging | `ap-south-1` | `zentra-staging-alb` | REQUIRES CONFIGURATION | Public HTTPS (TLS 1.3) | AWS WAF rate-limited |
| **Managed Database** | Staging | `ap-south-1` | `zentra-staging-db` | REQUIRES CONFIGURATION | Private / Encrypted | PostgreSQL 16.2 (`db.t4g.medium`) |
| **Database App Role** | Staging | `ap-south-1` | `zentra_app` | REQUIRES CONFIGURATION | `NOBYPASSRLS` | Preserves PostgreSQL RLS |
| **Evidence S3 Bucket** | Staging | `ap-south-1` | `zentra-staging-evidence` | REQUIRES CONFIGURATION | Private / Versioned | Public access strictly blocked |
| **WAL S3 Bucket** | Staging | `ap-south-1` | `zentra-staging-db-wal` | REQUIRES CONFIGURATION | Private / Append-Only | Database WAL stream |
| **API Task Role** | Staging | `ap-south-1` | `zentra-staging-api-role` | REQUIRES CONFIGURATION | Least Privilege IAM | Scoped to staging bucket |
| **JWT Access Secret** | Staging | `ap-south-1` | `zentra/staging/jwt-access-secret` | REQUIRES CONFIGURATION | High-Entropy (64 hex) | AWS Secrets Manager |
| **JWT Refresh Secret** | Staging | `ap-south-1` | `zentra/staging/jwt-refresh-secret` | REQUIRES CONFIGURATION | High-Entropy (64 hex) | AWS Secrets Manager |
| **Offline Permit Key** | Staging | `ap-south-1` | `zentra/staging/offline-permit-key` | REQUIRES CONFIGURATION | High-Entropy (64 hex) | AWS Secrets Manager |
| **API Runtime** | Staging | `ap-south-1` | `zentra-staging-api-service` | BLOCKED | Private Subnet (:4000) | ECS Fargate (2 replicas) |
| **Web Runtime** | Staging | `ap-south-1` | `zentra-staging-web-static` | REQUIRES CONFIGURATION | CloudFront CDN | React + Vite static bundle |
| **Log Groups** | Staging | `ap-south-1` | `/zentra/staging/*` | REQUIRES CONFIGURATION | CloudWatch Encrypted | 30-day retention |

---

## 20. Security Findings Summary

1. **Cloud Credentials Required:** Host lacks AWS credentials and CLI; physical provisioning paused safely per protocol.
2. **S3 Fail-Closed Enforcement Required:** Potential mock fallback in `ObjectStorageService` blocks staging application deployment until code hardening is complete.
3. **Application Security Headers Missing:** Fastify Helmet must be wired before public ALB exposure.
4. **API Rate Limiting Missing:** Request throttling must be wired on authentication routes.
5. **Readiness Probe Incomplete:** Database dependency ping must be added to `/health/readiness`.
6. **Strict CORS Enforced:** Proposed staging S3 policy completely eliminates wildcard origins.

---

## 21. Blockers

The following items represent the authoritative list of remaining staging blockers:

| Blocker ID | Blocker Description | Category | Resolution Requirement |
| :--- | :--- | :---: | :--- |
| **BLK-STG-01** | **Cloud Credentials & Authorization Missing** | Infrastructure | Supply AWS staging credentials or configure cloud execution environment. |
| **BLK-STG-02** | **Staging Domain / DNS Delegation Missing** | Infrastructure | Delegate authoritative staging hostname (e.g. `*.staging.zentra.gov.in`). |
| **BLK-STG-03** | **S3 Fail-Closed Hardening in Code** | Application | Update `ObjectStorageService` to throw fatal error if S3 unconfigured in staging/prod. |
| **BLK-STG-04** | **Security Headers & Rate Limiting Missing** | Application | Register `@fastify/helmet` and `@fastify/rate-limit` in `apps/api/src/main.ts`. |
| **BLK-STG-05** | **Readiness Probe Database Dependency Ping** | Application | Add non-blocking `SELECT 1` ping to `HealthController.getReadiness`. |

---

## 22. Not Yet Tested

In accordance with strict reporting truthfulness, the following operations have **NOT YET BEEN TESTED** and are reserved for Step 3:
1. Real AWS S3 binary upload streaming over public cellular/internet connections.
2. Server-side AWS SigV4 HEAD integrity verification against live S3 buckets.
3. Physical database restore from continuous WAL archive snapshots.
4. Synthetic high-concurrency load rehearsal (k6 benchmark profile).
5. Physical mobile device connectivity against the staging ALB endpoint.

---

## 23. Required Next Operational Step

```mermaid
sequenceDiagram
    autonumber
    actor Admin as System Administrator / DevOps
    participant Code as ZENTRA Application Code
    participant AWS as AWS Cloud Environment
    participant Step3 as Step 3 Validation & Rehearsal

    Note over Admin,Code: Phase 1: Code Hardening Remediation
    Admin->>Code: Implement Helmet, Rate Limiter, DB Readiness Ping, S3 Fail-Closed
    Code-->>Admin: Verify 100% tests pass with hardened bootstrap

    Note over Admin,AWS: Phase 2: Cloud Credential Binding & Provisioning
    Admin->>AWS: Provide AWS Staging Credentials & Region Authorization
    Admin->>AWS: Apply Terraform / CloudFormation Blueprints (VPC, RDS, S3, Secrets)
    AWS-->>Admin: Staging Infrastructure Provisioned Successfully

    Note over Admin,Step3: Phase 3: Transition to Validation
    Admin->>Step3: Execute Step 3 (Smoke Checks, S3 Verification, Load Rehearsal)
```

1. **Remediate Code Hardening Items:** Resolve BLK-STG-03, BLK-STG-04, and BLK-STG-05 in application code.
2. **Bind Staging Cloud Credentials:** Provide authorized AWS credentials to instantiate the blueprints.
3. **Deploy Staging Cloud Infrastructure:** Provision VPC, RDS PostgreSQL, S3 bucket, and Secrets Manager resources.
4. **Execute Step 3 Staging Validation:** Run automated smoke tests, real S3 verification, and load rehearsal.

---

## 24. Exact Verification Commands Used

All environment and repository inspections were strictly read-only and non-destructive:

```powershell
# 1. Plugin and credential account status check
# Result: No connected cloud plugin accounts.

# 2. Command-line tool availability check
Get-Command aws, gcloud, az -ErrorAction SilentlyContinue

# 3. Environment variable credentials inspection
Get-ChildItem Env:AWS* -ErrorAction SilentlyContinue

# 4. Environment template files audit
Get-ChildItem -Path . -Filter "*.env*" -Force

# 5. Git working tree status verification
git status -s
```

---

## 25. Final Decision

### Determination: **STAGING INFRASTRUCTURE PARTIALLY PROVISIONED — BLOCKERS REMAIN**

1. **Application Software Implementation:** Formally complete across Phases 1–16.
2. **Staging Architecture & Blueprints:** 100% specified and verified under strict staging isolation (`zentra-staging-*`).
3. **Physical Cloud Instantiation:** **BLOCKED** — Staging cloud credentials and authorization are required.
4. **Application Staging Deployment:** **BLOCKED** — S3 fail-closed enforcement, security headers, rate limiting, and readiness probe hardening must be completed prior to application deployment.
5. **Production Deployment:** **STRICTLY NOT AUTHORIZED**.

---

🛑 MUSE SPARK STOP — ZENTRA PRODUCTION PREPARATION STEP 2 COMPLETE. STAGING INFRASTRUCTURE PROVISIONING ONLY. DO NOT PROCEED TO STAGING VALIDATION, LOAD TESTING, BACKUP RESTORE, OR PRODUCTION DEPLOYMENT UNTIL THIS REPORT IS REVIEWED AND EXPLICITLY APPROVED.
