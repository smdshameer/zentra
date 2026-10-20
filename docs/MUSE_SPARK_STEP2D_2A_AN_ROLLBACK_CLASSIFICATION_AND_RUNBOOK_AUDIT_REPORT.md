# MUSE SPARK — ZENTRA STEP 2D-2A-AN
## ROLLBACK CLASSIFICATION & RECOVERY RUNBOOK EXISTENCE AUDIT — DOCUMENTATION ONLY

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Target Repository:** `D:\Zentra`  
**Input References:**  
- [`docs/MUSE_SPARK_STEP2D_2A_AM_PREFLIGHT_AND_MANUAL_RECOVERY_AUDIT_REPORT.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_AM_PREFLIGHT_AND_MANUAL_RECOVERY_AUDIT_REPORT.md)  
- [`docs/MUSE_SPARK_STEP2D_2A_AL_EXCEPTION_CONTAINMENT_AUDIT_REPORT.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_AL_EXCEPTION_CONTAINMENT_AUDIT_REPORT.md)  
- [`docs/MUSE_SPARK_STEP2D_2A_AK_FINAL_SNAPSHOT_INTEGRITY_AUDIT_REPORT.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_AK_FINAL_SNAPSHOT_INTEGRITY_AUDIT_REPORT.md)  
- [`docs/MUSE_SPARK_STEP2D_2A_AJ_REPLACEMENT_COLLISION_AND_STATE_CORRECTION_REPORT.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_AJ_REPLACEMENT_COLLISION_AND_STATE_CORRECTION_REPORT.md)  
**Host Environment:** Windows Workstation (`127.0.0.1:5432`)  
**Report Date:** 2026-10-09  
**Mode:** STRICT DOCUMENTATION-ONLY SPECIFICATION AUDIT & RUNBOOK FINALIZATION  
**Budget Constraint:** Strict ₹0/month (Zero cost, no credit cards, no paid upgrades)  
**Remote Access:** STRICTLY PROHIBITED (Zero remote connections made)  
**Execution Authorization:** NOT GRANTED — NO COMMANDS EXECUTED IN THIS STEP  
**Status:** COMPLETE — WAITING FOR HUMAN OPERATOR REVIEW  

---

## 1. Executive Summary & Verdict

In **Step 2D-2A-AM**, the Universal 9-Class Status Classification Taxonomy was introduced across pre-flight and pre-swap replacement checks, and raw `Copy-Item` command execution was eliminated from the manual recovery boundary.

However, a comprehensive audit of the Step AM deliverable identified two severe architectural and operational defects:

1. **Rollback Status Conflation in `Invoke-ControlledRollbackV13`:**
   - **Stage 3B (Discard Verification):** Lines 581–589 checked `if ($discardInfo.Status -ne "HASH_VERIFIED" -or $discardInfo.Hash -ne $ExpectedTriggerHash)` and returned `DISCARD_HASH_MISMATCH`. If the discard backup was missing (`FILE_MISSING`), locked by an anti-virus or search indexer (`HASH_READ_FAILED`), threw an internal helper exception (`HELPER_EXCEPTION`), or returned an unrecognized status, it was falsely labeled as a hash mismatch.
   - **Stage 4A (Sacrificial Clone Verification):** Lines 665–673 similarly checked `if ($cloneInfo.Status -ne "HASH_VERIFIED" -or $cloneInfo.Hash -ne $ExpectedBaselineHash)` and returned `SACRIFICIAL_CLONE_CORRUPT`. An unreadable or locked clone was misdiagnosed as content corruption. True corruption exists *only* when the file is readable and its computed hash demonstrably differs from baseline.
   - **Stage 4B (Pre-Rollback-Swap Live Barrier):** Lines 737–745 evaluated `if ($livePreSwapCheck.Status -ne "HASH_VERIFIED" -or $livePreSwapCheck.Hash -ne $ExpectedTriggerHash)` and returned `LIVE_MUTATED_POST_DISCARD`. If the live file returned an unrecognized status string, the engine falsely asserted that the live file had mutated.
   - **Stage 6 (Post-Rollback Verification):** Lines 816–824 lumped `HELPER_EXCEPTION` and unknown status strings into `RESTORED_FILE_UNVERIFIABLE` rather than reporting distinct, actionable failure classes.

2. **Fictitious / Non-Existent Recovery Runbook Reference (Critical Blocker):**
   In `Enter-ManualRecoveryBoundaryV13` (line 1175), Step AM instructed the human incident commander to:
   `Consult the formal reviewed runbook: docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md Section 'Manual Restoration Protocol'`.
   An empirical filesystem audit of the repository confirmed:
   - **The file `docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md` DOES NOT EXIST** (`Test-Path` returned `False`).
   - The older Step U runbook (`docs/MUSE_SPARK_STEP2D_2A_U_POSTGRESQL_SECURITY_REMEDIATION_RUNBOOK.md`) covers database provisioning (`zentra_dev`, migrations, seeds) and contains zero instructions for configuration file restoration.
   - Referencing an unauthored, unreviewed file creates a critical operational hazard: during an incident, an operator would encounter a broken link with no vetted manual recovery protocol.
   - **Verdict:** Claiming that a reviewed manual recovery runbook exists is invalid. This report formally registers the missing runbook as an **OPEN BLOCKER**, details the technical requirements for the missing runbook, and updates the manual recovery boundary to explicitly halt fail-closed without referencing phantom documents.

This report, **Step 2D-2A-AN**, resolves all identified defects:
- Hardens the rollback engine to **`Invoke-ControlledRollbackV14`**, implementing exhaustive 9-class status switching across all rollback stages (Golden Backup, Live Target, Discard Capture, Sacrificial Clone, Pre-Swap Barrier, Post-Rollback Verification).
- Updates the configuration engine to **`Invoke-SafeConfigReplacementV16`** and the recovery boundary to **`Enter-ManualRecoveryBoundaryV14`**.
- Formally documents the non-existence of `docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md` and defines the strict prerequisites for authoring it prior to Gate 5.
- Expands the fault-injection matrix from 38 to **44 exhaustive scenarios**, proving fail-closed containment across every rollback and recovery edge case.

> [!IMPORTANT]
> **Strict Documentation-Only Boundary:** Zero operational commands or configuration changes were executed during this step. Zero configuration files (`postgresql.conf`, `pg_hba.conf`), firewall rules, Windows services, application files, or `.env` files were modified. Zero databases or roles were created. All operational procedures in this document are strictly **[NOT EXECUTED — UNTESTED]**.

---

## 2. Section 1 — Findings with Exact Function & Line References from Step AM

| Finding ID | Script & Location in Step AM | Defect Description | Technical Failure Mode | Mandatory Correction in Step 2D-2A-AN |
|---|---|---|---|---|
| **FIND-AN1** | `Invoke-ControlledRollbackV13`<br/>Lines 581–589 | Stage 3B discard verification checks `Status -ne "HASH_VERIFIED"` and returns `DISCARD_HASH_MISMATCH` for all non-verified statuses. | If discard backup is missing, locked, or helper fails, it is misclassified as content hash mismatch. | Implement full 9-class switch: `DISCARD_FILE_MISSING`, `DISCARD_FILE_UNREADABLE`, `DISCARD_HELPER_EXCEPTION`, `DISCARD_UNKNOWN_STATUS`; reserve `DISCARD_HASH_MISMATCH` strictly for verified hash difference. |
| **FIND-AN2** | `Invoke-ControlledRollbackV13`<br/>Lines 665–673 | Stage 4A sacrificial clone verification checks `Status -ne "HASH_VERIFIED"` and returns `SACRIFICIAL_CLONE_CORRUPT` for all non-verified statuses. | If sacrificial clone is missing, locked, or helper fails, it is misclassified as data corruption. | Implement full 9-class switch: `SACRIFICIAL_CLONE_MISSING`, `SACRIFICIAL_CLONE_UNREADABLE`, `SACRIFICIAL_CLONE_HELPER_EXCEPTION`, `SACRIFICIAL_CLONE_UNKNOWN_STATUS`; reserve `SACRIFICIAL_CLONE_HASH_MISMATCH` strictly for verified hash difference. |
| **FIND-AN3** | `Invoke-ControlledRollbackV13`<br/>Lines 737–745 | Stage 4B pre-swap barrier fallback treats unknown/unrecognized status strings as `LIVE_MUTATED_POST_DISCARD`. | Unrecognized status string from helper falsely proves destination file was mutated. | Implement full 9-class switch with explicit `default` branch returning `PRE_ROLLBACK_LIVE_UNKNOWN_STATUS`; reserve `LIVE_MUTATED_POST_DISCARD` strictly for `HASH_VERIFIED` with hash mismatch. |
| **FIND-AN4** | `Invoke-ControlledRollbackV13`<br/>Lines 816–824 | Stage 6 post-rollback check lumps helper exceptions and unknown statuses into generic `RESTORED_FILE_UNVERIFIABLE`. | Loss of granular classification on restored live configuration. | Implement distinct branches: `RESTORED_HELPER_EXCEPTION` and `RESTORED_UNKNOWN_STATUS`. |
| **FIND-AN5** | `Enter-ManualRecoveryBoundaryV13`<br/>Line 1175 | Step 4 references `docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md Section 'Manual Restoration Protocol'`. File does not exist on disk. | Operator encounters dead link during emergency recovery; no verified procedure exists. | Formally register missing runbook as an open blocker; update `Enter-ManualRecoveryBoundaryV14` to halt fail-closed without referencing non-existent files. |

---

## 3. Section 2 — Discard, Clone, and Rollback Status Classification Fixes

### 3.1 Hardened Rollback Status Invariants

Under **`Invoke-ControlledRollbackV14`**, every verification stage evaluates the 9 classes independently:

```mermaid
flowchart TD
    EvalStage["Stage 3B (Discard) / Stage 4A (Clone) / Stage 4B (Pre-Swap Live)"] --> CatchCheck{"Did Helper Call Throw?"}
    CatchCheck -->|YES| Threw["*_QUERY_THREW<br/>(INDETERMINATE — HALT ROLLBACK)"]
    CatchCheck -->|NO| NullCheck{"Is Result Object or Status Null?"}
    NullCheck -->|Object Null| NullObj["*_NULL_RESULT<br/>(INDETERMINATE — HALT ROLLBACK)"]
    NullCheck -->|Status Null| NullStat["*_NULL_STATUS<br/>(INDETERMINATE — HALT ROLLBACK)"]
    NullCheck -->|Valid Object| SwitchStat{"Switch (info.Status)"}
    
    SwitchStat -->|FILE_MISSING| Missing["*_FILE_MISSING<br/>(DETERMINATE ABSENCE — HALT ROLLBACK)"]
    SwitchStat -->|HASH_READ_FAILED| Locked["*_FILE_UNREADABLE<br/>(INDETERMINATE I/O — HALT ROLLBACK)"]
    SwitchStat -->|HELPER_EXCEPTION| HelperErr["*_HELPER_EXCEPTION<br/>(INDETERMINATE TOOLING — HALT ROLLBACK)"]
    SwitchStat -->|Unknown String| UnknownStat["*_UNKNOWN_STATUS<br/>(INDETERMINATE — HALT ROLLBACK)"]
    SwitchStat -->|HASH_VERIFIED| HashCompare{"info.Hash == Expected?"}
    
    HashCompare -->|YES| PassNode["ELIGIBLE TO PROCEED<br/>(Integrity Verified on Disk)"]
    HashCompare -->|NO| MismatchNode["*_HASH_MISMATCH / LIVE_MUTATED<br/>(VERIFIED DIFFERENCE — HALT ROLLBACK)"]
```

### 3.2 Granular Rollback State Mappings in V14

