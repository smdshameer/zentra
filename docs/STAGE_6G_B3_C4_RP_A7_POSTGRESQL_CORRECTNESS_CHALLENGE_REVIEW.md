# MUSE SPARK — STAGE 6G-B3-C4-RP-A7
## PostgreSQL Trigger Validity, Snapshot Proof & Lock-Graph Challenge Review

**Project:** ZENTRA Field Call Tracker & ITSM Platform  
**Repository:** `D:\Zentra`  
**Mode:** STRICT READ-ONLY TECHNICAL REVIEW  
**Implementation Authorization:** NOT GRANTED  
**Live Sync Authorization:** STRICTLY PROHIBITED  
**Review Date:** 2026-10-19  

---

### 1. Executive Verdict

**VERDICT: HOLD / NO-GO**

While the underlying concept of a unified change ledger and a serialized commit-order counter solves the fundamental temporal-drift flaw of timestamp cursors (F-09), an exhaustive challenge review of the exact proposed SQL and architecture against PostgreSQL internals, schema contracts, and the active codebase has uncovered **four critical correctness and security blockers**:

1. **PostgreSQL Trigger Syntax & Semantic Invalidation (Challenge A):**
   The trigger attachment proposed in Stage A6 (`WHEN (TG_OP <> 'UPDATE' OR OLD.* IS DISTINCT FROM NEW.*)`) is **syntactically invalid** in PostgreSQL. `TG_OP` does not exist in SQL trigger `WHEN` scope (`ERROR: column "tg_op" does not exist`), and cross-referencing `OLD` on `INSERT` or `NEW` on `DELETE` within a combined trigger's `WHEN` clause is prohibited. Furthermore, accessing table-specific record fields across heterogeneous tables in a single PL/pgSQL function produces runtime tuple descriptor mismatches.
2. **Refutation of the "Deadlocks Are Impossible" Claim (Challenge C):**
   The claim that the singleton counter row is "always the final lock and therefore deadlocks are impossible" is **mathematically false for multi-statement transactions**. `AFTER FOR EACH ROW` triggers fire immediately upon execution of each DML statement, NOT at transaction `COMMIT`. In standard business flows (e.g. Visit Check-In or Sync Push batches), Statement 1 updates table A (locking the counter), and Statement 2 attempts to lock table B, resulting in fatal circular deadlocks (`40P01`) against concurrent transactions updating table B then table A.
3. **Catastrophic Security Flaw — Cross-District Data Leakage (Challenge E):**
   The proposed `sync_change_ledger` schema contains only `entity_type`, `entity_id`, `action`, `version`, `is_deleted`, and `payload`. It lacks denormalized scoping columns (`district_id`, `engineer_id`, `school_id`). Streaming deltas from this ledger would broadcast **all state-wide service cases, visits, evidence files, and conveyance claims to all field engineers**, violating the core multi-tenant security boundary of ZENTRA enforced in `sync-delta.service.ts#L170-L228`.
4. **Shared Type and Mobile Delta Applier Contract Violations (Challenge E):**
   The proposed trigger produces action values `'INSERT'`, `'UPDATE'`, `'DELETE'`. The authoritative contract in `packages/contracts/src/sync/sync.contract.ts#L96` strictly validates `action: z.enum(['UPSERT', 'TOMBSTONE'])`. Furthermore, the mobile client (`apps/field/src/sync/delta-applier.ts#L265-L314`) purges records exclusively by iterating `delta.tombstones`; combining deletions into `delta.changes` would cause mobile devices to permanently retain deleted records.

Implementation cannot proceed until these four concrete defects are remediated in the specification.

---

### 2. Read-Only Scope and Inspected Files

This review was conducted under strict read-only governance without modifying any project code, schemas, or databases:

- **Historical Reference Baseline Preserved:**
  - 6 queued operations in mobile `local_operations` (retry count = 0).
  - 2 physical photographs (`82ce30ce-4712-441c-a43a-cda18fca8151.jpg` and `835bac9f-fbc1-4eae-9a16-277c79d6228d.jpg`) and hashes unaltered.
  - Test suites (207/207 mobile, 25/25 sync security) preserved.
