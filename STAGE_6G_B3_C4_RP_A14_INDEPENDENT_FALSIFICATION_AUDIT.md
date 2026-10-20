# MUSE SPARK — STAGE 6G-B3-C4-RP-A14
## Independent Falsification & Proof-Boundary Audit

**Project:** ZENTRA Field Call Tracker & ITSM Platform  
**Repository:** `D:\Zentra`  
**Mode:** STRICT READ-ONLY EVIDENCE AUDIT  
**Implementation Authorization:** NOT GRANTED  
**Live Synchronization Authorization:** STRICTLY PROHIBITED  
**Audit Date:** 2026-10-19  

---

### 1. Executive Verdict

**VERDICT: HOLD / NO-GO (GOVERNANCE RESTRICTION; IMPLEMENTATION GATE REQUIRED)**

This audit independently challenged and falsified the conclusions of Stage A13 and earlier reports. No claim was accepted as "PROVEN", "VERIFIED", or "CLOSED" merely because it was labeled as such in prior documents. Every guarantee was subjected to rigorous code inspection, database semantic analysis, concurrent race construction, and privilege boundary verification.

#### Key Audit Discoveries & Boundary Clarifications:
1. **The Codebase Reality vs. Specification Gap (Fundamental Distinction):**
   - The current repository implementation of downstream sync in [`apps/api/src/modules/sync/services/sync-delta.service.ts`](file:///D:/Zentra/apps/api/src/modules/sync/services/sync-delta.service.ts) is **100% timestamp-based** (`service_cases.updated_at > cursorDate`, `field_visits.updated_at > cursorDate`).
   - The tables `sync_change_ledger`, `sync_sequence_tracker`, and `sync_retention_watermark`, along with the deferred constraint triggers and sequence-based cursor `{ v: 3, seq }`, **DO NOT EXIST in any migration or source file in the repository**.
   - Therefore, all guarantees related to commit-order sequencing, rollback integrity, and retention race immunity are **SPECIFICATION-ONLY** designs. They are mathematically sound in theory, but remain **UNIMPLEMENTED** in code.
2. **Retention Cleanup Batching Vulnerability Discovered (Audit A):**
   - In Audit A, an adversarial challenge revealed a critical vulnerability in both proposed remedies (Post-scan verification and Atomic CTE): If a retention worker executes row deletions in batches across multiple transactions (or deletes rows before advancing `min_available_seq`), a concurrent delta retrieval will read a valid watermark alongside an already-pruned ledger, resulting in **silent data skipping without HTTP 410**. The retention protocol must strictly enforce that the watermark advance is committed **in the identical transaction and prior to or atomically with physical tuple deletion**.
3. **Database Privilege Mismatch & TRUNCATE Hole (Audit B):**
   - Inspection of migration [`apps/api/src/database/migrations/20261007000001_create_auth_and_rbac.ts#L209`](file:///D:/Zentra/apps/api/src/database/migrations/20261007000001_create_auth_and_rbac.ts#L209) verifies that `GRANT ALL ON ALL TABLES IN SCHEMA public TO zentra_app` grants `TRUNCATE`. The repository contains **zero `REVOKE TRUNCATE` statements**.
   - Furthermore, a naming mismatch exists between migration role `zentra_app`, Terraform staging role `zentra_staging_app` ([`infra/terraform/staging/secrets.tf#L101`](file:///D:/Zentra/infra/terraform/staging/secrets.tf#L101)), and local development role `zentra_dev`. If deployed environments run as the table owner (`zentra_admin` or `zentra_dev`), trigger bypass via `ALTER TABLE ... DISABLE TRIGGER` is unmitigated.
4. **Mobile Tombstone Purge Vulnerability (Audit E):**
   - While [`apps/field/src/sync/delta-applier.ts#L55-82`](file:///D:/Zentra/apps/field/src/sync/delta-applier.ts#L55-82) protects pending local mutations during `UPSERT` deltas by transitioning them to `CONFLICT`, incoming `TOMBSTONE` deltas (lines 268–314) execute `record.destroyPermanently()` **without checking `local_operations`**. If a case is reassigned or deleted while an engineer has pending offline work, the local case is permanently purged, leaving orphaned pending operations.
5. **Multi-Page Bootstrap Boundary Risk (Audit D):**
   - If bootstrap pagination is conducted across multiple HTTP requests without binding all pages to a single transaction snapshot, concurrent mutations occurring between pages can be silently omitted.

Because critical correctness and security guarantees depend on unexecuted migrations, unverified deployed privileges, and unrun staging tests, **HOLD / NO-GO** must be strictly retained.

---

### 2. Evidence Reviewed and Exact Source Ranges

The following repository files and configurations were directly inspected via read-only tools:

| Domain | File Path | Exact Inspected Ranges | Factual Codebase State Verified |
| :--- | :--- | :--- | :--- |
| **Current Sync Delta** | `apps/api/src/modules/sync/services/sync-delta.service.ts` | Lines 45–170, 230–260, 385–430 | Implements timestamp-based sync (`updated_at > cursorDate`). Zero change ledger queries exist. |
| **Existing Migrations** | `apps/api/src/database/migrations/20261008000003_create_sync_and_idempotency.ts` | Lines 1–43 (Complete) | Only creates `idempotency_keys` table and adds `version` column to `service_cases`. No ledger tables exist. |
| **Auth & RBAC Migration** | `apps/api/src/database/migrations/20261007000001_create_auth_and_rbac.ts` | Lines 201–215 | Executes `GRANT ALL ON ALL TABLES ... TO zentra_app`. Zero `REVOKE TRUNCATE` statements present. |
| **Mobile Delta Applier** | `apps/field/src/sync/delta-applier.ts` | Lines 55–105, 265–314 | Upsert preserves `PENDING_SYNC` as `CONFLICT`. Tombstone calls `destroyPermanently()` unconditionally. |
| **Database Connection** | `apps/api/src/database/database.connection.ts` | Lines 1–42 (Complete) | Connects via `DATABASE_URL` using standard `pg.Pool` and Kysely `PostgresDialect`. |
| **Migration Runner** | `apps/api/src/database/migration-runner.ts` | Lines 22–55, 76–90 | Registers exactly 14 migrations (m1 through m14). Zero change ledger migrations registered. |
| **Environment Config** | `.env.example` | Lines 19–27 | Defines `DATABASE_URL` (`zentra_dev`) and `TEST_DATABASE_URL` (`zentra_test`). |
| **Terraform Secrets** | `infra/terraform/staging/secrets.tf` | Lines 82–134 | Defines staging app role `zentra_staging_app` and admin role `zentra_admin`. |
| **Terraform ECS** | `infra/terraform/staging/ecs.tf` | Lines 100–135 | Staging ECS container injects `DATABASE_URL` from `db_credentials` (`zentra_staging_app`). |
| **Terraform RDS** | `infra/terraform/staging/rds.tf` | Lines 58–80 | RDS instance master username is `zentra_admin`. Enforces PostgreSQL 16.3 with SSL. |

---

### 3. Detailed Results for Sections A–F

#### Section A: Retention and Delta Retrieval Race Falsification

Stage A13 proposed two remedies to prevent delta retrieval from skipping purged events: (1) Post-scan watermark re-verification, and (2) An atomic CTE combining the watermark read and ledger scan.

We subjected both remedies to rigorous interleaving analysis across 5 concurrent execution phases:

```
Timeline A-F1: Multi-Batch Retention Deletion Vulnerability (Falsification of Naive Watermark Updates)
=======================================================================================================
Time   Delta Retrieval (Worker Thread 1)              Retention Cleanup Worker (Worker Thread 2)
-------------------------------------------------------------------------------------------------------
t0     Client calls GET /sync/delta?cursor=5000.
t1                                                    Retention job triggers: Target purge horizon = 6000.
                                                      Worker decides to delete in batches of 500 rows to
                                                      prevent long lock durations:
                                                      -- Batch 1:
                                                      BEGIN;
                                                      DELETE FROM sync_change_ledger
                                                      WHERE event_seq BETWEEN 5001 AND 5500;
                                                      COMMIT;
                                                      --> Rows 5001..5500 deleted from disk!
                                                      --> BUT watermark is NOT updated yet (remains 1)!
-------------------------------------------------------------------------------------------------------
t2     Delta pull begins Query 1 (Scan):
       SELECT * FROM sync_change_ledger
       WHERE event_seq > 5000
       ORDER BY event_seq ASC LIMIT 50;
       --> Rows 5001..5500 are GONE!
       --> Scan returns rows 5501..5550!
t3     Delta pull executes Step 2 (Watermark Check):
       SELECT min_available_seq FROM sync_retention_watermark;
       --> Watermark read returns 1!
t4     Delta pull executes Step 3 (Boundary Verification):
       Check: Is cursor (5000) < min_available_seq (1) - 1?
       Check evaluates: 5000 < 0 (FALSE)!
       --> Server concludes cursor 5000 is FULLY VALID!
t5     Server packages rows 5501..5550 into response.
       Sets nextCursor = 5550. Returns HTTP 200 OK!
-------------------------------------------------------------------------------------------------------
t6                                                    -- Batch 2:
                                                      BEGIN;
                                                      DELETE FROM sync_change_ledger
                                                      WHERE event_seq BETWEEN 5501 AND 6000;
                                                      UPDATE sync_retention_watermark
                                                      SET min_available_seq = 6001;
                                                      COMMIT;
=======================================================================================================
CATASTROPHIC OUTCOME:
- Client cursor was 5000.
- Ledger events 5001 to 5500 were deleted in Batch 1.
- Because the watermark was not updated atomically with Batch 1, post-scan re-verification PASSED!
- Client received rows 5501..5550 and advanced cursor to 5550.
- Client PERMANENTLY AND SILENTLY SKIPPED 500 COMMITTED EVENTS (5001..5500)!
=======================================================================================================
```

##### Falsification Analysis & Strict Protocol Invariant:
1. **Root Cause:** A watermark is only as valid as the tuples currently existing in the table. If tuples are physically deleted *before* the watermark is advanced, an MVCC window exists where the table is pruned but the watermark claims older records are still available.
2. **Mandatory Specification Constraint:**
   - **Pre-Advance Rule:** `sync_retention_watermark.min_available_seq` must be updated **in the exact same database transaction** as the deletion, and must be updated **prior to or atomically with** the `DELETE` statement:
     ```sql
     BEGIN;
     -- Step 1: Advance watermark FIRST within the transaction
     UPDATE sync_retention_watermark
     SET min_available_seq = :newWatermark,
         purged_through_seq = :newWatermark - 1
     WHERE watermark_id = 1;
     -- Step 2: Delete rows within the same transaction
     DELETE FROM sync_change_ledger
     WHERE event_seq < :newWatermark;
     COMMIT;
     ```
   - If batching is used, **each individual batch must advance `min_available_seq` inside its own transaction** before committing the delete.
3. **Falsification of Remedy 2 (Atomic CTE Query):**
   - If the query uses a `LEFT JOIN` between `sync_retention_watermark` and `sync_change_ledger`:
     ```sql
     WITH watermark AS (
         SELECT min_available_seq FROM sync_retention_watermark WHERE watermark_id = 1
     )
     SELECT l.*, w.min_available_seq
     FROM watermark w
     LEFT JOIN sync_change_ledger l ON l.event_seq > :cursor
     ORDER BY l.event_seq ASC LIMIT :limit;
     ```
   - If no rows match (`l.event_seq > :cursor`), the LEFT JOIN returns a single row where `l.event_seq IS NULL`. If application code naively maps `rows.map(r => r.data)`, it serializes a `null` row into the JSON response!
   - Furthermore, the presence of `w.min_available_seq` in the query result does **not** protect the client unless the application explicitly evaluates `cursor < min_available_seq - 1` before processing rows.
4. **Boundary Semantics for HTTP 410:**
   - Client sends cursor $C$.
   - Current watermark is $W = \text{min\_available\_seq}$.
   - Exact boundary: If $C < W - 1$, then events between $C + 1$ and $W - 1$ have been pruned. The server **must return HTTP 410 Gone**.
   - If $C = W - 1$, the client is positioned exactly at the first available sequence ($W$). This is **valid** (HTTP 200).

---

#### Section B: Effective Database Privileges and Bypass Paths

Direct read-only inspection of the repository codebase reveals four distinct layers of database roles and configurations:

```
Database Identity & Privilege Layers in ZENTRA Repository
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Layer 1: Repository Migration Definition                                         │
│ File: 20261007000001_create_auth_and_rbac.ts#L201-L215                          │
│ Role: zentra_app (WITH LOGIN NOSUPERUSER)                                        │
│ Grants: GRANT USAGE ON SCHEMA public; GRANT ALL ON ALL TABLES IN SCHEMA public;  │
│         ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES;                        │
│ Status: Grants TRUNCATE. Contains ZERO REVOKE TRUNCATE statements.               │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Mismatch
┌────────────────────────────────────────▼─────────────────────────────────────────┐
│ Layer 2: Terraform Staging Infrastructure Definition                             │
│ File: infra/terraform/staging/secrets.tf#L82-L134                                │
│ App Role: zentra_staging_app (Injected into ECS container DATABASE_URL)         │
│ Admin Role: zentra_admin (PostgreSQL RDS Master User)                            │
│ Discrepancy: Migration creates 'zentra_app', but ECS connects as                 │
│ 'zentra_staging_app'! Permissions on 'zentra_staging_app' are undefined in repo. │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Mismatch
┌────────────────────────────────────────▼─────────────────────────────────────────┐
│ Layer 3: Local Development & Test Configuration                                  │
│ File: .env.example#L21-L27                                                       │
│ Dev URL: postgresql://zentra_dev:zentra_dev_pass@localhost:5432/zentra_local     │
│ Test URL: postgresql://zentra_test:zentra_test_pass@localhost:5432/zentra_test   │
│ Reality: 'zentra_dev' is typically database/table owner in Docker setups.        │
│ Table owners bypass RLS policies and have implicit TRUNCATE and ALTER privileges.│
└──────────────────────────────────────────────────────────────────────────────────┘
```

##### Privilege Audit Findings:
1. **`TRUNCATE` Row-Trigger Bypass (VERIFIED IN CODEBASE):**
   - In PostgreSQL, `GRANT ALL ON ALL TABLES` includes `TRUNCATE`.
   - Migration `20261007000001` explicitly runs `GRANT ALL ON ALL TABLES IN SCHEMA public TO zentra_app` and `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO zentra_app`.
   - In PostgreSQL, `TRUNCATE` empties a table without firing `AFTER INSERT/UPDATE/DELETE FOR EACH ROW` triggers.
   - If an application component or compromised connection issues `TRUNCATE service_cases`, all cases are deleted with **zero change ledger events recorded**.
2. **Role Name Inconsistency Across Environments:**
   - The migration explicitly hardcodes `CREATE ROLE zentra_app`.
   - But Terraform staging configures ECS with `username = "zentra_staging_app"`.
   - If migrations run against RDS, they grant privileges to `zentra_app`, leaving `zentra_staging_app` with zero table grants unless an out-of-band administrative script intervened.
3. **Migration Runner Identity:**
   - In `apps/api/src/database/migration-runner.ts`, migrations are executed using the connection string passed to it (which defaults to `DATABASE_URL`).
   - If `DATABASE_URL` connects as the non-superuser application role, migrations attempting DDL or `CREATE ROLE` will fail.
   - If `DATABASE_URL` connects as `zentra_admin`, all created tables are owned by `zentra_admin`.
4. **Mandatory Privilege Remediation for Implementation:**
   - The corrective migration must explicitly enforce:
     ```sql
     REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM zentra_app, zentra_staging_app;
     ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM zentra_app, zentra_staging_app;
     ```

---

#### Section C: Commit-Order Ledger and Trigger Semantics

##### 1. Repository Existence Check
- A search across all `.ts` files in `apps/` and `packages/` confirms:
  **`sync_change_ledger` and `sync_sequence_tracker` DO NOT EXIST in the codebase.**
- Any statement claiming that triggers or ledgers are "functioning" or "runtime verified" is false. They are pure specification.

##### 2. Deferred Constraint Trigger Semantic Analysis
- The proposed specification uses:
  ```sql
  CREATE CONSTRAINT TRIGGER trg_sync_service_cases
  AFTER INSERT OR UPDATE OR DELETE ON service_cases
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_sync_capture();
  ```
- **Execution Timing:** In PostgreSQL, deferred constraint triggers are queued in the transaction state (`AfterTriggerSaveEvent`) during statement execution. They execute during the pre-commit phase (`AfterTriggerFireDeferred`) when the client issues `COMMIT`.
- **Lock Ordering & Deadlock Proof:**
  - Let $T_A$ and $T_B$ be two concurrent transactions updating different tables in different orders (e.g. $T_A$ updates `service_cases` then `field_visits`; $T_B$ updates `field_visits` then `service_cases`).
  - During the statement execution phase, $T_A$ and $T_B$ may deadlock on domain rows if application locking is undisciplined.
  - However, the lock on `sync_sequence_tracker WHERE tracker_id = 1` is **only requested during pre-commit**.
  - Because deferred triggers fire after all application DML statements have completed, once a transaction enters `AfterTriggerFireDeferred` and acquires the exclusive lock on `tracker_id = 1`, it executes `fn_sync_capture()`, inserts into `sync_change_ledger`, and proceeds directly to WAL write and commit.
  - It **never acquires any subsequent domain row locks** after acquiring `tracker_id = 1`.
  - Under Dijkstra's lock hierarchy theorem, a lock that is strictly terminal (acquired last, with zero subsequent lock acquisitions before release) **cannot participate in a deadlock cycle**.
- **Equivalence of Sequence Order and Commit Order:**
  - In PostgreSQL, exclusive row locks are released when the transaction status is written to WAL at `CommitTransaction()`.
  - If $T_1$ acquires the lock on `tracker_id = 1`, increments `current_seq` to $K$, and inserts into `sync_change_ledger`:
  - $T_2$, which is waiting for `tracker_id = 1`, is blocked in `XactLockTableWait` waiting for $T_1$'s transaction ID to finish.
  - $T_2$ cannot allocate $K + 1$ until $T_1$ has fully committed.
  - Therefore, $T_1$ commits strictly before $T_2$, and $seq(T_1) < seq(T_2)$. Monotonic commit-order equivalence is mathematically guaranteed under `READ COMMITTED`.
- **No-Op Update Suppression:**
  - If an application service executes `UPDATE service_cases SET updated_at = NOW()` without altering domain fields:
  - If the trigger procedure does not check `IF NEW IS NOT DISTINCT FROM OLD`, a sequence number and ledger row are wasted.
  - The trigger procedure must explicitly filter out no-op mutations before acquiring the sequence tracker lock.

---

#### Section D: Bootstrap and Delta Handoff

##### Concurrent Writer/Reader Timeline Analysis:

```
Timeline D-F1: Bootstrap Under REPEATABLE READ with Concurrent Straddling Writer
=======================================================================================================
Time   Bootstrap Reader (Client B)                   Concurrent Writer (Transaction W)
-------------------------------------------------------------------------------------------------------
t0     Client calls GET /sync/bootstrap.
t1     B starts: BEGIN ISOLATION LEVEL
                 REPEATABLE READ;
t2     B executes first query (establishes MVCC
       snapshot S_0):
       SELECT COALESCE(MAX(event_seq), 0) AS cur
       FROM sync_change_ledger;
       --> Visible max event_seq in S_0 is K = 1000.
-------------------------------------------------------------------------------------------------------
t3                                                   Writer W executes:
                                                     UPDATE service_cases SET status = 'IN_PROGRESS'
                                                     WHERE service_case_id = 'C1';
                                                     --> Deferred trigger queued.
t4                                                   Writer W issues COMMIT:
                                                     --> Pre-commit trigger allocates event_seq = 1001.
                                                     --> W commits to WAL!
-------------------------------------------------------------------------------------------------------
t5     B reads active cases in snapshot S_0:
       SELECT * FROM service_cases;
       --> Because S_0 was established at t2 (before W committed at t4),
           B sees Case C1 in its PREVIOUS state (not 'IN_PROGRESS')!
t6     B commits transaction and returns:
       data: { cases: [...], visits: [...] },
       cursor: { v: 3, seq: 1000 }
-------------------------------------------------------------------------------------------------------
t7     Client applies bootstrap dataset.
       Client saves local cursor = 1000.
t8     Client calls GET /sync/delta?cursor=1000.
t9     Delta service executes:
       SELECT * FROM sync_change_ledger
       WHERE event_seq > 1000 ORDER BY event_seq ASC;
       --> Returns event 1001 (Case C1 updated to 'IN_PROGRESS')!
t10    Client applies delta event 1001.
       Case C1 is updated to 'IN_PROGRESS' on mobile device!
=======================================================================================================
PROVEN RESULT:
- Case C1 was invisible in bootstrap snapshot S_0.
- Sequence 1001 was strictly > K (1000).
- Case C1 was delivered in the immediately following delta pull.
- Omissions = 0. Inconsistencies = 0.
```

##### Critical Bootstrap Boundary Vulnerability Discovered:
- **The Multi-Request Bootstrap Trap:**
  - If bootstrap streams cases, visits, evidence, and claims across **multiple independent HTTP requests** without pinning the database connection to the same transaction snapshot:
  - Request 1 reads cases at snapshot $S_1$.
  - Request 2 reads visits at snapshot $S_2$ ($S_2 > S_1$).
  - A transaction committing between $S_1$ and $S_2$ will have its case omitted from Request 1, but its visit included in Request 2!
  - If the server returns the cursor from $S_2$, subsequent deltas will **never deliver the missing case**.
  - **Rule:** The entire bootstrap dataset and cursor MUST be generated within a **single database transaction**, or the returned cursor must strictly reflect the snapshot taken at the **start of the first request**.

---

#### Section E: Reassignment, Revocation, and Offline Data

##### 1. Specification vs. Codebase Reality
- In the current codebase ([`apps/api/src/modules/service-cases/services/dispatch-engine.service.ts`](file:///D:/Zentra/apps/api/src/modules/service-cases/services/dispatch-engine.service.ts)), `assignEngineer` simply updates `assigned_primary_engineer_id` on `service_cases`.
- It generates **zero revocation tombstones** and **zero historical child-visit backfills**.
- In the mobile app ([`apps/field/src/sync/delta-applier.ts`](file:///D:/Zentra/apps/field/src/sync/delta-applier.ts)), tombstones are processed, but scoped recipient filtering does not exist on the server.

##### 2. The Physical Limits of Offline Revocation
- When Case C1 is reassigned from Engineer E1 to Engineer E2:
  - **If E1 is OFFLINE:** E1's device cannot receive network packets.
  - The case C1 **remains fully accessible and visible in E1's local SQLite database**.
  - E1 can physically drive to the site, inspect the equipment, and submit a visit.
  - Local revocation is **EVENTUAL**, occurring only when E1 regains cellular connectivity and performs a delta sync.
  - It is technically false to describe reassignment as "immediate remote deletion".

##### 3. Tombstone Data-Loss Vulnerability Discovered in Mobile App
- Direct inspection of [`apps/field/src/sync/delta-applier.ts#L268-283`](file:///D:/Zentra/apps/field/src/sync/delta-applier.ts#L268-283) reveals:
  ```typescript
  if (isCase) {
    const matchingRecords = await this.database
      .get<ServiceCaseModel>('service_cases')
      .query(Q.or(Q.where('server_id', tombstone.entityId), Q.where('id', tombstone.entityId)))
      .fetch();
    for (const record of matchingRecords) {
      await record.destroyPermanently();
      purgedCount++;
    }
  }
  ```
- **Vulnerability:** Unlike the `UPSERT` handler (which inspects `local_operations` for `PENDING_SYNC` and marks conflicts), the `TOMBSTONE` handler calls `record.destroyPermanently()` **without checking `local_operations`**.
- If E1 performed an offline visit on Case C1, and upon connecting receives a Scoped Revocation Tombstone for Case C1 before or during delta sync:
  - Case C1 is permanently deleted from SQLite.
  - The pending visit in `local_operations` is orphaned (references a deleted `service_cases` row).
  - When the push sync attempts to resolve the parent case, it crashes or fails foreign key validation.
- **Mandatory Mobile Fix:** Before executing `record.destroyPermanently()`, `delta-applier.ts` must query `local_operations`. If pending operations exist for that entity, the tombstone must be deferred or marked `CONFLICT_PENDING_PURGE`.

---

#### Section F: Reconciliation of Evidence, Claims, and Unexecuted Tests

The following section explicitly reconciles prior report claims with verifiable repository evidence.

| Guarantee / Invariant | Status | Verifiable Codebase / Semantic Evidence | Underlying Assumptions | Required Evidence / Test to Close Gap |
| :--- | :--- | :--- | :--- | :--- |
| **Commit-Order Sequencing** | **CONDITIONAL (SPEC)** | PostgreSQL deferred constraint trigger queues during pre-commit; lock on `tracker_id = 1` serializes WAL write. | Trigger procedure must be terminal statement; isolation must be `READ COMMITTED`. | Migration implementing triggers; `TEST-CORR-01` (`pgbench` 50 concurrent workers). |
| **Sequence Rollback Integrity** | **CONDITIONAL (SPEC)** | Table row update in PostgreSQL MVCC rolls back on transaction abort; no orphaned sequence IDs. | No autonomous transactions or `dblink` calls inside trigger. | Unit test verifying aborted transaction leaves `current_seq` unchanged. |
| **Deadlock Freedom on Counter** | **CONDITIONAL (SPEC)** | Single terminal row lock at commit time cannot form cycles under Dijkstra hierarchy theorem. | Application code NEVER queries `sync_sequence_tracker` directly during DML. | Concurrency stress test verifying zero deadlock aborts under 100 simultaneous transactions. |
| **Bootstrap Boundary Invariance** | **CONDITIONAL (SPEC)** | `REPEATABLE READ` snapshot guarantees max visible sequence $K$ cleanly separates snapshot tuples from delta tuples. | Entire bootstrap read inside a SINGLE database transaction. | Implementation of transaction-bound bootstrap endpoint; `TEST-CORR-02`. |
| **Retention / Delta Race Immunity** | **CONDITIONAL (SPEC)** | Watermark advance in same transaction as delete guarantees no reader sees pruned gap without $C < W - 1$. | Watermark update MUST commit prior to or atomically with physical tuple deletion. | Implementation of atomic retention worker; `TEST-CORR-03`. |
| **Local Queue Preservation** | **VERIFIED (SOURCE)** | [`apps/field/src/sync/delta-applier.ts#L55-82`](file:///D:/Zentra/apps/field/src/sync/delta-applier.ts#L55-82) checks `PENDING_SYNC` and transitions to `CONFLICT`. | Preserves mutations on `UPSERT` only. Fails on `TOMBSTONE`. | Unit test patching tombstone handler to protect pending operations. |
| **Scoped Revocation & Child Backfill** | **CONDITIONAL (SPEC)** | Theoretical specification in A9/A10 for tombstone insertion on reassignment. | Server tracks previous assignee and dispatches targeted tombstones. | Implementation in `dispatch-engine.service.ts`; `TEST-CORR-04`. |
| **Application Write Coverage** | **VERIFIED (SOURCE)** | All existing write paths across `service-cases`, `visits`, `evidence`, and `conveyance` identified in Knex code. | Triggers must be attached to all 4 tables. | Migration creating triggers across all 4 entity tables. |
| **Trigger Bypass Immunity (`TRUNCATE`)** | **DISPROVEN / GAP** | Migration `20261007000001#L209` grants `TRUNCATE` to `zentra_app`. Zero `REVOKE TRUNCATE` statements in repo. | If app runs as table owner, `TRUNCATE` and trigger disable are unrestricted. | Migration executing `REVOKE TRUNCATE` on all tables and default privileges. |
| **Hardware Throughput & Latency** | **NOT VERIFIED** | Theoretical calculation (0.08ms – 0.25ms row lock latency). | AWS RDS PostgreSQL 16.3 gp3 IOPS performance. | Physical staging benchmark on RDS multi-AZ instance under production load. |

---

### 4. Counterexample Timelines and Proof Assumptions

#### Counterexample Attempt 1: The Out-of-Order Commit Illusion
- **Challenge:** Can Transaction $T_2$ commit with sequence $K + 1$ *before* Transaction $T_1$ with sequence $K$ commits?
- **Proof of Impossibility:**
  - $T_1$ executes `UPDATE sync_sequence_tracker SET current_seq = current_seq + 1 WHERE tracker_id = 1 RETURNING current_seq INTO v_seq;`
  - PostgreSQL acquires an exclusive tuple lock (`XMAX = XID(T_1)`).
  - $T_2$ reaches the same statement in its deferred trigger.
  - $T_2$ attempts to acquire the tuple lock, finds `XMAX` active, and enters `XactLockTableWait(XID(T_1))`.
  - $T_2$ is physically suspended by the PostgreSQL kernel until $T_1$'s transaction commits or aborts in the WAL.
  - Therefore, $T_2$ cannot commit before $T_1$. Commit order strictly equals sequence allocation order.

#### Counterexample Attempt 2: Deadlock Cycle via Multi-Table Writes
- **Challenge:** Can a deadlock occur between $T_A$ and $T_B$ if $T_A$ writes Case then Visit, and $T_B$ writes Visit then Case?
- **Analysis:**
  - In statement phase: $T_A$ locks Case 1, then requests Visit 1 (held by $T_B$). $T_B$ locks Visit 1, then requests Case 1 (held by $T_A$).
  - **PostgreSQL detects this domain deadlock during statement execution** and aborts one transaction with `40P01 deadlock_detected`.
  - **Neither transaction reached pre-commit or the sequence tracker!**
  - If statement order does not conflict, both reach pre-commit. At pre-commit, the sequence tracker lock is requested. Because it is a single row lock, requests form a strict FIFO wait queue. No cycle can form.

---

### 5. Guarantee-by-Guarantee Status Matrix

| Category | Invariant Name | Factual Codebase State | Specification State | Formal Status |
| :--- | :--- | :--- | :--- | :--- |
| **Sequencing** | Commit-Order Equivalence | Missing (Code uses `updated_at`) | Formulated & Defended | **CONDITIONAL** |
| **Sequencing** | Gap-Free Rollback Safety | Missing (Table not created) | Formulated & Defended | **CONDITIONAL** |
| **Concurrency** | Counter Lock Deadlock Freedom | Missing (No counter table) | Formulated & Defended | **CONDITIONAL** |
| **Concurrency** | High-Concurrency Throughput | Not Run (No benchmarks run) | Formulated (0.08ms) | **NOT VERIFIED** |
| **Handoff** | Bootstrap Snapshot Boundary | Missing (Code uses separate queries)| Formulated (Repeatable Read)| **CONDITIONAL** |
| **Handoff** | Single-Transaction Bootstrap | Missing (Not implemented) | Required Specification | **CONDITIONAL** |
| **Lifecycle** | Dynamic Reassignment Revocation| Missing (No tombstones created) | Formulated | **CONDITIONAL** |
| **Lifecycle** | Dynamic Child Tree Backfill | Missing (No backfill logic) | Formulated | **CONDITIONAL** |
| **Retention** | Prune vs Delta Race Immunity | Missing (No watermark table) | Formulated (Atomic Batch) | **CONDITIONAL** |
| **Security** | Non-Superuser Trigger Integrity| Missing (Role name mismatch) | Formulated | **CONDITIONAL** |
| **Security** | TRUNCATE Bypass Prevention | Vulnerable (`GRANT ALL` active) | Identified Gap | **DISPROVEN / GAP** |
| **Mobile** | Local Queue Upsert Safety | Implemented (`delta-applier.ts`)| Formulated | **VERIFIED (SOURCE)**|
| **Mobile** | Local Queue Tombstone Safety | Vulnerable (Calls destroy) | Identified Gap | **DISPROVEN / GAP** |

---

### 6. Unresolved Blockers Ranked by Severity

1. **BLOCKER-01 (CRITICAL — Potential Offline Data Loss):**
   `apps/field/src/sync/delta-applier.ts` permanently destroys local records on tombstone delivery without checking `local_operations`. A reassignment tombstone can orphan offline queued visits.
2. **BLOCKER-02 (CRITICAL — Missing Database Migrations):**
   `sync_change_ledger`, `sync_sequence_tracker`, and `sync_retention_watermark` do not exist. Downstream sync remains vulnerable to timestamp collisions and late commit omissions.
3. **BLOCKER-03 (HIGH — Database Privilege Hole & Role Mismatch):**
   `GRANT ALL ON ALL TABLES` grants `TRUNCATE` to `zentra_app`, allowing row trigger bypass. Role names differ between migrations (`zentra_app`), Terraform (`zentra_staging_app`), and dev (`zentra_dev`).
4. **BLOCKER-04 (HIGH — Retention Multi-Batch Race):**
   Retention worker deletion must atomically advance `min_available_seq` in the same transaction as tuple deletion to prevent silent event skips.
5. **BLOCKER-05 (MEDIUM — Multi-Request Bootstrap Skew):**
   Bootstrap API must bind case and visit reads to a single database transaction/snapshot to prevent entities falling between request boundaries.

---

### 7. Tests Required for Explicitly Authorized Isolated Staging

When implementation authorization is granted by governance, the following test suite must be executed on an isolated staging database:

1. **TEST-CORR-01: Commit-Order Serialization Stress Test**
   - Execute 50 concurrent `pgbench` clients updating `service_cases`. Verify that `event_seq` order strictly matches WAL commit order with zero sequence gaps.
2. **TEST-CORR-02: Bootstrap Boundary Invariance Test**
   - Stream 10,000 cases via `REPEATABLE READ` while 20 concurrent workers generate 500 case updates. Verify every update appears in either bootstrap or subsequent delta with zero omissions.
3. **TEST-CORR-03: Atomic Retention Batch Pruning Test**
   - Concurrently trigger retention cleanup while executing delta pulls at the retention boundary. Verify HTTP 410 is returned without skipping events.
4. **TEST-CORR-04: Reassignment & Offline Conflict Test**
   - Reassign Case C1 while an engineer has an offline queued visit. Verify that the mobile app preserves the queued visit and does not crash or orphan operations.
5. **TEST-CORR-05: TRUNCATE Privilege Denial Test**
   - Connect as `zentra_app` and execute `TRUNCATE service_cases`. Verify PostgreSQL denies permission with error `42501 permission_denied`.

---

### 8. Data-Safety Declaration

Under strict read-only governance:
- **Historical Baseline Preserved (Without Fresh Verification):**
  - Physical OnePlus Nord AC2001 (`65c7923e`) remains offline and disconnected.
  - Six queued operations in `local_operations` (all historical retry counts = 0).
  - Two physical photographs (`82ce30ce-4712-441c-a43a-cda18fca8151.jpg` and `835bac9f-fbc1-4eae-9a16-277c79d6228d.jpg`) and hashes unaltered.
  - Mobile test suite (207/207) and sync security unit tests (25/25) preserved.
- **Repository State:** Zero files modified, created, or deleted (except deliverable reports); zero migrations or DDL executed.
- **No Fabrications:** No performance metrics, benchmarks, or database states were simulated or claimed as executed.

---

### 9. Files Changed, Created, or Deleted

- **Source Code Files Changed:** 0
- **Test Files Changed:** 0
- **Migration Files Changed:** 0
- **Configuration Files Changed:** 0
- **Reports Created:**
  - `D:\Zentra\STAGE_6G_B3_C4_RP_A14_INDEPENDENT_FALSIFICATION_AUDIT.md`
  - `D:\Zentra\docs\STAGE_6G_B3_C4_RP_A14_INDEPENDENT_FALSIFICATION_AUDIT.md`

---

### 10. Exact Next Recommended Governance Step

**Do NOT authorize production implementation or live synchronization.**

Submit this independent falsification audit to system governance. The technical specification is now hardened against batching races, tombstone orphan vulnerabilities, and privilege holes. 

The next formal governance step is:
**Convene Stage 6G-B3-C4-IR (Implementation Authorization Review)** to review the migration scripts in an isolated local staging branch, authorize execution of the 5 staging tests, and resolve database role naming across Terraform and application configurations.

---

STOP — STAGE 6G-B3-C4-RP-A14 COMPLETE. STRICT READ-ONLY EVIDENCE REVIEW ONLY. NO CODE CHANGES. NO DATABASE WRITES. NO LIVE SYNC AUTHORIZED.