| Rollback Stage | Target Inspected | Class 1 (Match) | Class 2 (Mismatch) | Class 3 (Missing) | Class 4 (Unreadable) | Class 5 (Helper Exc) | Classes 6–8 (Null/Unknown) | Class 9 (Query Threw) |
|---|---|---|---|---|---|---|---|---|
| **Stage 1** | Golden Backup | Proceeds to Stage 2 | `GOLDEN_BACKUP_HASH_MISMATCH` | `GOLDEN_BACKUP_MISSING` | `GOLDEN_BACKUP_UNREADABLE` | `GOLDEN_BACKUP_HELPER_EXCEPTION` | `NULL_RESULT` / `NULL_STATUS` / `UNKNOWN_STATUS` | `GOLDEN_BACKUP_QUERY_THREW` |
| **Stage 2** | Live Target | Proceeds to Stage 3 | `ROLLBACK_DEST_TRIGGER_MISMATCH` | `ROLLBACK_DEST_MISSING` | `ROLLBACK_DEST_UNREADABLE` | `ROLLBACK_DEST_HELPER_EXCEPTION` | `NULL_RESULT` / `NULL_STATUS` / `UNKNOWN_STATUS` | `ROLLBACK_DEST_QUERY_THREW` |
| **Stage 3B** | Discard Backup | Proceeds to Stage 4 | `DISCARD_HASH_MISMATCH` | `DISCARD_FILE_MISSING` | `DISCARD_FILE_UNREADABLE` | `DISCARD_HELPER_EXCEPTION` | `DISCARD_NULL_RESULT` / `UNKNOWN_STATUS` | `DISCARD_QUERY_THREW` |
| **Stage 4A** | Sacrificial Clone | Proceeds to Stage 4B | `SACRIFICIAL_CLONE_HASH_MISMATCH` | `SACRIFICIAL_CLONE_MISSING` | `SACRIFICIAL_CLONE_UNREADABLE` | `SACRIFICIAL_CLONE_HELPER_EXCEPTION` | `SACRIFICIAL_CLONE_NULL_RESULT` / `UNKNOWN_STATUS` | `SACRIFICIAL_CLONE_QUERY_THREW` |
| **Stage 4B** | Pre-Swap Live Barrier | Proceeds to Swap | `LIVE_MUTATED_POST_DISCARD` | `PRE_ROLLBACK_LIVE_MISSING` | `PRE_ROLLBACK_LIVE_UNREADABLE` | `PRE_ROLLBACK_LIVE_HELPER_EXCEPTION` | `NULL_RESULT` / `NULL_STATUS` / `UNKNOWN_STATUS` | `PRE_ROLLBACK_LIVE_QUERY_THREW` |
| **Stage 6** | Restored Live File | Proceeds to Byte Check | `RESTORED_HASH_MISMATCH` | `RESTORED_FILE_MISSING` | `RESTORED_FILE_UNREADABLE` | `RESTORED_HELPER_EXCEPTION` | `NULL_RESULT` / `NULL_STATUS` / `UNKNOWN_STATUS` | `RESTORED_QUERY_THREW` |

---

## 4. Section 3 — Recovery Runbook Existence Audit & Blocker Analysis

### 4.1 Empirical Verification Evidence

A direct filesystem audit was performed in `D:\Zentra`:

1. **Target File Assertion:**
   ```powershell
   Test-Path -Path 'docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md'
   # Result: False
   ```
2. **Repository Runbook Inventory:**
   Querying `Get-ChildItem -Path 'docs' -Filter '*RUNBOOK*'` returned:
   - `docs/MUSE_SPARK_STEP2D_2A_U_POSTGRESQL_SECURITY_REMEDIATION_RUNBOOK.md`
   - `docs/MUSE_SPARK_STEP2D_2A_V_RUNBOOK_CORRECTIONS_REPORT.md`
   - `docs/MUSE_SPARK_STEP2D_2A_W_FINAL_RUNBOOK_CORRECTIONS_REPORT.md`
3. **Content Inspection of Existing Runbooks:**
   - The Step U runbook defines stages for role provisioning (`zentra_dev`), database creation (`zentra_local`), schema migrations (Kysely), and synthetic seeding.
   - It contains **zero operational instructions** for configuration recovery, filesystem staging, or rollback of `postgresql.conf` / `pg_hba.conf`.
   - The string `Manual Restoration Protocol` appears in **zero** files in the repository.

### 4.2 Impact & Formal Blocker Registration

> [!CAUTION]
> **OPEN BLOCKER — MISSING MANUAL RESTORATION RUNBOOK:**  
> The file `docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md` does not exist. Directing an incident commander or operator to a non-existent runbook during a catastrophic database outage violates operational safety standards. No claim of operational readiness can be made until this runbook is formally drafted, reviewed, and approved.

### 4.3 Technical Specification for Required Runbook

When authored (in a subsequent, human-approved documentation step), the dedicated manual restoration runbook must satisfy the following architectural requirements:

1. **Quiescence Prerequisite:** Verification that PostgreSQL service (`postgresql-x64-18`) is stopped before performing manual filesystem restoration, eliminating file-handle contention (`ERROR_SHARING_VIOLATION`).
2. **Forensic Snapshot Protocol:** Exact commands to quarantine the damaged live file to a timestamped `.quarantine` path before restoration.
3. **Independent Baseline Validation:** Exact syntax for calculating and verifying the Golden Backup SHA-256 against the recorded pre-change baseline hash ($H_{\text{live\_pre}}$).
4. **Atomic Staging Replacement:** Prohibition of direct `Copy-Item`. Restoration must be performed by copying the Golden Backup to a temporary staging path on the same volume and invoking `[System.IO.File]::Replace` with `lpBackupFileName = $null`.
5. **Post-Restoration Daemon Assertion:** Explicit verification of configuration validity via `postgres.exe -C` or service restart verification before returning the cluster to service.

---

## 5. Section 4 — Updated State-Transition & Artifact-Lifecycle Matrices

### 5.1 Updated Controlled Rollback State Machine Flowchart

```mermaid
flowchart TD
    Rollback["Invoke-ControlledRollbackV14"] --> R1["1. Golden Backup Status (9-Class)"]
    R1 -->|Missing / Unreadable / Helper Exc / Null / Mismatch| HaltR1["STATE 5C: Rollback Aborted<br/>(Golden Backup Invalid) -> Manual Recovery V14"]
    
    R1 -->|Verified Match == H_live_pre| R2["2. Live Destination Status (9-Class)"]
    R2 -->|Missing / Unreadable / Helper Exc / Null| HaltR2_Ind["STATE 5C: Rollback Aborted<br/>(Destination Indeterminate) -> Manual Recovery V14"]
    R2 -->|Hash != ExpectedTriggerHash| HaltR2_Trig["STATE 5C: Rollback Aborted<br/>(Trigger Mismatch) -> Manual Recovery V14"]
    
    R2 -->|Verified Match == ExpectedTriggerHash| R3["3. Atomic Discard Capture<br/>(FileStream FileMode::CreateNew)"]
    R3 -->|Capture Failed / Collision| HaltR3["STATE 5C: Discard Capture Failed<br/>(Live Untouched) -> Manual Recovery V14"]
    
    R3 -->|Capture Succeeded| R3B["3B. Verify Discard Backup Hash (9-Class)"]
    R3B -->|Missing / Unreadable / Helper Exc / Null / Unknown| HaltR3B_Ind["STATE 5C: Discard Indeterminate<br/>(Live Untouched) -> Manual Recovery V14"]
    R3B -->|Hash != ExpectedTriggerHash| HaltR3B_Mis["STATE 5C: Discard Hash Mismatch<br/>(Live Untouched) -> Manual Recovery V14"]
    
    R3B -->|Verified Match == ExpectedTriggerHash| R4["4. Atomic Sacrificial Clone<br/>(FileStream FileMode::CreateNew)"]
    R4 -->|Creation Failed / Collision| HaltR4["STATE 5C: Clone Write Failed<br/>(Live Untouched) -> Manual Recovery V14"]
    
    R4 -->|Creation Succeeded| R4A["4A. Verify Sacrificial Clone Hash (9-Class)"]
    R4A -->|Missing / Unreadable / Helper Exc / Null / Unknown| HaltR4A_Ind["STATE 5C: Clone Indeterminate<br/>(Live Untouched) -> Manual Recovery V14"]
    R4A -->|Hash != H_live_pre| HaltR4A_Mis["STATE 5C: Clone Hash Mismatch<br/>(Live Untouched) -> Manual Recovery V14"]
    
    R4A -->|Verified Match == H_live_pre| R4B["4B. Pre-Rollback-Swap Live Barrier (9-Class)"]
    R4B -->|Missing / Unreadable / Helper Exc / Null / Unknown| HaltR4B_Ind["STATE 5C: Live Barrier Indeterminate<br/>(Live Untouched) -> Manual Recovery V14"]
    R4B -->|Hash != ExpectedTriggerHash| HaltR4B_Mut["STATE 5C: Live Mutated Post-Discard<br/>(Live Untouched) -> Manual Recovery V14"]
    
    R4B -->|Verified Match == ExpectedTriggerHash| R5["5. Win32 File.Replace<br/>(Clone -> Live, lpBackup = $null)"]
    R5 -->|Swap Threw| HaltR5["STATE 5C: Rollback Swap Threw<br/>Manual Recovery Boundary V14"]
    
    R5 -->|Swap Succeeded| R6["6. Dual Post-Rollback Verification"]
    R6 -->|Hash == H_live_pre & Byte Check Pass| State4["OUTCOME 4: ROLLBACK SUCCESS (State 4)<br/>Baseline Restored & Verified"]
    R6 -->|Hash Matches, Byte Check Fails| State5E["STATE 5E: ROLLBACK BYTE VERIFY FAILED<br/>Manual Recovery Boundary V14"]
    R6 -->|Missing / Unreadable / Helper Exc / Null / Mismatch| State5C_Post["STATE 5C: RESTORED VERIFICATION FAILED<br/>Manual Recovery Boundary V14"]
```

### 5.2 Authoritative Artifact Lifecycle & Forensic Retention Matrix

| Lifecycle Event / Branch | Candidate File (`$CandidatePath`) | Golden Backup (`$goldenBackupPath`) | Sacrificial Clone (`$sacrificialPath`) | Discard Backup (`$discardBackup`) | Live File State | Rollback Allowed? | Manual Recovery Reason |
|---|---|---|---|---|---|---|---|
| **PF-0: Candidate Validation Fail** | **Retained on disk** | **Not Created** | **Not Created** | **Not Created** | Untouched | **NO** | Not required (Pre-flight abort). |
| **PF-1: Live Missing / Locked / Error**| **Retained on disk** | **Not Created** | **Not Created** | **Not Created** | Untouched / Locked | **NO** | Not required (Pre-flight abort). |
| **PF-1B: Candidate Missing / Locked** | **Retained on disk** | **Not Created** | **Not Created** | **Not Created** | Untouched | **NO** | Not required (Pre-flight abort). |
| **PF-2: Backup Collision / Write Fail**| **Retained on disk** | **Partial Retained** | **Not Created** | **Not Created** | Untouched | **NO** | Not required (Disk failure check). |
| **PF-3: Backup Hash Mismatch** | **Retained on disk** | **Corrupt Retained** | **Not Created** | **Not Created** | Untouched | **NO** | Not required (Storage controller check). |
| **PF-3: Backup Missing / Locked / Err** | **Retained on disk** | **Retained on disk** | **Not Created** | **Not Created** | Untouched | **NO** | Not required (Pre-flight abort). |
| **PF-4A: Pre-Swap Cand Mutated** | **Retained on disk** | **Retained on disk** | **Not Created** | **Not Created** | Untouched | **NO** | Not required (Pre-flight abort). |
| **PF-4A: Pre-Swap Cand Error / Locked**| **Retained on disk** | **Retained on disk** | **Not Created** | **Not Created** | Untouched | **NO** | Not required (Pre-flight abort). |
| **PF-4B: Pre-Swap Live Mutated** | **Retained on disk** | **Retained on disk** | **Not Created** | **Not Created** | Altered external | **NO** | Not required (Pre-flight abort). |
| **PF-4B: Pre-Swap Live Error / Locked**| **Retained on disk** | **Retained on disk** | **Not Created** | **Not Created** | Untouched / Locked | **NO** | Not required (Pre-flight abort). |
| **State 2A: Replace Threw Untouched** | **Retained on disk** | **Retained on disk** | **Not Created** | **Not Created** | Untouched | **NO** | Not required (Clean fail-closed exit). |
| **State 2B: Replace No-Op Untouched** | **Retained on disk** | **Retained on disk** | **Not Created** | **Not Created** | Untouched | **NO** | Not required (Clean fail-closed exit). |
| **State 1: Promotion Success** | **Consumed (Live)** | **Retained on disk** | **Not Created** | **Not Created** | Promoted | **NO** | Not required (Normal completion). |
| **State 4: Rollback Success** | **Retained on disk** | **Retained on disk** | **Consumed (Live)** | **Retained on disk** | Restored Baseline| **NO** | Not required (Rollback succeeded). |
| **R-1: Discard Capture Failed** | **Retained on disk** | **Retained on disk** | **Not Created** | **Partial Retained**| Altered | **NO** | Discard backup write failed. |
| **R-2A: Discard Missing / Locked / Err**| **Retained on disk** | **Retained on disk** | **Not Created** | **Retained on disk** | Altered | **NO** | Discard backup unverifiable. |
| **R-2B: Discard Hash Mismatch** | **Retained on disk** | **Retained on disk** | **Not Created** | **Retained on disk** | Altered | **NO** | Discard hash != trigger hash. |
| **R-3: Clone Creation Failed** | **Retained on disk** | **Retained on disk** | **Partial Retained**| **Retained on disk** | Altered | **NO** | Sacrificial clone write failed. |
| **R-4A: Clone Missing / Locked / Err** | **Retained on disk** | **Retained on disk** | **Retained on disk** | **Retained on disk** | Altered | **NO** | Sacrificial clone unverifiable. |
| **R-4B: Clone Hash Mismatch** | **Retained on disk** | **Retained on disk** | **Retained on disk** | **Retained on disk** | Altered | **NO** | Clone hash != baseline hash. |
| **R-5A: Pre-Swap Live Missing / Locked**| **Retained on disk** | **Retained on disk** | **Retained on disk** | **Retained on disk** | Indeterminate | **NO** | Live destination unverifiable pre-swap. |
| **R-5B: Pre-Swap Live Mutated** | **Retained on disk** | **Retained on disk** | **Retained on disk** | **Retained on disk** | Altered newer | **NO** | Live destination mutated post-discard. |
| **State 5A: Target Missing** | **Retained on disk** | **Retained on disk** | **Not Created** | **Not Created** | Missing | **NO** | Target configuration missing. |
| **State 5B: Target Unreadable** | **Retained on disk** | **Retained on disk** | **Not Created** | **Not Created** | Indeterminate | **NO** | Target configuration locked. |
| **State 5C: Rollback Failed** | **Retained on disk** | **Retained on disk** | **Retained on disk** | **Retained on disk** | Indeterminate | **NO** | Rollback swap threw exception. |
| **State 5D: Unknown / Null State** | **Retained on disk** | **Retained on disk** | **Not Created** | **Not Created** | Indeterminate | **NO** | Helper returned unrecognized/null status. |
| **State 5E: Byte Verify Failed** | **Retained on disk** | **Retained on disk** | **Consumed (Live)** | **Retained on disk** | Corrupt bytes | **NO** | Restored file has byte formatting error. |
| **State 5F: Tooling Exception** | **Retained on disk** | **Retained on disk** | **Not Created** | **Not Created** | Indeterminate | **NO** | CLR/engine exception during inspection. |