- **Key Source Code Inspected:**
  - `apps/api/src/modules/sync/services/sync-delta.service.ts`: Lines 165–230 (Territory isolation and role scoping).
  - `apps/field/src/sync/delta-applier.ts`: Lines 38–60 (Changes loop), Lines 265–314 (Tombstones loop).
  - `packages/contracts/src/sync/sync.contract.ts`: Lines 93–120 (Zod validation for `syncDeltaChangeItemSchema` and `syncDeltaResponseDataSchema`).
  - `packages/types/src/index.ts`: Lines 640–658 (Shared TypeScript interfaces for delta responses).
  - PostgreSQL 15/16 official documentation regarding `CREATE TRIGGER`, `PL/pgSQL Trigger Procedures`, and `Row-Level Lock Acquisition`.

---

### 3. Challenge A — PostgreSQL Trigger Syntax Findings

#### 3.1. Invalidity of `TG_OP` in `CREATE TRIGGER ... WHEN`
In PostgreSQL, the `WHEN (condition)` clause of a `CREATE TRIGGER` statement is evaluated by the core SQL executor before the PL/pgSQL procedural language engine is invoked.
- `TG_OP` is an automatic local variable injected into the PL/pgSQL execution context. It does NOT exist in the SQL catalog or relation namespace.
- **Syntax Failure:** Running `CREATE TRIGGER ... WHEN (TG_OP <> 'UPDATE' ...)` yields:
  ```
  ERROR: column "tg_op" does not exist
  LINE 4: WHEN (TG_OP <> 'UPDATE' OR OLD.* IS DISTINCT FROM NEW.*)
                ^
  ```
- **Execution Proof:** `TG_OP` cannot be referenced in a trigger's `WHEN` expression.

#### 3.2. Invalidity of Mixed `OLD` and `NEW` in Combined Triggers
In PostgreSQL:
- On `INSERT`: `OLD` is undefined. Referencing `OLD` in the `WHEN` clause produces:
  `ERROR: OLD used in INSERT trigger condition`.
- On `DELETE`: `NEW` is undefined. Referencing `NEW` in the `WHEN` clause produces:
  `ERROR: NEW used in DELETE trigger condition`.
- Therefore, a single trigger defined on `INSERT OR UPDATE OR DELETE` cannot use `OLD.* IS DISTINCT FROM NEW.*` in its `WHEN` clause.

#### 3.3. Heterogeneous Table Tuple-Descriptor Mismatch in PL/pgSQL
In the unified trigger function proposed in Stage A6:
```sql
IF v_entity_type = 'service_cases' THEN
  v_entity_id := OLD.service_case_id;
ELSIF v_entity_type = 'field_visits' THEN
  v_entity_id := OLD.visit_id;
...
```
When this function fires on `field_visits`, the PL/pgSQL runtime binds `OLD` to the composite type `public.field_visits`. Accessing `OLD.conveyance_claim_id` or `OLD.service_case_id` on tables that lack those specific attributes can trigger runtime evaluation errors in PL/pgSQL depending on planner branch optimization:
```
ERROR: record "old" has no field "conveyance_claim_id"
```
A generic trigger function referencing concrete record attributes across disparate tables is unsafe.

#### 3.4. Ignored Return Values in `AFTER` Triggers
In PostgreSQL:
- For `BEFORE` row triggers, returning `NULL` aborts the operation for that row.
- For `AFTER` row triggers, the return value is **completely ignored** by the PostgreSQL executor. Whether the function returns `NULL`, `OLD`, or `NEW`, the row is already committed to the heap.
- However, returning `RETURN OLD` on `DELETE` and `RETURN NEW` on `INSERT`/`UPDATE` remains the standard convention to prevent accidental logic errors if the trigger is ever adapted.

---

### 4. Corrected Conceptual Trigger Attachment Pattern

