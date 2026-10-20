# MUSE SPARK PRODUCTION PREPARATION — STEP 2A
## Staging Infrastructure Blueprint Correction Report

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Activity:** Post-Roadmap Production Preparation (Step 2A — Staging Infrastructure Blueprint Correction)  
**Execution Mode:** STRICT DOCUMENTATION-ONLY AMENDMENT (Zero Cloud Provisioning, Zero Code Changes, Zero Deployments)  
**Authority Baseline:** Formally Approved Phases 1–16, Step 1 Audit (`docs/MUSE_SPARK_PRODUCTION_PREPARATION_STEP1.md`), and Step 2 Report (`docs/MUSE_SPARK_PRODUCTION_PREPARATION_STEP2.md`)  
**Status:** COMPLETE — STAGING BLUEPRINTS AMENDED & ALIGNED TO AWS MANAGED SERVICES  
**Protocol Gate:** STRICT PRE-PRODUCTION ISOLATION GATE  
**Code Changes:** NONE (Blueprint & Documentation Corrections Only)  

---

## 1. Executive Summary

This document serves as the formal correction and amendment to **Step 2 — Staging Infrastructure Provisioning Report** (`docs/MUSE_SPARK_PRODUCTION_PREPARATION_STEP2.md`). 

Following thorough technical review of the initial Step 2 report, ten (10) specific architectural, terminology, status integrity, and scoping items were identified for correction. This Step 2A report resolves every identified finding with technical rigor, ensuring the staging infrastructure blueprint strictly adheres to AWS managed service standards, realistic backup mechanisms, unambiguous status reporting, and formal government data sovereignty qualification.

### Mandatory Truthfulness & Non-Provisioning Declaration
In strict conformance with project governance and prompt rules:
1. **Zero Cloud Resources Created:** No AWS VPCs, subnets, EC2 instances, ECS clusters, RDS databases, S3 buckets, Secrets Manager secrets, Route 53 records, or ACM certificates were provisioned or modified.
2. **Zero Cloud Credentials Requested or Generated:** No AWS access keys, secret keys, or cloud credentials were created, simulated, or requested.
3. **Zero Application Source Code Modified:** No application TypeScript, SQL, JSON, or configuration files were changed.
4. **Zero Database Migrations Executed:** No migrations were run against any staging or production database.
5. **Zero Deployments or Step 3 Validations Conducted:** No container deployments, load tests, physical restore drills, or mobile smoke tests were performed.
6. **Documentation-Only Scope:** This activity is exclusively an architectural blueprint correction.

---

## 2. Original Step 2 Reference

This amendment directly supplements and corrects:
- **Authoritative Source:** `docs/MUSE_SPARK_PRODUCTION_PREPARATION_STEP2.md`
- **Scope of Preservation:** All valid foundational findings, security boundaries, resource naming conventions (`zentra-staging-*`), network isolation boundaries (`10.100.0.0/16` VPC), and blocker definitions (BLK-STG-01 through BLK-STG-05) from the original Step 2 report are fully preserved.
- **Audit Trail:** The original Step 2 report remains intact in the repository history, while this Step 2A report serves as the authoritative, corrected architectural baseline for subsequent staging provisioning and validation.

---

## 3. Review Corrections Summary

The table below summarizes the ten technical and documentation corrections resolved in this report:

| # | Review Finding / Issue | Original Step 2 State | Corrected Step 2A State |
| :-: | :--- | :--- | :--- |
| **1** | **RDS Multi-AZ Terminology** | Isolated DB subnets labeled as "Primary" (1a) and "Standby" (1b). | Clarified as AWS-managed Multi-AZ DB subnet group spanning $\ge 2$ AZs; workloads connect exclusively to the managed RDS endpoint. |
| **2** | **Unsupported RDS $\to$ S3 WAL Streaming** | Diagram & text depicted direct streaming to `zentra-staging-db-wal`. | Removed unsupported direct streaming; replaced with AWS-managed Automated Backups & PITR; removed WAL bucket from baseline. |
| **3** | **Backup Language & Status Integrity** | Stated "BACKUP CONFIGURED (BLUEPRINT)" and "RESTORE NOT YET TESTED". | Applied strict status taxonomy; backups are `PROPOSED / NOT PROVISIONED`; restore drill is `NOT TESTED`. |
| **4** | **Staging Domain Placeholders** | Internal `.internal` domains presented without explicit placeholder caveats. | Explicitly labeled all domains as `PLACEHOLDER`; defined structured target pattern `https://staging-api.<approved-staging-domain>/api/v1`. |
| **5** | **Government Data Localization Language** | Conclusively claimed architecture "satisfies statutory Indian data localization requirements". | Softened to qualified architectural statement noting region location and mandating official authority confirmation before production. |
| **6** | **DR Region Classification** | Designated `ap-south-2` as "Secondary / Disaster Recovery Region". | Clarified `ap-south-2` strictly as `OPTIONAL FUTURE DR REGION — NOT PROVISIONED AND NOT YET APPROVED FOR STAGING`. Single-region staging baseline. |
| **7** | **Resource Inventory Status Integrity** | Used ambiguous status `REQUIRES CONFIGURATION` for non-existent resources. | Replaced with strict truthful statuses: `PROPOSED`, `NOT PROVISIONED`, `BLOCKED`, `PLACEHOLDER`, `REMOVED`. |
| **8** | **Preserved Staging Blockers** | Five blockers identified in Step 2. | Fully preserved all five blockers (`BLK-STG-01` through `BLK-STG-05`) without dilution. |
| **9** | **Application Hardening Deferred** | Hardening items listed alongside provisioning blueprints. | Explicitly emphasized that Helmet, Rate Limiter, DB ping, and S3 fail-closed are deferred code tasks required prior to container deployment. |
| **10** | **Step Boundary Discipline** | Provisioning report completed prior to credential binding. | Affirmed Step 2A boundary as documentation-only; zero cloud provisioning or Step 3 validation permitted. |

---

## 4. Corrected RDS Architecture (Multi-AZ Managed Model)

### 4.1. Managed Multi-AZ Operational Architecture
In Amazon Web Services, an **Amazon RDS for PostgreSQL Multi-AZ** deployment operates on a managed high-availability abstraction:
- **DB Subnet Group (`dbsng-zentra-staging`):** Spans at least two Availability Zones (`ap-south-1a` and `ap-south-1b`). Subnets `subnet-staging-isolated-db-1a` (`10.100.20.0/24`) and `subnet-staging-isolated-db-1b` (`10.100.21.0/24`) are members of this group.
- **Managed Replication:** AWS provisions and maintains a synchronous physical standby replica in the second Availability Zone. Storage volume transactions are synchronously replicated across AZs at the block level.
- **Automatic Failover:** In the event of primary hardware failure, AZ outage, or planned maintenance, RDS automatically promotes the standby replica to primary within 60–120 seconds.
- **Endpoint Abstraction:** Application workloads connect **exclusively to the RDS DB instance DNS endpoint** (e.g. `zentra-staging-db.<account-hash>.ap-south-1.rds.amazonaws.com`). The application layer does not address, route to, or name the standby subnet directly; AWS manages DNS CNAME failover transparently.

```text
+---------------------------------------------------------------------------------------------------+
| AWS Cloud (ap-south-1) — VPC: zentra-staging-vpc (10.100.0.0/16)                                  |
|                                                                                                   |
|  +---------------------------------------------------------------------------------------------+  |
|  | DB Subnet Group: dbsng-zentra-staging                                                       |  |
|  |                                                                                             |  |
|  |  +---------------------------------------+   Synchronous Block  +-------------------------+  |  |
|  |  | Availability Zone: ap-south-1a         |   Replication        | AZ: ap-south-1b        |  |  |
|  |  | subnet-staging-isolated-db-1a         |   (Managed by AWS)   | subnet-staging-db-1b   |  |  |
|  |  | (10.100.20.0/24)                      | -------------------> | (10.100.21.0/24)       |  |  |
|  |  |                                       |                      |                         |  |  |
|  |  | [Active Primary RDS Instance]        |                      | [Synchronous Standby]   |  |  |
|  |  +---------------------------------------+                      +-------------------------+  |  |
|  +---------------------------------------------------------------------------------------------+  |
|                                 ^                                                                 |
|                                 | Connects via DB Instance CNAME Endpoint (Port 5432)             |
|                                 | (SSL Enforced: rds.force_ssl = 1, NOBYPASSRLS)                  |
|  +---------------------------------------------------------------------------------------------+  |
|  | Private App Subnets: Central API Cluster (ECS Fargate)                                      |  |
|  +---------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------+
```