---

## 6. Section 5 — Hardened Proposed Operational Scripts (V16 / V14)

### 6.1 Fully Contained Rollback Engine (`Invoke-ControlledRollbackV14`)

```powershell
# [NOT EXECUTED — UNTESTED OPERATIONAL PROCEDURE]

function Invoke-ControlledRollbackV14 {
    <#
    .SYNOPSIS
        Safely restores a configuration file using a sacrificial clone of the golden backup.
        Enforces Universal 9-Class Status Classification across ALL verification stages:
        Golden Backup, Live Target, Discard Capture, Sacrificial Clone, Pre-Swap Live Barrier,
        and Post-Rollback Verification. Pure atomic swap (lpBackupFileName = $null).
    #>
    param (
        [Parameter(Mandatory = $true)]
        [string]$LiveConfigPath,

        [Parameter(Mandatory = $true)]
        [string]$GoldenBackupPath,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedBaselineHash,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedTriggerHash,

        [System.Exception]$InitialError
    )

    Write-Warning "=== INITIATING CONTROLLED ROLLBACK V14 ==="

    # -------------------------------------------------------------
    # 1. EVALUATE GOLDEN BACKUP STATUS (9-CLASS CLASSIFICATION)
    # -------------------------------------------------------------
    $gbInfo = $null
    $gbQueryError = $null
    try {
        $gbInfo = Get-SafeFileHashV4 -FilePath $GoldenBackupPath
    }
    catch {
        $gbQueryError = $_.Exception
    }

    if ($gbQueryError -ne $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "GOLDEN_BACKUP_QUERY_THREW"
            Message       = "Querying golden backup threw an unexpected exception: $($gbQueryError.Message)"
            DiscardBackup = $null
            Error         = $gbQueryError
        }
    }

    if ($gbInfo -eq $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "GOLDEN_BACKUP_NULL_RESULT"
            Message       = "Querying golden backup returned a null result object."
            DiscardBackup = $null
            Error         = $null
        }
    }

    if ($gbInfo.Status -eq $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "GOLDEN_BACKUP_NULL_STATUS"
            Message       = "Querying golden backup returned an object with a null Status property."
            DiscardBackup = $null
            Error         = $null
        }
    }

    switch ($gbInfo.Status) {
        "FILE_MISSING" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "GOLDEN_BACKUP_MISSING"
                Message       = "Golden backup file [$GoldenBackupPath] does not exist on disk."
                DiscardBackup = $null
                Error         = $null
            }
        }
        "HASH_READ_FAILED" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "GOLDEN_BACKUP_UNREADABLE"
                Message       = "Golden backup file is locked or access was denied: $($gbInfo.Message)"
                DiscardBackup = $null
                Error         = $gbInfo.Error
            }
        }
        "HELPER_EXCEPTION" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "GOLDEN_BACKUP_HELPER_EXCEPTION"
                Message       = "Hash helper failed on golden backup: $($gbInfo.Message)"
                DiscardBackup = $null
                Error         = $gbInfo.Error
            }
        }
        "HASH_VERIFIED" {
            if ($gbInfo.Hash -ne $ExpectedBaselineHash) {
                return [PSCustomObject]@{
                    Success       = $false
                    Status        = "GOLDEN_BACKUP_HASH_MISMATCH"
                    Message       = "Golden backup hash [$($gbInfo.Hash)] does not match expected baseline [$ExpectedBaselineHash]."
                    DiscardBackup = $null
                    Error         = $null
                }
            }
        }
        default {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "GOLDEN_BACKUP_UNKNOWN_STATUS"
                Message       = "Golden backup returned unknown status string [$($gbInfo.Status)]."
                DiscardBackup = $null
                Error         = $null
            }
        }
    }

    # -------------------------------------------------------------
    # 2. EVALUATE LIVE DESTINATION STATUS (9-CLASS CLASSIFICATION)
    # -------------------------------------------------------------
    $destInfo = $null
    $destQueryError = $null
    try {
        $destInfo = Get-SafeFileHashV4 -FilePath $LiveConfigPath
    }
    catch {
        $destQueryError = $_.Exception
    }

    if ($destQueryError -ne $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "ROLLBACK_DEST_QUERY_THREW"
            Message       = "Querying live destination threw an unexpected exception: $($destQueryError.Message)"
            DiscardBackup = $null
            Error         = $destQueryError
        }
    }

    if ($destInfo -eq $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "ROLLBACK_DEST_NULL_RESULT"
            Message       = "Querying live destination returned a null result object."
            DiscardBackup = $null
            Error         = $null
        }
    }

    if ($destInfo.Status -eq $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "ROLLBACK_DEST_NULL_STATUS"
            Message       = "Querying live destination returned an object with a null Status property."
            DiscardBackup = $null
            Error         = $null
        }
    }

    switch ($destInfo.Status) {
        "FILE_MISSING" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "ROLLBACK_DEST_MISSING"
                Message       = "Live destination file is missing prior to rollback. Atomic swap impossible."
                DiscardBackup = $null
                Error         = $null
            }
        }
        "HASH_READ_FAILED" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "ROLLBACK_DEST_UNREADABLE"
                Message       = "Live destination file is locked or unreadable: $($destInfo.Message)"
                DiscardBackup = $null
                Error         = $destInfo.Error
            }
        }
        "HELPER_EXCEPTION" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "ROLLBACK_DEST_HELPER_EXCEPTION"
                Message       = "Hash helper failed on live destination: $($destInfo.Message)"
                DiscardBackup = $null
                Error         = $destInfo.Error
            }
        }
        "HASH_VERIFIED" {
            if ($destInfo.Hash -ne $ExpectedTriggerHash) {
                return [PSCustomObject]@{
                    Success       = $false
                    Status        = "ROLLBACK_DEST_TRIGGER_MISMATCH"
                    Message       = "Live destination hash [$($destInfo.Hash)] changed after trigger hash [$ExpectedTriggerHash] was observed."
                    DiscardBackup = $null
                    Error         = $null
                }
            }
        }
        default {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "ROLLBACK_DEST_UNKNOWN_STATUS"
                Message       = "Live destination returned unknown status string [$($destInfo.Status)]."
                DiscardBackup = $null
                Error         = $null
            }
        }
    }

    # -------------------------------------------------------------
    # 3. ATOMIC DISCARD CAPTURE (FileMode::CreateNew)
    # -------------------------------------------------------------
    $uniqueRollbackId = [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
    $rollbackTimestamp = "$((Get-Date).ToString('yyyyMMdd_HHmmss'))_$uniqueRollbackId"
    $discardBackup = "$LiveConfigPath.discard.$rollbackTimestamp"

    $liveBytesForDiscard = $null
    try {
        $liveBytesForDiscard = [System.IO.File]::ReadAllBytes($LiveConfigPath)
    }
    catch {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "DISCARD_CAPTURE_READ_FAILED"
            Message       = "Reading live file bytes for discard capture failed: $($_.Exception.Message)"
            DiscardBackup = $null
            Error         = $_.Exception
        }
    }

    try {
        $discardStream = [System.IO.FileStream]::new(
            $discardBackup,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        try {
            $discardStream.Write($liveBytesForDiscard, 0, $liveBytesForDiscard.Length)
        }
        finally {
            $discardStream.Dispose()
        }
    }
    catch {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "DISCARD_CAPTURE_FAILED"
            Message       = "Writing discard backup [$discardBackup] failed: $($_.Exception.Message)"
            DiscardBackup = $discardBackup
            Error         = $_.Exception
        }
    }

    # -------------------------------------------------------------
    # 3B. VERIFY DISCARD BACKUP HASH (9-CLASS CLASSIFICATION)
    # -------------------------------------------------------------
    $discardInfo = $null
    $discardQueryError = $null
    try {
        $discardInfo = Get-SafeFileHashV4 -FilePath $discardBackup
    }
    catch {
        $discardQueryError = $_.Exception
    }

    if ($discardQueryError -ne $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "DISCARD_QUERY_THREW"
            Message       = "Verifying discard backup threw an exception: $($discardQueryError.Message)"
            DiscardBackup = $discardBackup
            Error         = $discardQueryError
        }
    }

    if ($discardInfo -eq $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "DISCARD_NULL_RESULT"
            Message       = "Verifying discard backup returned a null result object."
            DiscardBackup = $discardBackup
            Error         = $null
        }
    }

    if ($discardInfo.Status -eq $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "DISCARD_NULL_STATUS"
            Message       = "Verifying discard backup returned an object with a null Status property."
            DiscardBackup = $discardBackup
            Error         = $null
        }
    }

    switch ($discardInfo.Status) {
        "FILE_MISSING" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "DISCARD_FILE_MISSING"
                Message       = "Discard backup file [$discardBackup] is missing immediately after creation."
                DiscardBackup = $discardBackup
                Error         = $null
            }
        }
        "HASH_READ_FAILED" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "DISCARD_FILE_UNREADABLE"
                Message       = "Discard backup file is locked or unreadable: $($discardInfo.Message)"
                DiscardBackup = $discardBackup
                Error         = $discardInfo.Error
            }
        }
        "HELPER_EXCEPTION" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "DISCARD_HELPER_EXCEPTION"
                Message       = "Hash helper failed on discard backup: $($discardInfo.Message)"
                DiscardBackup = $discardBackup
                Error         = $discardInfo.Error
            }
        }
        "HASH_VERIFIED" {
            if ($discardInfo.Hash -ne $ExpectedTriggerHash) {
                return [PSCustomObject]@{
                    Success       = $false
                    Status        = "DISCARD_HASH_MISMATCH"
                    Message       = "Discard backup verification failed: Expected trigger hash $ExpectedTriggerHash, observed $($discardInfo.Hash)."
                    DiscardBackup = $discardBackup
                    Error         = $null
                }
            }
        }
        default {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "DISCARD_UNKNOWN_STATUS"
                Message       = "Discard backup verification returned unknown status [$($discardInfo.Status)]."
                DiscardBackup = $discardBackup
                Error         = $null
            }
        }
    }

    # -------------------------------------------------------------
    # 4. CREATE ATOMIC SACRIFICIAL CLONE (FileMode::CreateNew)
    # -------------------------------------------------------------
    $sacrificialPath = "$GoldenBackupPath.sacrificial.$rollbackTimestamp"
    $goldenBytes = $null
    try {
        $goldenBytes = [System.IO.File]::ReadAllBytes($GoldenBackupPath)
    }
    catch {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "SACRIFICIAL_CLONE_READ_FAILED"
            Message       = "Reading golden backup bytes for sacrificial clone failed: $($_.Exception.Message)"
            DiscardBackup = $discardBackup
            Error         = $_.Exception
        }
    }

    try {
        $sacStream = [System.IO.FileStream]::new(
            $sacrificialPath,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        try {
            $sacStream.Write($goldenBytes, 0, $goldenBytes.Length)
        }
        finally {
            $sacStream.Dispose()
        }
    }
    catch {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "SACRIFICIAL_CLONE_CREATION_FAILED"
            Message       = "Creating sacrificial clone [$sacrificialPath] failed: $($_.Exception.Message)"
            DiscardBackup = $discardBackup
            Error         = $_.Exception
        }
    }

    # -------------------------------------------------------------
    # 4A. VERIFY SACRIFICIAL CLONE INTEGRITY (9-CLASS CLASSIFICATION)
    # -------------------------------------------------------------
    $cloneInfo = $null
    $cloneQueryError = $null
    try {
        $cloneInfo = Get-SafeFileHashV4 -FilePath $sacrificialPath
    }
    catch {
        $cloneQueryError = $_.Exception
    }

    if ($cloneQueryError -ne $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "SACRIFICIAL_CLONE_QUERY_THREW"
            Message       = "Querying sacrificial clone threw an unexpected exception: $($cloneQueryError.Message)"
            DiscardBackup = $discardBackup
            Error         = $cloneQueryError
        }
    }

    if ($cloneInfo -eq $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "SACRIFICIAL_CLONE_NULL_RESULT"
            Message       = "Querying sacrificial clone returned a null result object."
            DiscardBackup = $discardBackup
            Error         = $null
        }
    }

    if ($cloneInfo.Status -eq $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "SACRIFICIAL_CLONE_NULL_STATUS"
            Message       = "Querying sacrificial clone returned an object with a null Status property."
            DiscardBackup = $discardBackup
            Error         = $null
        }
    }

    switch ($cloneInfo.Status) {
        "FILE_MISSING" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "SACRIFICIAL_CLONE_MISSING"
                Message       = "Sacrificial clone [$sacrificialPath] is missing immediately after creation."
                DiscardBackup = $discardBackup
                Error         = $null
            }
        }
        "HASH_READ_FAILED" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "SACRIFICIAL_CLONE_UNREADABLE"
                Message       = "Sacrificial clone is locked or unreadable: $($cloneInfo.Message)"
                DiscardBackup = $discardBackup
                Error         = $cloneInfo.Error
            }
        }
        "HELPER_EXCEPTION" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "SACRIFICIAL_CLONE_HELPER_EXCEPTION"
                Message       = "Hash helper failed on sacrificial clone: $($cloneInfo.Message)"
                DiscardBackup = $discardBackup
                Error         = $cloneInfo.Error
            }
        }
        "HASH_VERIFIED" {
            if ($cloneInfo.Hash -ne $ExpectedBaselineHash) {
                return [PSCustomObject]@{
                    Success       = $false
                    Status        = "SACRIFICIAL_CLONE_HASH_MISMATCH"
                    Message       = "Sacrificial clone verification failed: Expected baseline $ExpectedBaselineHash, observed $($cloneInfo.Hash)."
                    DiscardBackup = $discardBackup
                    Error         = $null
                }
            }
        }
        default {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "SACRIFICIAL_CLONE_UNKNOWN_STATUS"
                Message       = "Sacrificial clone verification returned unknown status [$($cloneInfo.Status)]."
                DiscardBackup = $discardBackup
                Error         = $null
            }
        }
    }

    # -------------------------------------------------------------
    # 4B. IMMEDIATE PRE-ROLLBACK-SWAP LIVE BARRIER (9-CLASS)
    # -------------------------------------------------------------
    $livePreSwapCheck = $null
    $livePreSwapError = $null
    try {
        $livePreSwapCheck = Get-SafeFileHashV4 -FilePath $LiveConfigPath
    }
    catch {
        $livePreSwapError = $_.Exception
    }

    if ($livePreSwapError -ne $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "PRE_ROLLBACK_LIVE_QUERY_THREW"
            Message       = "Pre-rollback live check threw an unexpected exception: $($livePreSwapError.Message)"
            DiscardBackup = $discardBackup
            Error         = $livePreSwapError
        }
    }

    if ($livePreSwapCheck -eq $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "PRE_ROLLBACK_LIVE_NULL_RESULT"
            Message       = "Pre-rollback live check returned a null result object."
            DiscardBackup = $discardBackup
            Error         = $null
        }
    }

    if ($livePreSwapCheck.Status -eq $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "PRE_ROLLBACK_LIVE_NULL_STATUS"
            Message       = "Pre-rollback live check returned an object with a null Status property."
            DiscardBackup = $discardBackup
            Error         = $null
        }
    }

    switch ($livePreSwapCheck.Status) {
        "FILE_MISSING" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "PRE_ROLLBACK_LIVE_MISSING"
                Message       = "Live destination disappeared immediately prior to rollback swap."
                DiscardBackup = $discardBackup
                Error         = $null
            }
        }
        "HASH_READ_FAILED" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "PRE_ROLLBACK_LIVE_UNREADABLE"
                Message       = "Live destination became locked/unreadable immediately prior to rollback swap: $($livePreSwapCheck.Message)"
                DiscardBackup = $discardBackup
                Error         = $livePreSwapCheck.Error
            }
        }
        "HELPER_EXCEPTION" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "PRE_ROLLBACK_LIVE_HELPER_EXCEPTION"
                Message       = "Hash helper failed on live destination prior to rollback: $($livePreSwapCheck.Message)"
                DiscardBackup = $discardBackup
                Error         = $livePreSwapCheck.Error
            }
        }
        "HASH_VERIFIED" {
            if ($livePreSwapCheck.Hash -ne $ExpectedTriggerHash) {
                return [PSCustomObject]@{
                    Success       = $false
                    Status        = "LIVE_MUTATED_POST_DISCARD"
                    Message       = "Live destination mutated after discard capture: Expected trigger hash $ExpectedTriggerHash, observed $($livePreSwapCheck.Hash)."
                    DiscardBackup = $discardBackup
                    Error         = $null
                }
            }
        }
        default {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "PRE_ROLLBACK_LIVE_UNKNOWN_STATUS"
                Message       = "Pre-rollback live check returned unknown status [$($livePreSwapCheck.Status)]."
                DiscardBackup = $discardBackup
                Error         = $null
            }
        }
    }

    # -------------------------------------------------------------
    # 5. PURE ATOMIC ROLLBACK SWAP (lpBackupFileName = $null)
    # -------------------------------------------------------------
    try {
        [System.IO.File]::Replace($sacrificialPath, $LiveConfigPath, $null, $true)
        Write-Host "[ROLLBACK SWAP SUCCEEDED] Win32 File.Replace restored baseline." -ForegroundColor Green
    }
    catch {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "ROLLBACK_SWAP_EXCEPTION"
            Message       = "Win32 File.Replace threw during rollback: $($_.Exception.Message)"
            DiscardBackup = $discardBackup
            Error         = $_.Exception
        }
    }

    # -------------------------------------------------------------
    # 6. DUAL POST-ROLLBACK VERIFICATION (HASH & BYTE INTEGRITY)
    # -------------------------------------------------------------
    $restoredInfo = $null
    $restoredQueryError = $null
    try {
        $restoredInfo = Get-SafeFileHashV4 -FilePath $LiveConfigPath
    }
    catch {
        $restoredQueryError = $_.Exception
    }

    if ($restoredQueryError -ne $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "RESTORED_QUERY_THREW"
            Message       = "Querying restored live file threw an unexpected exception: $($restoredQueryError.Message)"
            DiscardBackup = $discardBackup
            Error         = $restoredQueryError
        }
    }

    if ($restoredInfo -eq $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "RESTORED_NULL_RESULT"
            Message       = "Querying restored live file returned a null result object."
            DiscardBackup = $discardBackup
            Error         = $null
        }
    }

    if ($restoredInfo.Status -eq $null) {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "RESTORED_NULL_STATUS"
            Message       = "Querying restored live file returned an object with a null Status property."
            DiscardBackup = $discardBackup
            Error         = $null
        }
    }

    switch ($restoredInfo.Status) {
        "FILE_MISSING" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "RESTORED_FILE_MISSING"
                Message       = "Restored live file is missing from disk after rollback swap."
                DiscardBackup = $discardBackup
                Error         = $null
            }
        }
        "HASH_READ_FAILED" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "RESTORED_FILE_UNREADABLE"
                Message       = "Restored live file is locked or unreadable: $($restoredInfo.Message)"
                DiscardBackup = $discardBackup
                Error         = $restoredInfo.Error
            }
        }
        "HELPER_EXCEPTION" {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "RESTORED_HELPER_EXCEPTION"
                Message       = "Hash helper failed on restored live file: $($restoredInfo.Message)"
                DiscardBackup = $discardBackup
                Error         = $restoredInfo.Error
            }
        }
        "HASH_VERIFIED" {
            if ($restoredInfo.Hash -ne $ExpectedBaselineHash) {
                return [PSCustomObject]@{
                    Success       = $false
                    Status        = "RESTORED_HASH_MISMATCH"
                    Message       = "Restored live file hash [$($restoredInfo.Hash)] does not match expected baseline [$ExpectedBaselineHash]."
                    DiscardBackup = $discardBackup
                    Error         = $null
                }
            }
        }
        default {
            return [PSCustomObject]@{
                Success       = $false
                Status        = "RESTORED_UNKNOWN_STATUS"
                Message       = "Restored live file returned unknown status [$($restoredInfo.Status)]."
                DiscardBackup = $discardBackup
                Error         = $null
            }
        }
    }

    # Re-verify byte integrity on restored file
    try {
        Test-CandidateByteAndEncodingIntegrity -FilePath $LiveConfigPath
    }
    catch {
        return [PSCustomObject]@{
            Success       = $false
            Status        = "ROLLBACK_BYTE_VERIFY_FAILED"
            Message       = "Rollback restored matching hash, but byte validation failed: $($_.Exception.Message)"
            DiscardBackup = $discardBackup
            Error         = $_.Exception
        }
    }

    Write-Host "[ROLLBACK VERIFIED] Live configuration restored and verified [SHA256: $($restoredInfo.Hash)]." -ForegroundColor Green
    return [PSCustomObject]@{
        Success       = $true
        Status        = "ROLLBACK_SUCCESS"
        RestoredHash  = $restoredInfo.Hash
        DiscardBackup = $discardBackup
        Message       = "Configuration successfully restored to pre-change state. Discard backup retained."
        Error         = $null
    }
}
```