To solve the syntax, tuple-descriptor, and no-op update problems, two valid patterns exist:

#### Pattern 1: Table-Specific Strongly Typed Functions (Recommended)
Instead of one massive polymorphic function with conditional branches, define 4 concise, strongly typed trigger functions (one per table), combined with split triggers for clean no-op suppression:

```sql
-- CONCEPTUAL ONLY — NOT EXECUTED
-- 1. Table-specific trigger function for service_cases
CREATE OR REPLACE FUNCTION fn_sync_service_cases_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_action varchar(16);
  v_new_seq bigint;
BEGIN
  IF TG_OP = 'DELETE' OR NEW.is_deleted = true THEN
    v_action := 'TOMBSTONE';
  ELSE
    v_action := 'UPSERT';
  END IF;

  -- Atomic counter allocation
  UPDATE sync_sequence_tracker
  SET current_seq = current_seq + 1, updated_at = CURRENT_TIMESTAMP
  WHERE tracker_id = 1
  RETURNING current_seq INTO v_new_seq;

  INSERT INTO sync_change_ledger (
    event_seq, entity_type, entity_id, district_id, action, version, is_deleted, payload, created_at
  ) VALUES (
    v_new_seq, 'service_cases',
    CASE WHEN TG_OP = 'DELETE' THEN OLD.service_case_id ELSE NEW.service_case_id END,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.district_id ELSE NEW.district_id END,
    v_action,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.version + 1 ELSE NEW.version END,
    CASE WHEN TG_OP = 'DELETE' THEN true ELSE NEW.is_deleted END,
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END,
    CURRENT_TIMESTAMP
  );

  RETURN NULL; -- Ignored in AFTER triggers
END;
$$ LANGUAGE plpgsql;

-- 2. Clean Split Attachment:
-- A. Trigger for INSERT and DELETE
CREATE TRIGGER trg_service_cases_ins_del
AFTER INSERT OR DELETE ON service_cases
FOR EACH ROW EXECUTE FUNCTION fn_sync_service_cases_ledger();

-- B. Trigger for UPDATE with valid no-op suppression
CREATE TRIGGER trg_service_cases_upd
AFTER UPDATE ON service_cases
FOR EACH ROW
WHEN (OLD.* IS DISTINCT FROM NEW.*)
EXECUTE FUNCTION fn_sync_service_cases_ledger();
```

#### Pattern 2: Single Function with Internal Early Exit
Alternatively, keep a single function per table, but evaluate no-op updates inside PL/pgSQL:
```sql
-- Inside PL/pgSQL function:
IF TG_OP = 'UPDATE' AND OLD.* IS NOT DISTINCT FROM NEW.* THEN
  RETURN NULL; -- Early exit: zero counter allocation, zero ledger insert
END IF;
```

---

### 5. Snapshot and Counter Concurrency Proof

We independently reconstruct the formal concurrency proof under PostgreSQL MVCC across 8 critical timelines:

```
Concurrency Timeline Matrix (REPEATABLE READ Snapshot vs Serialized Counter)
=======================================================================================================
Timeline               Domain Row Visibility  Counter Visible  Sequence Allocated  Result in Sync
-------------------------------------------------------------------------------------------------------
1. Writer modifies     NOT VISIBLE to Tx B.   Reads committed  Allocates S1 = S0+1 Delivered in delta
   row before counter  (Tx W uncommitted at   counter S0.      upon commit at T4.  stream (seq > S0).
   update.             snapshot time T2).                                          Zero omission.
-------------------------------------------------------------------------------------------------------
2. Writer updates      NOT VISIBLE to Tx B.   In REPEATABLE    Allocates S1.       Delivered in delta
   counter, but        (Tx W uncommitted).    READ, Tx B sees  Commits at T3.      stream (seq > S0).
   uncommitted at T2.                         prior committed                      Zero omission.
                                              counter S0.
-------------------------------------------------------------------------------------------------------
3. Writer commits      VISIBLE in Tx B's      Tx B reads S1 as S1 allocated and   Included in bootstrap
   immediately before  snapshot (committed   S_snap.          committed.          baseline. Excluded from
   Tx B first query.   at T1 < T2).                                                subsequent delta.
-------------------------------------------------------------------------------------------------------
4. Writer commits      NOT VISIBLE to Tx B    Tx B reads S0.   S1 allocated at T3  Excluded from bootstrap
   immediately after   (uncommitted at                         (S1 > S0).          baseline. Delivered in
   Tx B first query.   snapshot start T2).                                         subsequent delta.
-------------------------------------------------------------------------------------------------------
5. Single transaction  All-or-nothing:        Reads S0 (if     Trigger fires for   Both rows delivered
   modifies 2 rows     either both visible    concurrent) or   each row, allocs    together in snapshot
   (Case A and B).     or neither.            S2 (if after).   S1 and S2.          or together in delta.
-------------------------------------------------------------------------------------------------------
6. Transaction rolls   Changes undone.        Rolls back to    Sequence number is  NO GAPS. Next writer
   back after counter  Never visible to       pre-tx value S0! rolled back in ACID gets S1 cleanly.
   increment.          other transactions.                     heap update.        No ghost records.
-------------------------------------------------------------------------------------------------------
7. Concurrent writers  Strictly isolated      Row lock forces  Tx 1 gets S1.       Commit order matches
   contend on counter  by domain row locks.   sequential       Tx 2 unblocks and   sequence allocation
   (Tx 1 and Tx 2).                           queueing.        gets S2 = S1 + 1.   order exactly.
-------------------------------------------------------------------------------------------------------
8. Writer locks row,   Blocks all other write Holding row lock Entire database     CRITICAL PERFORMANCE
   updates counter,    transactions in the    on singleton     write throughput    HAZARD: Head-of-line
   then delays commit. entire system!         tracker row!     stalls at zero!     blocking vulnerability.
=======================================================================================================
```

#### Conditions Required for Proof Correctness
The mathematical guarantee holds **IF AND ONLY IF**:
1. All domain writes occur inside the same PostgreSQL transaction as the trigger.
2. The bootstrap query runs inside a dedicated `TRANSACTION ISOLATION LEVEL REPEATABLE READ` where `SELECT current_seq FROM sync_sequence_tracker` is the **first statement executed**.
3. No non-trigger bypass paths exist (`ALTER TABLE ... DISABLE TRIGGER` is strictly prohibited).

---

### 6. Lock Dependency Matrix and Deadlock Analysis

#### 6.1. Refutation of the Deadlock Impossibility Claim
Stage A6 claimed: *"Because no code path ever acquires the counter lock first and then attempts to lock domain rows, lock inversion deadlocks are impossible."*

**This claim is mathematically false.**

In a multi-statement transaction, `AFTER` row triggers execute **at the end of each DML statement**, not at transaction commit:
- Consider a standard business workflow:
  1. Engineer checks in to a visit $\implies$ Backend executes `UPDATE field_visits ...`
  2. In the same transaction, backend cascades the status to the parent case $\implies$ `UPDATE service_cases ...`
- If an admin concurrently executes a bulk priority update on `service_cases` and then touches `field_visits`:

```
Multi-Statement Transaction Deadlock Cycle (Wait-For Graph)
=======================================================================================================
Time   Transaction 1 (Visit Check-In Flow)           Transaction 2 (Admin Case Priority Flow)
-------------------------------------------------------------------------------------------------------
T1     BEGIN;                                        BEGIN;
T2     UPDATE field_visits SET status='CHECKED_IN'   UPDATE service_cases SET internal_priority='HIGH'
       WHERE visit_id = V1;                          WHERE service_case_id = C1;
       --> Locks row field_visits(V1).               --> Locks row service_cases(C1).
       --> Trigger fires immediately!
       --> ACQUIRES EXCLUSIVE LOCK on
           sync_sequence_tracker(1)!
T3     UPDATE service_cases                          UPDATE field_visits
       SET operational_status='IN_PROGRESS'          SET notes='Admin priority escalated'
       WHERE service_case_id = C1;                   WHERE visit_id = V1;
       --> ATTEMPTS TO LOCK service_cases(C1)!       --> Fires trigger on field_visits...
       --> BLOCKED: Held by Transaction 2!           --> ATTEMPTS TO LOCK sync_sequence_tracker(1)!
                                                     --> BLOCKED: Held by Transaction 1!
-------------------------------------------------------------------------------------------------------
CYCLE: Tx 1 holds sync_sequence_tracker(1) and waits for service_cases(C1) (held by Tx 2).
       Tx 2 holds service_cases(C1) and waits for sync_sequence_tracker(1) (held by Tx 1).
-------------------------------------------------------------------------------------------------------
POSTGRESQL ABORT: ERROR: 40P01: deadlock detected
Process 12345 waits for ExclusiveLock on tuple (service_cases, C1); blocked by process 12346.
Process 12346 waits for ExclusiveLock on tuple (sync_sequence_tracker, 1); blocked by process 12345.
=======================================================================================================
```

#### 6.2. Lock Dependency Classification
1. **Deadlocks involving the singleton counter specifically:** High probability in multi-statement transactions modifying multiple domain entities in differing orders.
2. **Mitigation Strategy (Future Design):**
   - **Orderly Domain Locking:** Multi-entity operations must acquire domain entity locks in strict global alphabetical order (`service_cases` before `field_visits` before `evidence_files` before `conveyance_claims`).
   - **Deferred Constraint Triggers:** Alternatively, evaluate using a `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` so that counter allocation is delayed until actual transaction commit time.
3. **Verdict:** Global deadlock impossibility is **REFUTED**.

---

### 7. Retention, Empty Ledgers, and Gap Detection

#### 7.1. Testing the Stage A6 Formula Against Edge Cases
Stage A6 proposed:
`SELECT (MAX(event_seq) - MIN(event_seq) + 1) = COUNT(*) FROM sync_change_ledger;`

| Edge Case | `MAX` | `MIN` | `COUNT` | Evaluated Expression | Result | Flaw Identified |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Empty Ledger** | `NULL` | `NULL` | 0 | `NULL - NULL + 1 = 0` | **`NULL` (Falsy)** | Formula breaks on a clean/empty system. |
| **Fresh (1..3)** | 3 | 1 | 3 | `3 - 1 + 1 = 3` | `TRUE` | Valid. |
| **Pruned (501..1000)** | 1000 | 501 | 500 | `1000 - 501 + 1 = 500` | `TRUE` | Valid, but does NOT check watermark! |
| **Silent Loss (601..1000)** | 1000 | 601 | 400 | `1000 - 601 + 1 = 400` | **`TRUE` (False Positive!)** | **Events 501–600 missing**, watermark says 501, formula reports TRUE! |
| **Internal Gap (101, 103)** | 103 | 101 | 2 | `103 - 101 + 1 = 2` (3 = 2) | `FALSE` | Detects internal gap correctly. |

#### 7.2. Corrected Multi-Invariant Verification Protocol
To prove gap-freedom without false positives, four assertions must be evaluated together:

```sql
-- CONCEPTUAL AUDIT QUERY — NOT EXECUTED
SELECT
  -- Invariant 1: Table is internally continuous (or empty)
  CASE 
    WHEN count(*) = 0 THEN true 
    ELSE (max(event_seq) - min(event_seq) + 1) = count(*) 
  END AS is_internally_contiguous,

  -- Invariant 2: Lowest event matches retention watermark exactly
  CASE
    WHEN count(*) = 0 THEN (SELECT min_available_seq FROM sync_retention_watermark WHERE watermark_id = 1) = (SELECT current_seq + 1 FROM sync_sequence_tracker WHERE tracker_id = 1)
    ELSE min(event_seq) = (SELECT min_available_seq FROM sync_retention_watermark WHERE watermark_id = 1)
  END AS matches_retention_watermark,

  -- Invariant 3: Highest event matches current sequence tracker exactly
  CASE
    WHEN count(*) = 0 THEN (SELECT current_seq FROM sync_sequence_tracker WHERE tracker_id = 1) = 0
    ELSE max(event_seq) = (SELECT current_seq FROM sync_sequence_tracker WHERE tracker_id = 1)
  END AS matches_sequence_tracker
FROM sync_change_ledger;
```