### 4.2. Network Subnet Mapping (Corrected)
The staging subnet topology accurately reflects membership in the DB Subnet Group without misrepresenting subnets as dedicated primary or standby physical nodes:

| Subnet Identifier | Availability Zone | CIDR Block | Route Table / Egress | Managed Purpose | Status |
| :--- | :---: | :---: | :--- | :--- | :---: |
| `subnet-staging-public-1a` | `ap-south-1a` | `10.100.1.0/24` | Internet Gateway (`igw-staging`) | Application Load Balancer (Public Tier) | PROPOSED / NOT PROVISIONED |
| `subnet-staging-public-1b` | `ap-south-1b` | `10.100.2.0/24` | Internet Gateway (`igw-staging`) | Application Load Balancer (Public Tier) | PROPOSED / NOT PROVISIONED |
| `subnet-staging-private-app-1a` | `ap-south-1a` | `10.100.10.0/24` | NAT Gateway (`nat-staging-1a`) | Central API Tasks (Private App Tier) | PROPOSED / NOT PROVISIONED |
| `subnet-staging-private-app-1b` | `ap-south-1b` | `10.100.11.0/24` | NAT Gateway (`nat-staging-1b`) | Central API Tasks (Private App Tier) | PROPOSED / NOT PROVISIONED |
| `subnet-staging-isolated-db-1a` | `ap-south-1a` | `10.100.20.0/24` | None (Isolated VPC local only) | DB Subnet Group Member (AZ 1a) | PROPOSED / NOT PROVISIONED |
| `subnet-staging-isolated-db-1b` | `ap-south-1b` | `10.100.21.0/24` | None (Isolated VPC local only) | DB Subnet Group Member (AZ 1b) | PROPOSED / NOT PROVISIONED |

- **Subnet Group Identifier:** `dbsng-zentra-staging` (incorporates `subnet-staging-isolated-db-1a` and `subnet-staging-isolated-db-1b`).
- **Database Status:** `PROPOSED / NOT PROVISIONED`

---

## 5. Corrected Backup & Point-in-Time Recovery (PITR) Architecture

### 5.1. Elimination of Unsupported Direct S3 WAL Streaming
In an unmanaged PostgreSQL deployment (e.g. self-hosted on EC2), tools such as `pgBackRest` or `wal-g` stream raw write-ahead logs (WAL) to a customer S3 bucket. However, **Amazon RDS for PostgreSQL is a managed database service** and does not support streaming raw WAL files directly to customer S3 buckets.

The Step 2 design claimed direct WAL streaming to `zentra-staging-db-wal`. This unsupported mechanism is **completely removed** from the staging baseline.

### 5.2. Supported AWS RDS Managed Backup Model
The corrected backup blueprint employs AWS-native managed capabilities:
1. **Automated Storage-Level Backups:** RDS automatically creates a daily storage snapshot of the DB instance during the defined maintenance window (02:00 AM IST / 20:30 UTC).
2. **Managed Transaction Log Archiving:** RDS automatically and continuously captures PostgreSQL transaction logs and archives them to underlying AWS internal backup storage.
3. **Point-in-Time Recovery (PITR):** Enables restoring the database to any specific second within the backup retention period (proposed: 7 days for staging, up to 35 days in production), down to the `LatestRestorableTime` (typically within 5 minutes of current time).
4. **Manual DB Snapshots:** Administrators can execute ad-hoc storage snapshots before significant operations (e.g. running new migration batches or pre-load test states). Manual snapshots persist until explicitly deleted.
5. **AWS Backup Centralized Policy (Optional):** Can orchestrate automated snapshot schedules, cross-account copies, and retention locks.
6. **Cross-Region Snapshot Copy (Optional / Future Decision):** Snapshots can be copied to a secondary region if a formal disaster recovery mandate is approved for production. This is omitted from staging baseline to eliminate cost and complexity.