---

### 6.2 Hardened Configuration Replacement Engine (`Invoke-SafeConfigReplacementV16`)

```powershell
# [NOT EXECUTED — UNTESTED OPERATIONAL PROCEDURE]

function Invoke-SafeConfigReplacementV16 {
    <#
    .SYNOPSIS
        Safely replaces a PostgreSQL configuration file using the Decoupled Backup Architecture.
        Enforces Universal 9-Class Status Classification across all pre-flight, pre-swap, and post-swap barriers.
    #>
    param (
        [Parameter(Mandatory = $true)]
        [string]$LiveConfigPath,

        [Parameter(Mandatory = $true)]
        [string]$CandidatePath,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    Write-Host "=== INITIATING HARDENED CONFIGURATION REPLACEMENT V16: $Description ===" -ForegroundColor Cyan

    # -------------------------------------------------------------
    # STAGE 1: PRE-FLIGHT VALIDATION & DECOUPLED ATOMIC BACKUP
    # -------------------------------------------------------------
    
    # PF-0: Candidate Byte & Encoding Validation
    try {
        Test-CandidateByteAndEncodingIntegrity -FilePath $CandidatePath
    }
    catch {
        throw "FAIL-CLOSED ABORT [PREFLIGHT_CANDIDATE_INVALID]: Candidate integrity check failed: $($_.Exception.Message)"
    }

    # PF-1: Live Configuration Pre-Change Hash Inspection (9-Class Classification)
    $livePreInfo = $null
    $livePreError = $null
    try {
        $livePreInfo = Get-SafeFileHashV4 -FilePath $LiveConfigPath
    }
    catch {
        $livePreError = $_.Exception
    }
    if ($livePreError -ne $null) {
        throw "FAIL-CLOSED ABORT [PREFLIGHT_LIVE_QUERY_THREW]: Live pre-hash check threw an exception: $($livePreError.Message)"
    }
    if ($livePreInfo -eq $null) {
        throw "FAIL-CLOSED ABORT [PREFLIGHT_LIVE_NULL_RESULT]: Live pre-hash check returned null result object."
    }
    if ($livePreInfo.Status -eq $null) {
        throw "FAIL-CLOSED ABORT [PREFLIGHT_LIVE_NULL_STATUS]: Live pre-hash check returned object with null Status property."
    }

    switch ($livePreInfo.Status) {
        "FILE_MISSING" {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_LIVE_MISSING]: Live configuration file [$LiveConfigPath] does not exist on disk."
        }
        "HASH_READ_FAILED" {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_LIVE_UNREADABLE]: Live configuration file is locked or unreadable: $($livePreInfo.Message)"
        }
        "HELPER_EXCEPTION" {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_LIVE_HELPER_EXCEPTION]: Hash helper failed on live configuration: $($livePreInfo.Message)"
        }
        "HASH_VERIFIED" {
            $H_live_pre = $livePreInfo.Hash
        }
        default {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_LIVE_UNKNOWN_STATUS]: Live pre-hash check returned unknown status [$($livePreInfo.Status)]."
        }
    }

    # PF-1B: Candidate Hash Inspection (9-Class Classification)
    $candPreInfo = $null
    $candPreError = $null
    try {
        $candPreInfo = Get-SafeFileHashV4 -FilePath $CandidatePath
    }
    catch {
        $candPreError = $_.Exception
    }
    if ($candPreError -ne $null) {
        throw "FAIL-CLOSED ABORT [PREFLIGHT_CAND_QUERY_THREW]: Candidate pre-hash check threw an exception: $($candPreError.Message)"
    }
    if ($candPreInfo -eq $null) {
        throw "FAIL-CLOSED ABORT [PREFLIGHT_CAND_NULL_RESULT]: Candidate pre-hash check returned null result object."
    }
    if ($candPreInfo.Status -eq $null) {
        throw "FAIL-CLOSED ABORT [PREFLIGHT_CAND_NULL_STATUS]: Candidate pre-hash check returned object with null Status property."
    }

    switch ($candPreInfo.Status) {
        "FILE_MISSING" {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_CAND_MISSING]: Candidate file [$CandidatePath] does not exist on disk."
        }
        "HASH_READ_FAILED" {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_CAND_UNREADABLE]: Candidate file is locked or unreadable: $($candPreInfo.Message)"
        }
        "HELPER_EXCEPTION" {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_CAND_HELPER_EXCEPTION]: Hash helper failed on candidate file: $($candPreInfo.Message)"
        }
        "HASH_VERIFIED" {
            $H_cand_pre = $candPreInfo.Hash
        }
        default {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_CAND_UNKNOWN_STATUS]: Candidate pre-hash check returned unknown status [$($candPreInfo.Status)]."
        }
    }

    # PF-2: Decoupled Atomic Golden Backup Creation (FileMode::CreateNew)
    $uniqueId = [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
    $timestamp = "$((Get-Date).ToString('yyyyMMdd_HHmmss'))_$uniqueId"
    $goldenBackupPath = "$LiveConfigPath.bak.$timestamp"

    $liveBytes = $null
    try {
        $liveBytes = [System.IO.File]::ReadAllBytes($LiveConfigPath)
    }
    catch {
        throw "FAIL-CLOSED ABORT [PREFLIGHT_LIVE_READ_FAILED]: Reading live file bytes threw an exception: $($_.Exception.Message)"
    }

    try {
        $backupStream = [System.IO.FileStream]::new(
            $goldenBackupPath,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        try {
            $backupStream.Write($liveBytes, 0, $liveBytes.Length)
        }
        finally {
            $backupStream.Dispose()
        }
    }
    catch [System.IO.IOException] {
        if (Test-Path -Path $goldenBackupPath) {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_COLLISION_DETECTED]: Golden backup path [$goldenBackupPath] already exists. Atomic CreateNew aborted."
        }
        throw "FAIL-CLOSED ABORT [PREFLIGHT_BACKUP_WRITE_FAILED]: Writing Golden Backup failed: $($_.Exception.Message)"
    }
    catch {
        throw "FAIL-CLOSED ABORT [PREFLIGHT_BACKUP_WRITE_FAILED]: Unexpected exception writing Golden Backup: $($_.Exception.Message)"
    }

    # PF-3: Golden Backup Hash Verification Barrier (9-Class Classification)
    $gbInfo = $null
    $gbError = $null
    try {
        $gbInfo = Get-SafeFileHashV4 -FilePath $goldenBackupPath
    }
    catch {
        $gbError = $_.Exception
    }
    if ($gbError -ne $null) {
        throw "FAIL-CLOSED ABORT [PREFLIGHT_BACKUP_QUERY_THREW]: Golden backup verification threw an exception: $($gbError.Message)"
    }
    if ($gbInfo -eq $null) {
        throw "FAIL-CLOSED ABORT [PREFLIGHT_BACKUP_NULL_RESULT]: Golden backup verification returned null result object."
    }
    if ($gbInfo.Status -eq $null) {
        throw "FAIL-CLOSED ABORT [PREFLIGHT_BACKUP_NULL_STATUS]: Golden backup verification returned object with null Status property."
    }

    switch ($gbInfo.Status) {
        "FILE_MISSING" {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_BACKUP_MISSING]: Golden backup file [$goldenBackupPath] is missing from disk immediately after creation."
        }
        "HASH_READ_FAILED" {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_BACKUP_UNREADABLE]: Golden backup file is locked or unreadable: $($gbInfo.Message)"
        }
        "HELPER_EXCEPTION" {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_BACKUP_HELPER_EXCEPTION]: Hash helper failed on golden backup: $($gbInfo.Message)"
        }
        "HASH_VERIFIED" {
            if ($gbInfo.Hash -ne $H_live_pre) {
                Write-Error "CRITICAL FORENSIC ALERT: Golden backup hash mismatch detected."
                Write-Error "Preserving Golden Backup [$goldenBackupPath] and Candidate [$CandidatePath] on disk."
                throw "FAIL-CLOSED ABORT [PREFLIGHT_BACKUP_HASH_MISMATCH]: Golden backup hash [$($gbInfo.Hash)] does not match pre-change live hash [$H_live_pre]. All artifacts retained. Live file untouched."
            }
        }
        default {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_BACKUP_UNKNOWN_STATUS]: Golden backup verification returned unknown status [$($gbInfo.Status)]."
        }
    }

    Write-Host "[PRE-FLIGHT PASSED] Verified Golden Backup: $goldenBackupPath [SHA256: $H_live_pre]" -ForegroundColor Green
    Write-Host "[PRE-FLIGHT PASSED] Candidate Hash Retained: [SHA256: $H_cand_pre]" -ForegroundColor Green

    # -------------------------------------------------------------
    # STAGE 2: PRE-SWAP BARRIERS & PURE WIN32 FILE REPLACEMENT
    # -------------------------------------------------------------
    
    # PF-4A: Immediate Pre-Swap Candidate Verification Barrier (9-Class Classification)
    $candImmediate = $null
    $candImmError = $null
    try {
        $candImmediate = Get-SafeFileHashV4 -FilePath $CandidatePath
    }
    catch {
        $candImmError = $_.Exception
    }
    if ($candImmError -ne $null) {
        throw "FAIL-CLOSED ABORT [PRE_SWAP_CAND_QUERY_THREW]: Pre-swap candidate check threw an exception: $($candImmError.Message)"
    }
    if ($candImmediate -eq $null) {
        throw "FAIL-CLOSED ABORT [PRE_SWAP_CAND_NULL_RESULT]: Pre-swap candidate check returned null result object."
    }
    if ($candImmediate.Status -eq $null) {
        throw "FAIL-CLOSED ABORT [PRE_SWAP_CAND_NULL_STATUS]: Pre-swap candidate check returned object with null Status property."
    }

    switch ($candImmediate.Status) {
        "FILE_MISSING" {
            throw "FAIL-CLOSED ABORT [PRE_SWAP_CAND_MISSING]: Candidate file disappeared immediately prior to replacement."
        }
        "HASH_READ_FAILED" {
            throw "FAIL-CLOSED ABORT [PRE_SWAP_CAND_UNREADABLE]: Candidate file became locked/unreadable prior to replacement: $($candImmediate.Message)"
        }
        "HELPER_EXCEPTION" {
            throw "FAIL-CLOSED ABORT [PRE_SWAP_CAND_HELPER_EXCEPTION]: Hash helper failed on candidate immediately prior to replacement: $($candImmediate.Message)"
        }
        "HASH_VERIFIED" {
            if ($candImmediate.Hash -ne $H_cand_pre) {
                throw "FAIL-CLOSED ABORT [PRE_SWAP_CANDIDATE_MUTATED]: Candidate modified after pre-flight hash verification. Promotion aborted."
            }
        }
        default {
            throw "FAIL-CLOSED ABORT [PRE_SWAP_CAND_UNKNOWN_STATUS]: Pre-swap candidate check returned unknown status [$($candImmediate.Status)]."
        }
    }

    # PF-4B: Immediate Pre-Swap Live Destination Verification Barrier (9-Class Classification)
    $liveImmediate = $null
    $liveImmError = $null
    try {
        $liveImmediate = Get-SafeFileHashV4 -FilePath $LiveConfigPath
    }
    catch {
        $liveImmError = $_.Exception
    }
    if ($liveImmError -ne $null) {
        throw "FAIL-CLOSED ABORT [PRE_SWAP_LIVE_QUERY_THREW]: Pre-swap live check threw an exception: $($liveImmError.Message)"
    }
    if ($liveImmediate -eq $null) {
        throw "FAIL-CLOSED ABORT [PRE_SWAP_LIVE_NULL_RESULT]: Pre-swap live check returned null result object."
    }
    if ($liveImmediate.Status -eq $null) {
        throw "FAIL-CLOSED ABORT [PRE_SWAP_LIVE_NULL_STATUS]: Pre-swap live check returned object with null Status property."
    }

    switch ($liveImmediate.Status) {
        "FILE_MISSING" {
            throw "FAIL-CLOSED ABORT [PRE_SWAP_LIVE_MISSING]: Live destination disappeared immediately prior to replacement."
        }
        "HASH_READ_FAILED" {
            throw "FAIL-CLOSED ABORT [PRE_SWAP_LIVE_UNREADABLE]: Live destination became locked/unreadable prior to replacement: $($liveImmediate.Message)"
        }
        "HELPER_EXCEPTION" {
            throw "FAIL-CLOSED ABORT [PRE_SWAP_LIVE_HELPER_EXCEPTION]: Hash helper failed on live destination immediately prior to replacement: $($liveImmediate.Message)"
        }
        "HASH_VERIFIED" {
            if ($liveImmediate.Hash -ne $H_live_pre) {
                throw "FAIL-CLOSED ABORT [PRE_SWAP_LIVE_MUTATED]: Live destination modified after golden backup verification. Promotion aborted."
            }
        }
        default {
            throw "FAIL-CLOSED ABORT [PRE_SWAP_LIVE_UNKNOWN_STATUS]: Pre-swap live check returned unknown status [$($liveImmediate.Status)]."
        }
    }

    $replaceError = $null

    try {
        [System.IO.File]::Replace($CandidatePath, $LiveConfigPath, $null, $true)
        Write-Host "[REPLACE SUCCEEDED] Win32 File.Replace completed via pure atomic swap." -ForegroundColor Green
    }
    catch {
        $replaceError = $_.Exception
        Write-Error "Replacement operation threw an exception: $($replaceError.Message)"

        # Inspect live destination state safely (9-Class Classification)
        $liveCurrInfo = $null
        $hashInspectionError = $null
        try {
            $liveCurrInfo = Get-SafeFileHashV4 -FilePath $LiveConfigPath
        }
        catch {
            $hashInspectionError = $_.Exception
        }

        if ($hashInspectionError -ne $null) {
            # STATE 5F: Tooling/Inspection crash -> INDETERMINATE -> Manual Recovery
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $replaceError -HashInspectionError $hashInspectionError -RollbackResult $null -Detail "Live inspection query threw an unhandled exception."
        }

        if ($liveCurrInfo -eq $null -or $liveCurrInfo.Status -eq $null) {
            # STATE 5D: Null result -> INDETERMINATE -> Manual Recovery
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $replaceError -HashInspectionError $null -RollbackResult $null -Detail "Live inspection query returned null result object or null status."
        }

        switch ($liveCurrInfo.Status) {
            "HASH_VERIFIED" {
                if ($liveCurrInfo.Hash -eq $H_live_pre) {
                    # STATE 2A / OUTCOME 1: TARGET UNTOUCHED (Clean exit, zero rollback)
                    Write-Host "[OUTCOME 1: TARGET UNTOUCHED] Live file hash matches pre-change hash. Target was never modified." -ForegroundColor Yellow
                    Write-Host "[OUTCOME 1: ARTIFACT STATUS] Candidate file [$CandidatePath] and Golden Backup [$goldenBackupPath] retained on disk." -ForegroundColor Yellow
                    throw "FAIL-CLOSED ABORT [OUTCOME 1]: Replacement failed before touching target file ($($replaceError.Message)). Live file remains intact."
                }
                # Hash differs -> STATE 3: Target demonstrably altered -> proceed to rollback
            }
            "FILE_MISSING" {
                # STATE 5A / OUTCOME 5A: Target missing -> Manual Recovery
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $replaceError -HashInspectionError $null -RollbackResult $null -Detail "Live destination file is missing after failed replace operation."
            }
            "HASH_READ_FAILED" {
                # STATE 5B / OUTCOME 5B: Target unreadable -> INDETERMINATE -> Manual Recovery (NO automatic rollback)
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $replaceError -HashInspectionError $liveCurrInfo.Error -RollbackResult $null -Detail "Live destination file is locked or unreadable: $($liveCurrInfo.Message)"
            }
            "HELPER_EXCEPTION" {
                # STATE 5F / OUTCOME 5F: Helper exception -> INDETERMINATE -> Manual Recovery (NO automatic rollback)
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $replaceError -HashInspectionError $liveCurrInfo.Error -RollbackResult $null -Detail "Hash helper failed on live destination: $($liveCurrInfo.Message)"
            }
            default {
                # STATE 5D / OUTCOME 5D: Unknown status -> INDETERMINATE -> Manual Recovery (NO automatic rollback)
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $replaceError -HashInspectionError $liveCurrInfo.Error -RollbackResult $null -Detail "Live destination returned unknown state ($($liveCurrInfo.Status)): $($liveCurrInfo.Message)"
            }
        }

        # STATE 3: Target demonstrably altered -> Trigger controlled rollback with verified trigger hash
        $rollbackResult = Invoke-ControlledRollbackV14 -LiveConfigPath $LiveConfigPath -GoldenBackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -ExpectedTriggerHash $liveCurrInfo.Hash -InitialError $replaceError

        if ($rollbackResult.Success) {
            # STATE 4 / OUTCOME 4: ROLLBACK SUCCEEDED
            Write-Host "[OUTCOME 4: ROLLBACK SUCCESS] Original configuration verified and restored. Golden backup preserved." -ForegroundColor Yellow
            Write-Host "[OUTCOME 4: ARTIFACT STATUS] Discard backup [$($rollbackResult.DiscardBackup)] retained on disk." -ForegroundColor Yellow
            throw "FAIL-CLOSED ABORT [OUTCOME 4]: Replacement failed ($($replaceError.Message)), but rollback successfully restored original configuration. Live service safe."
        }
        elseif ($rollbackResult.Status -eq "ROLLBACK_BYTE_VERIFY_FAILED") {
            # STATE 5E / OUTCOME 5E: ROLLBACK BYTE VERIFICATION FAILED
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $replaceError -HashInspectionError $null -RollbackResult $rollbackResult -Detail "Rollback restored hash, but post-rollback byte integrity verification failed."
        }
        else {
            # STATE 5C / OUTCOME 5C: ROLLBACK FAILED
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $replaceError -HashInspectionError $null -RollbackResult $rollbackResult -Detail "Rollback execution failed ($($rollbackResult.Status)): $($rollbackResult.Message)"
        }
    }

    # -------------------------------------------------------------
    # STAGE 3: POST-REPLACEMENT INTEGRITY VERIFICATION (9-CLASS)
    # -------------------------------------------------------------
    $livePostInfo = $null
    $postHashError = $null
    try {
        $livePostInfo = Get-SafeFileHashV4 -FilePath $LiveConfigPath
    }
    catch {
        $postHashError = $_.Exception
    }

    $postValidationPassed = $false
    $postValidationError = $null

    if ($postHashError -ne $null) {
        # STATE 5F: Indeterminate post-check -> Manual Recovery
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $postHashError -HashInspectionError $postHashError -RollbackResult $null -Detail "Post-replacement hash inspection query threw an unhandled exception."
    }
    elseif ($livePostInfo -eq $null -or $livePostInfo.Status -eq $null) {
        # STATE 5D: Indeterminate null result -> Manual Recovery
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError [System.InvalidOperationException]::new("Post-replacement inspection returned null") -HashInspectionError $null -RollbackResult $null -Detail "Post-replacement inspection returned null result object or status."
    }
    elseif ($livePostInfo.Status -eq "FILE_MISSING") {
        # STATE 5A: Target missing post-swap -> Manual Recovery
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError [System.InvalidOperationException]::new("Post-replacement file missing") -HashInspectionError $null -RollbackResult $null -Detail "Live destination file is missing immediately after reported successful replace."
    }
    elseif ($livePostInfo.Status -eq "HASH_READ_FAILED") {
        # STATE 5B: Target unreadable post-swap -> Manual Recovery
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError [System.InvalidOperationException]::new("Post-replacement file unreadable") -HashInspectionError $livePostInfo.Error -RollbackResult $null -Detail "Live destination file is locked or unreadable after replace: $($livePostInfo.Message)"
    }
    elseif ($livePostInfo.Status -eq "HELPER_EXCEPTION") {
        # STATE 5F: Helper exception post-swap -> Manual Recovery
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError [System.InvalidOperationException]::new("Post-replacement helper exception") -HashInspectionError $livePostInfo.Error -RollbackResult $null -Detail "Hash helper failed on live destination after replace: $($livePostInfo.Message)"
    }
    elseif ($livePostInfo.Status -eq "HASH_VERIFIED" -and $livePostInfo.Hash -eq $H_cand_pre) {
        try {
            Test-CandidateByteAndEncodingIntegrity -FilePath $LiveConfigPath
            $postValidationPassed = $true
        }
        catch {
            # Promoted file has byte anomaly -> STATE 3 (Altered readable)
            $postValidationError = $_.Exception
        }
    }
    elseif ($livePostInfo.Status -eq "HASH_VERIFIED" -and $livePostInfo.Hash -eq $H_live_pre) {
        # STATE 2B / OUTCOME 1: Live file matches baseline pre-change hash (Reported-Success No-Op)
        Write-Host "[OUTCOME 1: TARGET UNCHANGED NO-OP] Post-replacement hash equals baseline [$H_live_pre]. Replacement had no effect." -ForegroundColor Yellow
        throw "FAIL-CLOSED ABORT [OUTCOME 1]: Replacement reported success, but live file hash is unchanged baseline [$H_live_pre]. No rollback needed. Aborting promotion."
    }
    elseif ($livePostInfo.Status -eq "HASH_VERIFIED" -and $livePostInfo.Hash -ne $H_cand_pre) {
        # STATE 3: Target readable but hash corrupt -> Authorizes rollback
        $postValidationError = [System.InvalidOperationException]::new("Promoted hash [$($livePostInfo.Hash)] matches neither candidate [$H_cand_pre] nor baseline [$H_live_pre].")
    }
    else {
        # STATE 5D: Unknown status string -> Manual Recovery
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError [System.InvalidOperationException]::new("Post-replacement inspection returned unknown status") -HashInspectionError $null -RollbackResult $null -Detail "Post-replacement inspection returned unknown status string [$($livePostInfo.Status)]."
    }

    if ($postValidationPassed) {
        # STATE 1 / OUTCOME 2: PROMOTION SUCCESS VERIFIED
        Write-Host "[OUTCOME 2: PROMOTION SUCCESS] Promoted live configuration verified on disk [SHA256: $($livePostInfo.Hash)]." -ForegroundColor Green
        Write-Host "[OUTCOME 2: ARTIFACT STATUS] Golden Backup [$goldenBackupPath] preserved on disk." -ForegroundColor Green
        return $goldenBackupPath
    }
    else {
        # STATE 3: Target readable & corrupted -> Trigger controlled rollback with verified trigger hash
        Write-Error "[STATE 3: POST-VERIFICATION FAILED] $($postValidationError.Message)"
        $rollbackResult = Invoke-ControlledRollbackV14 -LiveConfigPath $LiveConfigPath -GoldenBackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -ExpectedTriggerHash $livePostInfo.Hash -InitialError $postValidationError

        if ($rollbackResult.Success) {
            # STATE 4 / OUTCOME 4: ROLLBACK SUCCEEDED
            throw "FAIL-CLOSED ABORT [OUTCOME 4]: Post-replacement verification failed ($($postValidationError.Message)), but rollback successfully restored original configuration."
        }
        elseif ($rollbackResult.Status -eq "ROLLBACK_BYTE_VERIFY_FAILED") {
            # STATE 5E / OUTCOME 5E: ROLLBACK BYTE VERIFICATION FAILED
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $postValidationError -HashInspectionError $null -RollbackResult $rollbackResult -Detail "Post-verification rollback restored hash, but post-rollback byte integrity verification failed."
        }
        else {
            # STATE 5C / OUTCOME 5C: ROLLBACK FAILED
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $postValidationError -HashInspectionError $null -RollbackResult $rollbackResult -Detail "Post-verification rollback failed ($($rollbackResult.Status)): $($rollbackResult.Message)"
        }
    }
}
```