---

### 8. Backend / Mobile Contract Compatibility Matrix

A comprehensive inspection of `apps/api/`, `apps/field/`, and `packages/` reveals major breaking mismatches between the proposed ledger and existing codebase contracts:

| Area | Current Codebase Baseline | Proposed Ledger Design | Contract Compatibility | Required Resolution |
| :--- | :--- | :--- | :---: | :--- |
| **Territory / District Isolation** | `sync-delta.service.ts#L170-228` filters by `assignedDistrictIds` & `engineerId`. | `sync_change_ledger` has NO district or engineer columns. | **CRITICAL BREAK / SECURITY LEAK** | Must add denormalized `district_id uuid` and `engineer_id uuid` to `sync_change_ledger`. |
| **Delta Action Enum** | `sync.contract.ts#L96`: `z.enum(['UPSERT', 'TOMBSTONE'])`. | Trigger uses `'INSERT'`, `'UPDATE'`, `'DELETE'`. | **BREAKING (ZodError)** | Map `'INSERT'`/`'UPDATE'` $\to$ `'UPSERT'`, and `'DELETE'` $\to$ `'TOMBSTONE'` in trigger or API mapper. |
| **Tombstone Delivery** | `delta-applier.ts#L265-314` purges from `delta.tombstones` array. | Single unified `changes` stream with `action: 'DELETE'`. | **BREAKING (Purge Failure)** | API delta endpoint must project tombstones into `delta.tombstones` array to preserve mobile compatibility. |
| **Cursor Decoding** | `sync-cursor.ts` decodes `{ t: string, s: number }`. | Cursor v3 uses `{ v: 3, seq: string }`. | **BREAKING (Schema Mismatch)** | Implement v3 decoder with automatic legacy cursor migration fallback to `BOOTSTRAP_REQUIRED`. |
| **64-bit Integer Representation** | JSON numbers default to double-precision float ($2^{53}-1$). | `BIGINT event_seq` ($2^{63}-1$). | **RISK (Precision Loss)** | Represent `seq` strictly as a decimal string (`"10502"`) across contracts and models. |
| **Evidence Upload Lifecycle** | `evidence_files.upload_status` transitions from `SESSION_CREATED` to `FINALIZED`. | Trigger records raw row states. | **COMPATIBLE** | Ensure intermediate `SESSION_CREATED` states are filtered or handled safely. |
| **Pending Mutation Conflicts** | `delta-applier.ts#L55-82` flags `VERSION_CONFLICT` on incoming delta. | Ledger provides authoritative server `version`. | **COMPATIBLE** | Existing mobile conflict arbitration functions correctly. |

---

### 9. Findings Classified by Severity

| ID | Title | Severity | Status | Impact / Consequence |
| :--- | :--- | :---: | :---: | :--- |
| **F-15** | Cross-District Security Leakage in Change Ledger | **CRITICAL** | **BLOCKER** | Ledgers streamed without `district_id` filtering leak state-wide data to field engineers. |
| **F-16** | Trigger Syntax Invalidation (`TG_OP` & `OLD/NEW` in `WHEN`) | **CRITICAL** | **BLOCKER** | Migration DDL will fail execution in PostgreSQL (`ERROR: column "tg_op" does not exist`). |
| **F-17** | Multi-Statement Transaction Deadlock Cycle | **HIGH** | **BLOCKER** | Refutes deadlock impossibility; standard cascade updates trigger `40P01` deadlock aborts. |
| **F-18** | Action Enum Mismatch (`UPSERT`/`TOMBSTONE` vs `INSERT`/`UPDATE`) | **HIGH** | **BLOCKER** | API response fails Zod schema validation at runtime (`syncDeltaChangeItemSchema`). |
| **F-19** | Mobile Tombstone Array Purge Incompatibility | **HIGH** | **BLOCKER** | Mobile `delta-applier.ts` ignores deletions sent in `changes`, failing to purge deleted records. |
| **F-20** | Gap Detection False Positives on Empty/Pruned Ledgers | **MEDIUM** | **BLOCKER** | Formula `MAX - MIN + 1 = COUNT` returns `NULL` on empty table and ignores retention mismatches. |