### 5.3. Backup Status and Discipline
> [!IMPORTANT]
> **STRICT BACKUP STATUS STATEMENT:**  
> RDS automated backup and point-in-time recovery are part of the **proposed staging configuration**. Physical configuration and restore verification will occur only after AWS staging infrastructure is provisioned.  
> - **Design Status:** `PROPOSED`  
> - **Physical Infrastructure:** `NOT PROVISIONED`  
> - **Restore Drill Status:** `NOT TESTED` (Scheduled for Step 3 physical validation).

---

## 6. Corrected Object Storage (S3) Architecture

### 6.1. Staging S3 Bucket Baseline
The corrected object storage architecture reduces the staging baseline to exactly **one required object storage bucket**:

1. **`zentra-staging-evidence` (Required Baseline Bucket):**
   - **Purpose:** Primary repository for encrypted, authenticated field visit evidence binaries (photos, tamper-evident inspection attachments, OCR raw images).
   - **Target Region:** `ap-south-1`
   - **Security Controls:**
     - All 4 AWS Block Public Access settings enabled (`BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets`).
     - S3 Bucket Versioning enabled.
     - Server-Side Encryption enabled via SSE-S3 (AES-256) or AWS KMS (`aws/s3`).
     - Strict CORS policy matching the staging portal origin exclusively (wildcards prohibited).
     - Object lifecycle rules: Transition non-current versions to Glacier Flexible Retrieval after 30 days; abort incomplete multipart uploads after 7 days.
   - **Status:** `PROPOSED / NOT PROVISIONED`

2. **`zentra-staging-db-wal` (Removed from Baseline):**
   - **Status:** `REMOVED FROM BASELINE DESIGN — NOT REQUIRED FOR RDS AUTOMATED BACKUP/PITR BASELINE`
   - **Technical Rationale:** RDS PostgreSQL manages continuous WAL archiving internally for PITR without exposing or requiring a customer-managed S3 bucket. Retaining this bucket would incur idle storage costs, require unnecessary IAM permissions, and introduce operational confusion.

### 6.2. Corrected Staging Architecture Diagram

The updated architecture diagram completely eliminates the direct RDS-to-S3 WAL stream and accurately depicts the AWS-managed Multi-AZ database model:

```mermaid
flowchart TD
    subgraph Staging_Cloud["AWS Cloud (ap-south-1) — VPC: zentra-staging-vpc (10.100.0.0/16) [PROPOSED]"]
        subgraph Public_Tier["Public Subnets (10.100.1.0/24, 10.100.2.0/24)"]
            ALB["Application Load Balancer<br/>https://staging-api.<approved-staging-domain><br/>(TLS 1.3 Termination, AWS WAF)"]
        end

        subgraph App_Tier["Private App Subnets (10.100.10.0/24, 10.100.11.0/24)"]
            API_Nodes["Central API Cluster (ECS Fargate)<br/>Port 4000 (Private Internal)<br/>(NestJS 11 + Fastify 5)"]
        end

        subgraph DB_Tier["DB Subnet Group: dbsng-zentra-staging (10.100.20.0/24, 10.100.21.0/24)"]
            RDS_PG[("Amazon RDS PostgreSQL 16 Multi-AZ<br/>Private CNAME Endpoint :5432<br/>(Synchronous Standby Managed by AWS)")]
        end

        subgraph VPC_Endpoints["VPC Endpoints (PrivateLink)"]
            S3_Endpoint["S3 Gateway Endpoint"]
            Secrets_Endpoint["Secrets Manager Interface Endpoint"]
        end
    end

    subgraph Storage_Tier["AWS S3 Object Storage [PROPOSED]"]
        S3_Evidence[("zentra-staging-evidence<br/>(Versioned, Private, Strict CORS)")]
    end

    subgraph RDS_Managed_Storage["AWS Managed Backup Storage (Internal)"]
        RDS_Backups[("RDS Automated Snapshots & Continuous WAL<br/>(7-Day Retention, Managed PITR)")]
    end

    subgraph Observability["Secrets & Observability [PROPOSED]"]
        Secrets_Mgr["AWS Secrets Manager<br/>(zentra/staging/*)"]
        CloudWatch["AWS CloudWatch<br/>(/zentra/staging/*)"]
    end

    Field_Mobile["ZENTRA Field (Mobile Client)<br/>com.zentra.field.staging"] -->|1. Direct PUT| S3_Evidence
    Field_Mobile -->|2. Sync / REST HTTPS| ALB
    Web_Portal["ZENTRA Web (Portal)<br/>https://staging-portal.<approved-staging-domain>"] -->|HTTPS| ALB

    ALB -->|Forward :4000| API_Nodes
    API_Nodes -->|Kysely Pool :5432 (SSL Enforced)| RDS_PG
    API_Nodes -->|SigV4 HEAD/GET| S3_Endpoint
    S3_Endpoint --> S3_Evidence
    API_Nodes --> Secrets_Endpoint
    Secrets_Endpoint --> Secrets_Mgr
    API_Nodes --> CloudWatch

    RDS_PG -.->|AWS Internal Managed Archiving| RDS_Backups
```