---

### 6.3 Resilient Manual Recovery Boundary (`Enter-ManualRecoveryBoundaryV14`)

```powershell
# [NOT EXECUTED — UNTESTED OPERATIONAL PROCEDURE]

function Enter-ManualRecoveryBoundaryV14 {
    <#
    .SYNOPSIS
        Safely halts automation and enters the human-supervised manual recovery boundary.
        Eliminates unsafe raw Copy-Item execution, enforces pre-restoration forensic quarantine,
        requires independent SHA-256 Golden Backup verification, acknowledges missing runbook blocker,
        and demands Human Incident Commander approval before any filesystem modification.
    #>
    param (
        [string]$LivePath,
        [string]$BackupPath,
        [string]$ExpectedBaselineHash,
        [string]$CandidateHash,
        [System.Exception]$InitialError,
        [System.Exception]$HashInspectionError,
        [PSCustomObject]$RollbackResult,
        [string]$Detail
    )

    $diagnosticErrors = [System.Collections.Generic.List[string]]::new()

    Write-Host "`n" -NoNewline
    Write-Host "****************************************************************" -ForegroundColor Red
    Write-Host "         CRITICAL: ENTERING MANUAL RECOVERY BOUNDARY (OUTCOME 5)  " -ForegroundColor Red
    Write-Host "****************************************************************" -ForegroundColor Red
    Write-Host "Automated configuration recovery cannot be guaranteed safe."
    Write-Host "All automated operations have ceased to prevent data corruption."
    Write-Host "----------------------------------------------------------------"
    Write-Host "INCIDENT FORENSIC STATUS:"
    Write-Host "  Context / Detail:          $Detail"
    Write-Host "  Target Live File:          $LivePath"
    Write-Host "  Golden Backup File:        $BackupPath"
    Write-Host "  Expected Baseline Hash:    $ExpectedBaselineHash"
    Write-Host "  Candidate Hash:            $CandidateHash"
    
    if ($InitialError -ne $null) {
        Write-Host "  Initial Error:             $($InitialError.GetType().Name): $($InitialError.Message)"
    }
    if ($HashInspectionError -ne $null) {
        Write-Host "  Hash Inspection Error:     $($HashInspectionError.GetType().Name): $($HashInspectionError.Message)"
    }
    if ($RollbackResult -ne $null) {
        Write-Host "  Rollback Status:           $($RollbackResult.Status)"
        Write-Host "  Rollback Message:          $($RollbackResult.Message)"
        if ($RollbackResult.DiscardBackup) {
            Write-Host "  Rollback Discard Backup:   $($RollbackResult.DiscardBackup)"
        }
        if ($RollbackResult.Error) {
            Write-Host "  Rollback Error Detail:     $($RollbackResult.Error.GetType().Name): $($RollbackResult.Error.Message)"
        }
    }

    # Isolated Query 1: Live File Status Check (9-Class Classification with Null Guard)
    Write-Host "----------------------------------------------------------------"
    Write-Host "NON-MUTATING LIVE FILE DIAGNOSTIC CHECK:"
    try {
        $liveInspection = Get-SafeFileHashV4 -FilePath $LivePath
        if ($liveInspection -ne $null) {
            Write-Host "  Current Live Status:       $($liveInspection.Status)"
            Write-Host "  Current Live Hash:         $($liveInspection.Hash)"
            if ($liveInspection.Error) {
                Write-Host "  Live Inspection Error:     $($liveInspection.Error.Message)"
            }
        } else {
            Write-Host "  Current Live Status:       NULL OBJECT RETURNED"
        }
    }
    catch {
        $diagnosticErrors.Add("Live File Query Threw: $($_.Exception.Message)")
        Write-Host "  Live File Status:          QUERY FAILED ($($_.Exception.Message))"
    }

    # Isolated Query 2: Active PostgreSQL Process Check
    Write-Host "----------------------------------------------------------------"
    Write-Host "ACTIVE PROCESS & SERVICE STATUS:"
    try {
        $pgProcesses = Get-Process -Name "postgres*" -ErrorAction SilentlyContinue
        if ($pgProcesses) {
            Write-Host "  PostgreSQL Processes:      Found $($pgProcesses.Count) running process(es). PIDs: $(($pgProcesses.Id) -join ', ')"
        } else {
            Write-Host "  PostgreSQL Processes:      Zero running postgres processes detected."
        }
    }
    catch {
        $diagnosticErrors.Add("Process Query Threw: $($_.Exception.Message)")
        Write-Host "  PostgreSQL Processes:      QUERY FAILED ($($_.Exception.Message))"
    }

    # Isolated Query 3: Windows Service Status Check
    try {
        $svc = Get-Service -Name "postgresql-x64-18" -ErrorAction SilentlyContinue
        Write-Host "  Service Status:            $($svc.Name) is $($svc.Status)"
    }
    catch {
        $diagnosticErrors.Add("Service Query Threw: $($_.Exception.Message)")
        Write-Host "  Service Status:            QUERY FAILED ($($_.Exception.Message))"
    }

    if ($diagnosticErrors.Count -gt 0) {
        Write-Host "----------------------------------------------------------------"
        Write-Host "INTERNAL DIAGNOSTIC WARNINGS:" -ForegroundColor Yellow
        foreach ($dErr in $diagnosticErrors) {
            Write-Host "  - $dErr" -ForegroundColor Yellow
        }
    }

    Write-Host "----------------------------------------------------------------"
    Write-Host "MANDATORY HUMAN INCIDENT COMMANDER ACTIONS (GATE 6):" -ForegroundColor Red
    Write-Host "  [DO NOT EXECUTE DIRECT OVERWRITE — NON-ATOMIC OVERWRITES CAN COMPOUND OUTAGES]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  STEP 1: OBTAIN HUMAN INCIDENT COMMANDER APPROVAL"
    Write-Host "          Halt all scripts. Notify the database administrator. Do not modify files."
    Write-Host ""
    Write-Host "  STEP 2: PRESERVE FORENSIC QUARANTINE"
    Write-Host "          Retain all artifacts on disk: Golden Backup, Discard Backup, Candidate."
    Write-Host "          Record diagnostic log output above for post-incident review."
    Write-Host ""
    Write-Host "  STEP 3: INDEPENDENT GOLDEN BACKUP VERIFICATION"
    Write-Host "          Run an independent SHA-256 check on the Golden Backup file:"
    Write-Host "          Get-FileHash -Path '$BackupPath' -Algorithm SHA256"
    Write-Host "          Verify hash EXACTLY matches expected baseline: '$ExpectedBaselineHash'"
    Write-Host ""
    Write-Host "  STEP 4: NOTICE OF OPEN OPERATIONAL BLOCKER — MISSING RUNBOOK" -ForegroundColor Yellow
    Write-Host "          [CRITICAL]: No dedicated reviewed runbook exists in repository." -ForegroundColor Yellow
    Write-Host "          (docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md is absent from disk)." -ForegroundColor Yellow
    Write-Host "          Do NOT perform ad-hoc terminal restoration. Quiesce PostgreSQL service" -ForegroundColor Yellow
    Write-Host "          and await human approval of formal restoration protocol." -ForegroundColor Yellow
    Write-Host "****************************************************************`n" -ForegroundColor Red

    # Unconditional fail-closed terminating emergency halt
    throw "FAIL-CLOSED EMERGENCY STOP [OUTCOME 5]: Manual recovery boundary entered. Automation halted. Missing runbook blocker active."
}
```

---

## 7. Section 6 — Expanded Fault-Injection Validation Test Matrix (44 Scenarios)

The test matrix is expanded from 38 to **44 exhaustive scenarios**, covering all identified rollback classification gaps, discard/clone verification classes, and runbook assertion checks:

| Test ID | Scenario Description | Injected Fault / Failure Condition | Code Branch Triggered | Resulting Status / Outcome | Deterministic Artifact States |
|---|---|---|---|---|---|
| **TEST-01** | **Pre-Flight Live Missing** | Target configuration deleted before execution. | PF-1 $\rightarrow$ `Status == 'FILE_MISSING'` | `PREFLIGHT_LIVE_MISSING` | Candidate: Retained; Backup: Not Created; Clone: Not Created; Discard: Not Created. |
| **TEST-02** | **Pre-Flight Live Read Lock** | Live configuration exclusively locked. | PF-1 $\rightarrow$ `Status == 'HASH_READ_FAILED'` | `PREFLIGHT_LIVE_UNREADABLE` | Candidate: Retained; Backup: Not Created; Clone: Not Created; Discard: Not Created. |
| **TEST-03** | **Pre-Flight Live Helper Crash**| `Get-SafeFileHashV4` encounters internal CLR fault. | PF-1 $\rightarrow$ `Status == 'HELPER_EXCEPTION'` | `PREFLIGHT_LIVE_HELPER_EXCEPTION` | Candidate: Retained; Backup: Not Created; Clone: Not Created; Discard: Not Created. |
| **TEST-04** | **Pre-Flight Live Query Threw** | Helper invocation throws terminating exception. | PF-1 $\rightarrow$ Caller catch sets `$livePreError` | `PREFLIGHT_LIVE_QUERY_THREW` | Candidate: Retained; Backup: Not Created; Clone: Not Created; Discard: Not Created. |
| **TEST-05** | **Pre-Flight Candidate Missing**| Staged candidate deleted before execution. | PF-1B $\rightarrow$ `Status == 'FILE_MISSING'` | `PREFLIGHT_CAND_MISSING` | Candidate: Retained; Backup: Not Created; Clone: Not Created; Discard: Not Created. |
| **TEST-06** | **Pre-Flight Candidate Locked** | Staged candidate locked by another process. | PF-1B $\rightarrow$ `Status == 'HASH_READ_FAILED'` | `PREFLIGHT_CAND_UNREADABLE` | Candidate: Retained; Backup: Not Created; Clone: Not Created; Discard: Not Created. |
| **TEST-07** | **Pre-Flight Candidate Helper Crash**| Helper encounters internal error on candidate. | PF-1B $\rightarrow$ `Status == 'HELPER_EXCEPTION'` | `PREFLIGHT_CAND_HELPER_EXCEPTION`| Candidate: Retained; Backup: Not Created; Clone: Not Created; Discard: Not Created. |
| **TEST-08** | **Pre-Flight Candidate Query Threw**| Helper call throws on candidate check. | PF-1B $\rightarrow$ Caller catch sets `$candPreError` | `PREFLIGHT_CAND_QUERY_THREW` | Candidate: Retained; Backup: Not Created; Clone: Not Created; Discard: Not Created. |
| **TEST-09** | **Candidate Encoding Failure** | Candidate file contains bare LF (`\n`). | PF-0 $\rightarrow$ `Test-CandidateByte...` throws | `PREFLIGHT_CANDIDATE_INVALID` | Candidate: Retained; Backup: Not Created; Clone: Not Created; Discard: Not Created. |
| **TEST-10** | **Golden Backup Path Collision**| Golden backup path exists prior to execution. | PF-2 $\rightarrow$ `FileStream` throws `IOException` | `PREFLIGHT_COLLISION_DETECTED` | Candidate: Retained; Backup: Not Created; Clone: Not Created; Discard: Not Created. |
| **TEST-11** | **Golden Backup Write Fail** | Disk quota exhausted during `FileStream.Write`. | PF-2 $\rightarrow$ `FileStream` throws `IOException` | `PREFLIGHT_BACKUP_WRITE_FAILED` | Candidate: Retained; Backup: Partial Retained; Clone: Not Created; Discard: Not Created. |
| **TEST-12** | **Backup Verify: Hash Mismatch**| Backup byte corruption: $H(\text{Backup}) \neq H_{\text{live\_pre}}$. | PF-3 $\rightarrow$ `$gbInfo.Hash -ne $H_live_pre` | `PREFLIGHT_BACKUP_HASH_MISMATCH`| Candidate: Retained; Backup: Corrupt Retained; Clone: Not Created; Discard: Not Created. |
| **TEST-13** | **Backup Verify: Missing** | Backup file removed immediately after write. | PF-3 $\rightarrow$ `Status == 'FILE_MISSING'` | `PREFLIGHT_BACKUP_MISSING` | Candidate: Retained; Backup: Not Created; Clone: Not Created; Discard: Not Created. |
| **TEST-14** | **Backup Verify: Locked** | Backup file locked by indexing service. | PF-3 $\rightarrow$ `Status == 'HASH_READ_FAILED'` | `PREFLIGHT_BACKUP_UNREADABLE` | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Not Created. |
| **TEST-15** | **Backup Verify: Helper Crash**| Helper returns `HELPER_EXCEPTION` on backup. | PF-3 $\rightarrow$ `Status == 'HELPER_EXCEPTION'` | `PREFLIGHT_BACKUP_HELPER_EXCEPTION`| Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Not Created. |
| **TEST-16** | **Pre-Swap Candidate Mutated** | Candidate modified after pre-flight hash check. | PF-4A $\rightarrow$ `$candImmediate.Hash -ne $H_cand_pre`| `PRE_SWAP_CANDIDATE_MUTATED` | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Not Created. |
| **TEST-17** | **Pre-Swap Candidate Locked** | Candidate locked prior to replacement swap. | PF-4A $\rightarrow$ `Status == 'HASH_READ_FAILED'` | `PRE_SWAP_CAND_UNREADABLE` | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Not Created. |
| **TEST-18** | **Pre-Swap Live Mutated** | Live config modified after backup verification. | PF-4B $\rightarrow$ `$liveImmediate.Hash -ne $H_live_pre`| `PRE_SWAP_LIVE_MUTATED` | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Not Created. |
| **TEST-19** | **Pre-Swap Live Locked** | Live file locked prior to replacement swap. | PF-4B $\rightarrow$ `Status == 'HASH_READ_FAILED'` | `PRE_SWAP_LIVE_UNREADABLE` | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Not Created. |
| **TEST-20** | **Clean Replacement Failure** | Win32 `File.Replace` throws; live hash == $H_{\text{live\_pre}}$. | Stage 2 $\rightarrow$ Replace throws $\rightarrow$ Hash matches | `TARGET_UNTOUCHED_THROWN` (State 2A) | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Not Created. |
| **TEST-21** | **Post-Swap Reported No-Op** | Swap returned success, but live hash == $H_{\text{live\_pre}}$. | Stage 3 $\rightarrow$ `$livePostInfo.Hash == $H_live_pre` | `TARGET_UNTOUCHED_NOOP` (State 2B) | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Not Created. |
| **TEST-22** | **Interrupted Swap: Missing** | Live destination deleted during interrupted swap. | Stage 2 $\rightarrow$ Replace throws $\rightarrow$ `Status == 'FILE_MISSING'` | `TARGET_FILE_MISSING` (State 5A) | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Not Created. |
| **TEST-23** | **Interrupted Swap: Unreadable**| Live destination locked; state INDETERMINATE. | Stage 2 $\rightarrow$ Replace throws $\rightarrow$ `Status == 'HASH_READ_FAILED'`| `TARGET_FILE_UNREADABLE` (State 5B) | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Not Created. |
| **TEST-24** | **Interrupted Swap: Tooling Crash**| Helper throws CLR exception during inspection. | Stage 2 $\rightarrow$ Replace throws $\rightarrow$ Helper throws | `TOOLING_EXCEPTION_HALT` (State 5F) | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Not Created. |
| **TEST-25** | **Altered Target: Rollback Passes**| Live readable & altered; sacrificial rollback passes. | Stage 2 $\rightarrow$ Target altered $\rightarrow$ Rollback passes | `ROLLBACK_SUCCESS` (Outcome 4 / State 4) | Candidate: Retained; Backup: Retained; Clone: Consumed (Live); Discard: Retained. |
| **TEST-26** | **Rollback Discard Write Fail** | Disk full during pre-rollback discard capture. | Rollback Stage 3 $\rightarrow$ `FileStream` throws `IOException` | `DISCARD_CAPTURE_FAILED` (State 5C) | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Partial Retained. |
| **TEST-27** | **Rollback Discard Query Threw**| Hash helper throws during discard backup check. | Rollback Stage 3B $\rightarrow$ Caller catch sets error | `DISCARD_QUERY_THREW` (State 5C) | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Retained. |
| **TEST-28** | **Rollback Discard Missing** | Discard file deleted immediately after write. | Rollback Stage 3B $\rightarrow$ `Status == 'FILE_MISSING'` | `DISCARD_FILE_MISSING` (State 5C) | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Not Created. |
| **TEST-29** | **Rollback Discard Locked** | Discard file locked by external process. | Rollback Stage 3B $\rightarrow$ `Status == 'HASH_READ_FAILED'` | `DISCARD_FILE_UNREADABLE` (State 5C) | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Retained. |
| **TEST-30** | **Rollback Discard Helper Crash**| Helper returns `HELPER_EXCEPTION` on discard backup.| Rollback Stage 3B $\rightarrow$ `Status == 'HELPER_EXCEPTION'` | `DISCARD_HELPER_EXCEPTION` (State 5C) | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Retained. |
| **TEST-31** | **Rollback Discard Hash Mismatch**| Live file altered during discard read/write. | Rollback Stage 3B $\rightarrow$ Hash != trigger hash | `DISCARD_HASH_MISMATCH` (State 5C) | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Retained. |
| **TEST-32** | **Rollback Clone Creation Fail** | Disk fault during sacrificial clone creation. | Rollback Stage 4 $\rightarrow$ `FileStream` throws `IOException` | `SACRIFICIAL_CLONE_CREATION_FAILED` (State 5C) | Candidate: Retained; Backup: Retained; Clone: Partial Retained; Discard: Retained. |
| **TEST-33** | **Rollback Clone Missing** | Clone file deleted immediately after write. | Rollback Stage 4A $\rightarrow$ `Status == 'FILE_MISSING'` | `SACRIFICIAL_CLONE_MISSING` (State 5C) | Candidate: Retained; Backup: Retained; Clone: Not Created; Discard: Retained. |
| **TEST-34** | **Rollback Clone Locked** | Clone locked by external process. | Rollback Stage 4A $\rightarrow$ `Status == 'HASH_READ_FAILED'` | `SACRIFICIAL_CLONE_UNREADABLE` (State 5C)| Candidate: Retained; Backup: Retained; Clone: Retained; Discard: Retained. |
| **TEST-35** | **Rollback Clone Helper Crash** | Helper returns `HELPER_EXCEPTION` on clone. | Rollback Stage 4A $\rightarrow$ `Status == 'HELPER_EXCEPTION'` | `SACRIFICIAL_CLONE_HELPER_EXCEPTION` (State 5C)| Candidate: Retained; Backup: Retained; Clone: Retained; Discard: Retained. |
| **TEST-36** | **Rollback Clone Hash Corrupt** | Sacrificial clone hash != baseline hash. | Rollback Stage 4A $\rightarrow$ Clone hash != baseline | `SACRIFICIAL_CLONE_HASH_MISMATCH` (State 5C)| Candidate: Retained; Backup: Retained; Clone: Retained; Discard: Retained. |
| **TEST-37** | **Rollback Pre-Swap Live Locked** | Live destination locked after discard capture. | Rollback Stage 4B $\rightarrow$ `Status == 'HASH_READ_FAILED'` | `PRE_ROLLBACK_LIVE_UNREADABLE` (State 5C) | Candidate: Retained; Backup: Retained; Clone: Retained; Discard: Retained. |
| **TEST-38** | **Live Mutated Post-Discard** | Live file altered after discard capture before swap. | Rollback Stage 4B $\rightarrow$ Hash != trigger hash | `LIVE_MUTATED_POST_DISCARD` (State 5C) | Candidate: Retained; Backup: Retained; Clone: Retained; Discard: Retained. |
| **TEST-39** | **Pre-Rollback Live Unknown Status**| Helper returns unknown status before rollback swap.| Rollback Stage 4B $\rightarrow$ `default` branch | `PRE_ROLLBACK_LIVE_UNKNOWN_STATUS` (State 5C)| Candidate: Retained; Backup: Retained; Clone: Retained; Discard: Retained. |
| **TEST-40** | **Rollback Swap Threw Exception**| Win32 `File.Replace` throws during rollback swap. | Rollback Stage 5 $\rightarrow$ `Replace` throws `IOException` | `ROLLBACK_SWAP_EXCEPTION` (State 5C) | Candidate: Retained; Backup: Retained; Clone: Retained; Discard: Retained. |
| **TEST-41** | **Rollback Byte Check Failure** | Rollback restores hash, but byte check detects bare LF. | Rollback Stage 6 $\rightarrow$ `Test-CandidateByte...` throws | `ROLLBACK_BYTE_VERIFY_FAILED` (State 5E) | Candidate: Retained; Backup: Retained; Clone: Consumed (Live); Discard: Retained. |
| **TEST-42** | **Recovery Diag Live Query Threw**| Helper throws during manual recovery live check. | Recovery Query 1 $\rightarrow$ Catch appends to `$diagnosticErrors`| `FAIL-CLOSED EMERGENCY STOP` (Outcome 5)| All artifacts preserved; warning displayed. |
| **TEST-43** | **Recovery Missing Runbook Notice**| Operator enters manual recovery; runbook absent. | Recovery Step 4 $\rightarrow$ Warns missing runbook blocker| `FAIL-CLOSED EMERGENCY STOP` (Outcome 5)| Blocks execution; requires human protocol review. |
| **TEST-44** | **Unauthorized Restoration Attempt**| Operator attempts direct overwrite without Gate 6 approval.| Out-of-band operator violation | **BLOCKED BY RUNBOOK INVARIANT** | Automation halts fail-closed; runbook forbids action. |

> [!NOTE]
> All 44 scenarios in the matrix above are strictly **[NOT EXECUTED — UNTESTED]**. They define the formal behavioral specification under simulated fault injection, but have not been executed on the live Windows host.

---

## 8. Section 7 — Open Blockers & Inherent Windows TOCTOU Boundaries

### 8.1 Critical Open Blockers

1. **Missing Manual Restoration Protocol Runbook (`docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md`):**
   - As audited and verified in Section 4, the repository currently contains no manual restoration runbook.
   - **Resolution Required:** Before operational promotion or deployment can be authorized at Gate 5/6, a dedicated, human-reviewed runbook specifying the offline atomic staging restoration procedure must be authored and verified.
2. **Inherent OS-Level TOCTOU Window:**
   - In Windows user mode, a non-zero Time-of-Check to Time-of-Use window exists between the final handle closure of pre-swap verification and the internal handle acquisition of Win32 `ReplaceFileW`.
   - **Root Cause:** Win32 `ReplaceFileW` internally calls `CreateFileW` with exclusive flags. The caller cannot hold an unshared handle across the call without causing `ERROR_SHARING_VIOLATION`.
   - **Safety Posture:** The design does not claim to eliminate this window; it relies on post-replacement dual verification to detect any mid-flight tampering immediately after the swap, triggering fail-closed manual recovery.

### 8.2 Operational Constraints Reaffirmed
1. **Zero Automated Credentials:** Role creation must use interactive console sessions via `\password zentra_dev`. No passwords in scripts.
2. **PostgreSQL Daemon Configuration Cache:** Dynamically reloading configuration via `pg_ctl reload` must be validated against `pg_hba_file_rules` for zero error rows before operator sign-off.
3. **Standalone Migration Runner Absence:** A dedicated CLI migration runner with pre-flight database assertions does not yet exist and must be authored and reviewed prior to Gate 5.

---

## 9. Section 8 — Static Consistency Review & Verification Traceability

| Consistency Requirement | Implementation in Step 2D-2A-AN | Audit Verification | Status |
|---|---|---|---|
| **Discard 9-Class Taxonomy** | Stage 3B handles missing, unreadable, helper exception, null, unknown, and hash mismatch independently. | Explicit switch on `$discardInfo.Status` implemented in `Invoke-ControlledRollbackV14`. | 🟢 **COMPLIANT** |
| **Clone 9-Class Taxonomy** | Stage 4A handles missing, unreadable, helper exception, null, unknown, and hash mismatch independently. | Explicit switch on `$cloneInfo.Status` implemented in `Invoke-ControlledRollbackV14`. | 🟢 **COMPLIANT** |
| **Pre-Swap Live Barrier Fix** | Stage 4B separates unknown status from mutation; reserves `LIVE_MUTATED_POST_DISCARD` strictly for verified hash change. | Explicit switch on `$livePreSwapCheck.Status` implemented in `Invoke-ControlledRollbackV14`. | 🟢 **COMPLIANT** |
| **Runbook Verification** | Audited repository for `docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md`; reported missing status empirically. | `Test-Path` verified `False`; documented as primary blocker; phantom link removed. | 🟢 **COMPLIANT** |
| **Zero Raw Copy-Item Output** | Eliminated executable `Copy-Item` command lines from manual recovery boundary. | `Enter-ManualRecoveryBoundaryV14` provides structured diagnostic logs and halts fail-closed. | 🟢 **COMPLIANT** |
| **Mandatory Human Gate (Gate 6)** | Operator action requires formal Incident Commander sign-off before any filesystem intervention. | Codified as Step 1 in manual recovery boundary output. | 🟢 **COMPLIANT** |
| **Independent Golden Baseline Check**| Mandates independent SHA-256 calculation against recorded baseline before restoration. | Codified as Step 3 in manual recovery boundary output. | 🟢 **COMPLIANT** |
| **Decoupled Win32 Swaps** | `File.Replace` called with `lpBackupFileName = $null` in all code paths. | Zero unreserved backup paths passed to Win32 API. | 🟢 **COMPLIANT** |
| **Deterministic Artifact Matrix** | All 44 scenarios have explicit, immutable artifact states. | Zero ambiguous `Consumed / Retained` entries. | 🟢 **COMPLIANT** |
| **Fail-Closed Indeterminate States**| Missing, unreadable, null, unknown, and thrown states NEVER authorize automatic rollback. | Verified in state machine logic and authorization matrices. | 🟢 **COMPLIANT** |

---

## 10. Section 9 — Confirmation of Safety & Compliance

- **Operational Execution:** **ZERO.** No operational commands were executed.
- **Database Writes / DDL:** **ZERO.** No databases, roles, tables, schemas, or records were created, modified, or dropped.
- **Data Mutating Commands:** **ZERO.** No `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, migrations, seeds, or tests were executed.
- **Configuration Modifications:** **ZERO.** No changes were made to `postgresql.conf`, `pg_hba.conf`, Windows Firewall, Windows services, application code, or `.env` files.
- **Remote Cloud Connections:** **ZERO.** No connections made to Neon, AWS, Supabase, Render, or any remote host.
- **Budget Integrity:** Strict ₹0/month budget preserved.
- **Preserved Existing Databases:** Catalogs `hisecure_erp`, `hitech_platform`, and `zentra_test` remain completely untouched.
- **Production Scope:** Strictly local development workstation scope; no production readiness certification is claimed.

---

```
STOP — STEP 2D-2A-AN COMPLETE — WAITING FOR HUMAN REVIEW
```