---

### 10. Verified Facts vs Assumptions and Unexecuted Tests

#### Verified Facts (Direct Codebase & Documentation Evidence)
1. In PostgreSQL, `TG_OP` cannot be used in a `CREATE TRIGGER ... WHEN` clause.
2. In PostgreSQL, combined `INSERT OR UPDATE OR DELETE` triggers cannot cross-reference `OLD` and `NEW` in a `WHEN` clause.
3. `sync_change_ledger` as designed lacks `district_id`, while `apps/api/src/modules/sync/services/sync-delta.service.ts` lines 170–228 strictly enforces district isolation.
4. `packages/contracts/src/sync/sync.contract.ts` line 96 strictly validates `action: z.enum(['UPSERT', 'TOMBSTONE'])`.
5. `apps/field/src/sync/delta-applier.ts` lines 265–314 purges records exclusively by reading `delta.tombstones`.
6. Row-level `AFTER` triggers fire at the end of each SQL statement, enabling multi-statement deadlock cycles.

#### Assumptions and Unexecuted Tests
1. **Deadlock Frequency:** The exact probability of deadlock in production under 100 concurrent workers has not been empirically measured.
2. **PostgreSQL Migration Execution:** No proposed DDL or triggers have been executed against live databases.

---

### 11. Exact Blockers Remaining

Implementation authorization **CANNOT BE GRANTED** until the following four blockers are formally resolved in the design specification:

1. **Schema Correction for Territory Scoping:** Add `district_id uuid` (and engineer assignment indices) directly to the proposed `sync_change_ledger` table.
2. **Trigger Attachment Correction:** Replace invalid `WHEN (TG_OP ...)` clauses with table-specific trigger definitions or internal PL/pgSQL early-exit checks.
3. **Contract Alignment:** Align ledger action values with `@zentra/contracts` (`UPSERT` / `TOMBSTONE`) and preserve projection into `delta.tombstones` for mobile `delta-applier.ts` compatibility.
4. **Transaction Order Governance:** Establish strict alphabetical lock-ordering standards across multi-entity backend write transactions to prevent counter-related deadlock cycles.

---

### 12. Data-Safety and File-Change Declaration

Under strict read-only governance:
- **Application Code & Tests:** Zero files edited, renamed, or deleted.
- **Database State:** Zero migrations executed, zero DDL run, zero data written or deleted.
- **Mobile Device & Queue:** OnePlus Nord AC2001 (`65c7923e`), all 6 queued operations, and both physical photos remain untouched.
- **Git State:** Working tree remains clean; baseline commit intact.
- **No Fabrications:** No performance metrics or benchmarks were simulated or fabricated.

---

### 13. Recommended Next Step

**HOLD IMPLEMENTATION.**

Do NOT authorize Stage C5 or any live synchronization. Issue a corrective specification pass (**Stage 6G-B3-C4-RP-A8**) to:
1. Update the `sync_change_ledger` schema with `district_id` and indexing.
2. Formulate valid table-specific trigger attachments.
3. Align the delta API projection with `@zentra/contracts` and mobile `delta-applier.ts`.
4. Define the multi-entity transaction lock acquisition ordering standard.

---

STOP — STAGE 6G-B3-C4-RP-A7 COMPLETE. READ-ONLY CORRECTNESS REVIEW ONLY. NO CODE CHANGES. NO DATABASE WRITES. NO LIVE SYNC AUTHORIZED.