---

## 7. Corrected DNS, TLS & Hostname Placeholder Model

### 7.1. Explicit Placeholder Status
All references in Step 2 to internal `.internal` domains are **strictly placeholders** authored solely for architectural and network routing blueprint purposes:
- `staging-api.zentra.internal` $\to$ **PLACEHOLDER ONLY — NOT A REGISTERED OR DELEGATED DOMAIN**
- `staging-portal.zentra.internal` $\to$ **PLACEHOLDER ONLY — NOT A REGISTERED OR DELEGATED DOMAIN**
- `staging-alb.zentra.internal` $\to$ **PLACEHOLDER ONLY — NOT A REGISTERED OR DELEGATED DOMAIN**
- `*.staging.zentra.internal` $\to$ **PLACEHOLDER ONLY — NOT A REGISTERED OR DELEGATED DOMAIN**

### 7.2. Definitive Target URL Formatting
When authoritative staging subdomains are formally delegated by responsible state IT or project authorities, endpoints will adhere strictly to the following structured format:
- **Central API Base URL:** `https://staging-api.<approved-staging-domain>/api/v1`
- **Management Web Portal URL:** `https://staging-portal.<approved-staging-domain>`
- **Mobile Public API Target:** `https://staging-api.<approved-staging-domain>/api/v1`
- **Application Load Balancer Ingress:** Terminates TLS for `staging-api.<approved-staging-domain>` and redirects HTTP to HTTPS.

### 7.3. DNS & Certificate Operational Reality
- **Route 53 Status:** No public or private Route 53 hosted zones exist.
- **DNS Records Status:** Zero DNS A/AAAA/CNAME records exist.
- **ACM Certificates Status:** No AWS Certificate Manager (ACM) public or private certificates have been requested, issued, or validated.
- **Overall Status:** `PLACEHOLDER / NOT DELEGATED — BLOCKED BY BLK-STG-02`

---

## 8. Corrected Data Localization & Residency Language

### 8.1. Elimination of Legal Compliance Assertions
The Step 2 report stated: *"Satisfies statutory Indian data localization and sovereignty requirements for government educational records."* A technical architectural specification must not make unilateral or conclusive legal determinations.

### 8.2. Authoritative Architectural Statement
The data residency rationale is corrected to an objective architectural description:

> **AWS Region `ap-south-1` (Mumbai, India) is proposed as the primary staging region because it is geographically located within India and is expected to support applicable data-residency requirements. Final government and state data-residency, cloud hosting, and sovereignty requirements must be formally confirmed and approved by the responsible state authority prior to production deployment.**

This formulation maintains architectural clarity while respecting legal and regulatory governance boundaries.

---

## 9. Corrected Disaster Recovery (DR) Region Classification

### 9.1. Single-Region Staging Focus
Initial staging provisioning and validation are scoped exclusively to a **single AWS region (`ap-south-1`, Mumbai)**. Multi-region infrastructure in staging introduces substantial unnecessary cost, operational overhead, and replication failure modes that are extraneous to validating ZENTRA core application workflows.

### 9.2. Secondary Region (`ap-south-2`) Status
AWS Region `ap-south-2` (Hyderabad, India) was referenced in Step 2 as the secondary DR region. Its status is now authoritatively defined:

> **`ap-south-2` (Hyderabad, India): OPTIONAL FUTURE DR REGION — NOT PROVISIONED AND NOT YET APPROVED FOR STAGING.**

Cross-region S3 replication, cross-region snapshot copying, and cold DR standbys in `ap-south-2` remain architectural options for future production hardening evaluation, but are strictly excluded from the staging baseline.

---

## 10. Corrected Staging Resource Inventory Blueprint

The inventory below reflects strict, unambiguous operational statuses. In accordance with reporting rules, **zero resources are classified as `PROVISIONED`, `CONFIGURED`, or `VERIFIED`**:

| # | Resource Type | Target Region | Resource Identifier | Operational Status | Security / Isolation Boundary | Technical Blueprint Notes |
| :-: | :--- | :---: | :--- | :---: | :---: | :--- |
| 1 | **Virtual Private Cloud** | `ap-south-1` | `zentra-staging-vpc` | **PROPOSED / NOT PROVISIONED** | Private (`10.100.0.0/16`) | Isolated staging CIDR; zero prod routing. |
| 2 | **Public Subnets** | `ap-south-1` | `subnet-staging-public-1a/1b` | **PROPOSED / NOT PROVISIONED** | Public Tier (ALB Only) | Attached to IGW (`igw-staging`). |
| 3 | **Private App Subnets** | `ap-south-1` | `subnet-staging-private-app-1a/1b` | **PROPOSED / NOT PROVISIONED** | Private App Tier | Egress strictly via NAT Gateway. |
| 4 | **Isolated DB Subnets** | `ap-south-1` | `subnet-staging-isolated-db-1a/1b` | **PROPOSED / NOT PROVISIONED** | Isolated Tier (No Egress) | Local VPC traffic only; no internet route. |
| 5 | **DB Subnet Group** | `ap-south-1` | `dbsng-zentra-staging` | **PROPOSED / NOT PROVISIONED** | Multi-AZ DB Boundary | Spans DB subnets across AZ 1a and 1b. |
| 6 | **Application Load Balancer** | `ap-south-1` | `zentra-staging-alb` | **PROPOSED / NOT PROVISIONED** | Public HTTPS (TLS 1.3) | Ingress controller; forward to port 4000. |
| 7 | **Managed Database** | `ap-south-1` | `zentra-staging-db` | **PROPOSED / NOT PROVISIONED** | Private Multi-AZ RDS | PostgreSQL 16.2 (`db.t4g.medium`, gp3). |
| 8 | **Database App Role** | `ap-south-1` | `zentra_app` | **PROPOSED / NOT PROVISIONED** | `NOBYPASSRLS` Role | Non-superuser role enforcing RLS policies. |
| 9 | **Database Connection User** | `ap-south-1` | `zentra_staging_app` | **PROPOSED / NOT PROVISIONED** | Database Login User | Member of `zentra_app`; credentials in Secrets Mgr. |
| 10 | **Evidence S3 Bucket** | `ap-south-1` | `zentra-staging-evidence` | **PROPOSED / NOT PROVISIONED** | Private / Versioned | Strict Block Public Access; strict CORS. |
| 11 | **WAL S3 Bucket** | `ap-south-1` | `zentra-staging-db-wal` | **REMOVED** | N/A | Removed from baseline; RDS manages PITR internally. |
| 12 | **S3 Gateway VPC Endpoint** | `ap-south-1` | `vpce-staging-s3` | **PROPOSED / NOT PROVISIONED** | VPC Internal Routing | Free S3 access without NAT gateway traversal. |
| 13 | **Secrets Mgr Interface Endpoint**| `ap-south-1` | `vpce-staging-secrets` | **PROPOSED / NOT PROVISIONED** | PrivateLink ENI | Secure runtime secret retrieval from app subnets. |
| 14 | **API Task IAM Role** | `ap-south-1` | `zentra-staging-api-role` | **PROPOSED / NOT PROVISIONED** | Least-Privilege IAM | Scoped strictly to `zentra-staging-evidence/*`. |
| 15 | **Staging Secrets** | `ap-south-1` | `zentra/staging/*` | **PROPOSED / NOT PROVISIONED** | High-Entropy KMS Encrypted | JWT secrets, offline permit key, DB credentials. |
| 16 | **API Runtime Service** | `ap-south-1` | `zentra-staging-api-service` | **BLOCKED** | Private Subnets (:4000) | ECS Fargate; blocked by credentials & hardening. |
| 17 | **Web Static S3 Bucket** | `ap-south-1` | `zentra-staging-web-static` | **PROPOSED / NOT PROVISIONED** | Private (OAC only) | React + Vite static build artifacts. |
| 18 | **CloudFront CDN** | Global | `zentra-staging-cdn` | **PROPOSED / NOT PROVISIONED** | HTTPS Edge CDN | Serves static web portal via CloudFront OAC. |
| 19 | **CloudWatch Log Groups** | `ap-south-1` | `/zentra/staging/*` | **PROPOSED / NOT PROVISIONED** | Encrypted Log Groups | 30-day retention for API, DB, and ALB logs. |
| 20 | **RDS Automated Backups** | `ap-south-1` | AWS RDS Managed Backup | **PROPOSED / NOT PROVISIONED** | AWS Managed Storage | 7-day retention; continuous transaction logs. |
| 21 | **Staging Hostnames** | Global | `*.staging.<approved-domain>` | **PLACEHOLDER** | Domain Delegation Required | Placeholder names; awaiting official domain. |
| 22 | **ACM TLS Certificates** | `ap-south-1` | `cert-staging-zentra` | **PROPOSED / NOT PROVISIONED** | ACM Managed TLS | TLS 1.3 certificates for ALB and CloudFront. |

---

## 11. Preserved Staging Blockers

The five authoritative staging blockers identified in Step 2 are **preserved in full without modification or dilution**:

| Blocker ID | Blocker Description | Category | Operational Impact | Resolution Requirement |
| :--- | :--- | :---: | :--- | :--- |
| **BLK-STG-01** | **Cloud Credentials & Authorization Missing** | Infrastructure | Blocks all physical resource provisioning in AWS. | Cloud administrator must configure authorized AWS execution credentials. |
| **BLK-STG-02** | **Staging Domain / DNS Delegation Missing** | Infrastructure | Blocks public HTTPS routing, ACM certificate validation, and real CORS binding. | Authority must delegate authoritative staging domain (e.g. `*.staging.zentra.gov.in`). |
| **BLK-STG-03** | **S3 Fail-Closed Hardening in Code** | Application | Blocks API container deployment to staging. | Update `ObjectStorageService` to throw fatal error if S3 is unconfigured in staging/prod. |
| **BLK-STG-04** | **Security Headers & Rate Limiting Missing** | Application | Blocks exposing API container to public or semi-public network ingress. | Wire `@fastify/helmet` and `@fastify/rate-limit` in `apps/api/src/main.ts`. |
| **BLK-STG-05** | **Readiness Probe Database Dependency Ping** | Application | Blocks automated container health checks and ALB zero-downtime traffic routing. | Enhance `HealthController.getReadiness` with live `SELECT 1` database query. |

---

## 12. Application Hardening Deferred

To ensure absolute clarity regarding operational responsibilities and phase boundaries, this report explicitly reiterates that **application-level code hardening has NOT been implemented in Step 2 or Step 2A**:

1. **Fastify Helmet Security Headers:** (`@fastify/helmet`) must be registered in `apps/api/src/main.ts` to inject standard protective HTTP headers (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`).
2. **Fastify API Rate Limiting:** (`@fastify/rate-limit`) must be registered in `apps/api/src/main.ts` to protect authentication endpoints (`/auth/login`, `/auth/refresh`, `/auth/offline-permit`) against brute-force attacks.
3. **Readiness Probe Database Ping:** `HealthController.getReadiness` (`apps/api/src/modules/health/health.controller.ts`) currently returns an unconditional `{ status: "ready" }` without validating database connectivity. It must be enhanced with a non-blocking `SELECT 1` query via the Kysely database pool.
4. **S3 Fail-Closed Boot Enforcement:** `ObjectStorageService` (`apps/api/src/modules/evidence/services/object-storage.service.ts`) must be updated to prevent fallback to in-memory test storage or mock HMAC signatures when `APP_ENV=staging` or `APP_ENV=production`.

> [!WARNING]
> **OPERATIONAL ORDER OF PRECEDENCE:**  
> These four items represent **pre-deployment code blockers** (BLK-STG-03, BLK-STG-04, BLK-STG-05). They are deferred to subsequent operational tasks and must be implemented, tested, and reviewed **before** any compiled API container image is promoted into the AWS staging runtime.

---

## 13. Explicit Non-Activities (Mandatory Truthfulness Block)

In compliance with strict reporting truthfulness standards, the following activities are formally confirmed as **NOT PERFORMED**:

```text
================================================================================
                    FORMAL NON-ACTIVITY AUDIT DECLARATION
================================================================================
[x] NO AWS resources were created or provisioned (zero VPCs, DBs, S3 buckets, ECS).
[x] NO cloud credentials were requested, generated, accessed, or stored.
[x] NO application source code was modified in any repository workspace.
[x] NO database migrations were executed against any database engine.
[x] NO application containers or web bundles were deployed to any host.
[x] NO high-concurrency load rehearsal (k6) was executed.
[x] NO physical database restore drills from snapshots were performed.
[x] NO Step 3 staging validation checks were started.
[x] NO production infrastructure or data was touched or connected.
================================================================================
```

---

## 14. Security & Environment Isolation Confirmation

Staging environment specifications maintain 100% mathematical and cryptographic isolation from any future production systems:

```text
1. DATABASE BOUNDARY:
   STAGING (zentra-staging-db in 10.100.20.0/24 & 10.100.21.0/24)
   != PRODUCTION (Unprovisioned, isolated VPC, distinct CIDR, distinct credentials)

2. OBJECT STORAGE BOUNDARY:
   STAGING (arn:aws:s3:::zentra-staging-evidence)
   != PRODUCTION (Unprovisioned, distinct bucket ARN, distinct KMS keys)

3. SECRETS BOUNDARY:
   STAGING (AWS Secrets Manager: zentra/staging/*)
   != PRODUCTION (Unprovisioned, distinct cryptographic secrets, independent rotation)

4. NETWORKING & INGRESS BOUNDARY:
   STAGING (staging-api.<approved-staging-domain>, isolated ALB)
   != PRODUCTION (Unprovisioned, api.zentra.gov.in, independent WAF/ALB)

5. IAM IDENTITY BOUNDARY:
   STAGING (zentra-staging-api-role scoped exclusively to staging resources)
   != PRODUCTION (Unprovisioned, separate IAM roles, zero cross-account trust)
```

**Isolation Verdict:** Because production resources do not exist, and all staging blueprints utilize hard-isolated naming, isolated network CIDRs (`10.100.0.0/16`), and strict least-privilege IAM scoping, zero cross-contamination is mathematically possible.

---

## 15. Final Decision

### Determination: **STEP 2A — BLUEPRINT CORRECTIONS COMPLETE**

1. **Blueprint Corrections:** All 10 technical review findings from Step 2 have been comprehensively resolved and documented with architectural precision.
2. **Managed Architecture Alignment:** RDS Multi-AZ architecture, automated backups, PITR mechanics, and single-region staging scope are fully aligned with standard AWS managed service capabilities.
3. **Status Integrity:** Resource statuses, domain placeholders, and backup statuses are strictly distinguished and truthfully declared.
4. **Physical Cloud Instantiation:** **NOT STARTED** — Remains paused pending authorized staging cloud credentials (BLK-STG-01).
5. **Application Hardening:** **PENDING** — Code-level hardening tasks (BLK-STG-03, BLK-STG-04, BLK-STG-05) remain pre-deployment prerequisites.
6. **Production Deployment:** **STRICTLY PROHIBITED**.

---

🛑 MUSE SPARK STOP — ZENTRA PRODUCTION PREPARATION STEP 2A COMPLETE. DOCUMENTATION CORRECTION ONLY. NO CLOUD PROVISIONING, NO CODE CHANGES, NO STAGING VALIDATION, AND NO PRODUCTION DEPLOYMENT AUTHORIZED. WAIT FOR REVIEW.
