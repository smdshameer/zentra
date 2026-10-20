# MUSE SPARK — ZENTRA STEP 2D-2A-AO-Y
## EXCEPTION INHERITANCE ORDERING & FILESYSTEM CLASSIFICATION AUDIT REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Target Repository:** `D:\Zentra`  
**Input Reference:** [`docs/MUSE_SPARK_STEP2D_2A_AO_X_HASH_HELPER_ERROR_CLASSIFICATION_AUDIT_REPORT.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_AO_X_HASH_HELPER_ERROR_CLASSIFICATION_AUDIT_REPORT.md)  
**Host Environment:** Windows Workstation (`127.0.0.1:5432`)  
**Report Date:** 2026-10-09  
**Mode:** STRICT DOCUMENTATION-ONLY SPECIFICATION AUDIT  
**Budget Constraint:** Strict ₹0/month (Zero cost, no credit cards, no paid upgrades)  
**Remote Access:** STRICTLY PROHIBITED (Zero remote connections permitted or made)  
**Execution Authorization:** NOT GRANTED — NO OPERATIONAL COMMANDS EXECUTED IN THIS STEP  
**Status:** COMPLETE — WAITING FOR HUMAN OPERATOR REVIEW  

---

## 1. Executive Verdict & Scope

### 1.1 Executive Verdict

A comprehensive runtime and inheritance audit of the Step 2D-2A-AO-X report (`Dispatch-RollbackResultV24`) revealed an **exception shadowing defect within the returned `HASH_READ_FAILED` error discrimination ladder**:

1. **Shadowing of Derived `IOException` Types in Inner Error Discrimination:**  
   In `Dispatch-RollbackResultV24`, Stage 3G evaluated `$discardHashInfo.Error` using a 5-way ladder where `elseif ($innerEx -is [System.IO.IOException])` was placed without prior filtering for `DirectoryNotFoundException` or `PathTooLongException`. Under the Microsoft .NET Base Class Library (BCL) type system:
   - `DirectoryNotFoundException` derives directly from `System.IO.IOException`.
   - `PathTooLongException` derives directly from `System.IO.IOException`.  
   Because PowerShell evaluates `if/elseif` type filters sequentially using `isinst`, any `DirectoryNotFoundException` or `PathTooLongException` returned inside `$discardHashInfo.Error` evaluated `$innerEx -is [System.IO.IOException]` as `$true`.  
   **Diagnostic Impact:** A missing parent directory was misclassified as `DISCARD_FILE_LOCKED` (**State 5B: sharing violation / file lock**) rather than confirmed disappearance (**State 5C**). Similarly, a path buffer overflow was misclassified as a file lock (**State 5B**) rather than an indeterminate path syntax error (**State 5D**).
2. **Missing Explicit Argument Exception Discrimination:**  
   If the helper returned an `ArgumentException` (such as illegal path characters or empty path segments), the V24 ladder fell through to the catch-all `else` branch, logging `DISCARD_HASH_UNEXPECTED_ERROR_TYPE` (**State 5F: tooling execution crash**) rather than diagnosing a path metadata defect (**State 5D: `DISCARD_HASH_ARGUMENT_INVALID`**).
3. **Rigorous Separation of Thrown Exceptions vs. Returned Metadata:**  
   The audit confirmed that exceptions thrown directly by the helper (unhandled script crashes caught by outer `try/catch` $\rightarrow$ State 5F) must remain strictly segregated from structured error objects returned in the `.Error` property of `HASH_READ_FAILED`.

This report, **Step 2D-2A-AO-Y**, provides the definitive architectural remediation:
- Hardens the `HASH_READ_FAILED` error evaluation in **`Dispatch-RollbackResultV25`** into a strictly ordered **8-way decision ladder**, testing `FileNotFoundException`, `DirectoryNotFoundException`, `PathTooLongException`, and `ArgumentException` strictly before base `IOException`.
- Provides an **Ordered Decision Table** for returned `HASH_READ_FAILED` metadata, documenting the inheritance chain, matching branch, target state, diagnostic message, and mathematical proof that no earlier branch shadows it.
- Confirms the boundary between `VERIFIED_HASH_MISMATCH` and hardware corruption: digest inequality proves payload variance, not physical bit-rot.
- Expands the discard outcome architecture to a **31-class taxonomy (DISC-01 through DISC-31)**.
- Expands the outer-dispatch test suite to **115 exhaustive test specifications (DSP-01 through DSP-115)**, bringing the total system test specification count to **156 specifications**, all strictly marked `NOT EXECUTED — UNTESTED`.

> [!IMPORTANT]
> **Strict Documentation Boundary:** All operational scripts, procedures, and test specifications documented in this report are strictly **[NOT EXECUTED — UNTESTED]**. Zero operational commands of any kind were executed. Zero operational files (`postgresql.conf`, `pg_hba.conf`), Windows Firewall rules, Windows services, application source files, `.env` files, or databases were modified.

---

## 2. Findings with Exact AO-X Section & Line References

| Finding ID | Location in AO-X Report | Defect / Vulnerability Description | Technical Impact | Mandatory Correction in Step AO-Y |
|---|---|---|---|---|
| **FIND-AY1** | `Dispatch-RollbackResultV24`<br/>Lines 348–370 | **`IOException` Shadowing in `HASH_READ_FAILED`:** `$innerEx -is [System.IO.IOException]` was evaluated without prior checks for `DirectoryNotFoundException` or `PathTooLongException`. Both derive from `IOException`. | Missing directories and long paths are misclassified as `DISCARD_FILE_LOCKED` (State 5B) rather than State 5C (directory missing) or State 5D (path invalid). | Place `DirectoryNotFoundException` and `PathTooLongException` strictly ahead of base `IOException` in the `HASH_READ_FAILED` ladder. |
| **FIND-AY2** | `Dispatch-RollbackResultV24`<br/>Lines 365–372 | **Missing `ArgumentException` Discrimination:** Invalid path arguments returned in `.Error` fall into `else` branch mapping to State 5F (unexpected error type). | Misdiagnoses path syntax/argument defects as tooling engine crashes (State 5F) instead of metadata invalidity (State 5D). | Add explicit `elseif ($innerEx -is [System.ArgumentException])` mapping to State 5D (`DISCARD_HASH_ARGUMENT_INVALID`). |
| **FIND-AY3** | Section 3.1 & 6<br/>Lines 58–75, 335–345 | **Unformalized Distinction Between Thrown vs. Returned Errors:** The text discussed thrown vs. returned errors but lacked an explicit comparative contract table. | Risk of developers merging outer helper `try/catch` with inner `.Error` property inspection. | Formulate an explicit architectural contract separating thrown CLR exceptions from returned error metadata objects. |
| **FIND-AY4** | Section 7.1<br/>Lines 590–605 | **Outer-Dispatch Test Suite Coverage Gaps:** DSP suite ended at DSP-110, omitting tests for directory disappearance, long paths, and invalid arguments returned in `HASH_READ_FAILED`. | Test matrix lacks validation for the expanded 8-way inner exception ladder. | Expand DSP suite from 110 to 115 test specifications (DSP-01 through DSP-115). |

---

## 3. Finding 1 — CLR Exception Inheritance & Branch Ordering Audit

### 3.1 The .NET Type Inheritance Structure in `HASH_READ_FAILED`

When `Get-SafeFileHashV4` traps an exception during `[System.IO.File]::OpenRead`, it packages the trapped exception into `$discardHashInfo.Error`. The dispatcher inspects this object.

The relevant .NET inheritance hierarchy is:

```
System.Object
  └── System.Exception
        └── System.SystemException
              ├── System.ArgumentException  <-- Sibling of IOException (State 5D)
              ├── System.UnauthorizedAccessException  <-- Sibling of IOException (State 5B)
              └── System.IO.IOException
                    ├── System.IO.FileNotFoundException  <-- Derived (State 5C)
                    ├── System.IO.DirectoryNotFoundException  <-- Derived (State 5C)
                    └── System.IO.PathTooLongException  <-- Derived (State 5D)
```

### 3.2 Proof of Shadowing in AO-X

In PowerShell, `elseif ($x -is [Type])` evaluates using the CLR `isinst` instruction, which returns true for any instance of `Type` **or any class derived from `Type`**:

$$x \in \text{DirectoryNotFoundException} \implies x \text{ is } \text{IOException} = \text{TRUE}$$
$$x \in \text{PathTooLongException} \implies x \text{ is } \text{IOException} = \text{TRUE}$$

In `Dispatch-RollbackResultV24`:
```powershell
# DEFECTIVE V24 INNER LADDER:
elseif ($innerEx -is [System.IO.FileNotFoundException]) { ... } # State 5C
elseif ($innerEx -is [System.UnauthorizedAccessException]) { ... } # State 5B
elseif ($innerEx -is [System.IO.IOException]) { ... } # INTERCEPTS DirectoryNotFound & PathTooLong!
else { ... }
```
Because `DirectoryNotFoundException` and `PathTooLongException` were omitted prior to `IOException`, they evaluated `$innerEx -is [System.IO.IOException]` as `$true`. They were trapped by branch 4 and misdiagnosed as `DISCARD_FILE_LOCKED` (State 5B).

---

## 4. Finding 2 — Ordered Decision Table for `HASH_READ_FAILED`

Below is the definitive, mathematically verified **Ordered Decision Table** for `HASH_READ_FAILED` inner error evaluation in `Dispatch-RollbackResultV25`:

| Execution Order | Evaluation Filter | .NET Inheritance Relationship | Target State | Diagnostic Message / Detail Code | Mathematical Proof of Non-Shadowing |
|---|---|---|---|---|---|
| **Step 1** | `$innerEx -eq $null` | Null reference check | **State 5D** | `DISCARD_HASH_ERROR_METADATA_MISSING` | Evaluated first; prevents `NullReferenceException` on all subsequent type queries. |
| **Step 2** | `$innerEx -is [System.IO.FileNotFoundException]` | Derived from `IOException` | **State 5C** | `DISCARD_FILE_DELETED_PRE_HASH` | Evaluated before base `IOException`. Specifically matches missing file. |
| **Step 3** | `$innerEx -is [System.IO.DirectoryNotFoundException]` | Derived from `IOException` | **State 5C** | `DISCARD_DIRECTORY_DELETED_PRE_HASH` | Evaluated before base `IOException`. Specifically matches missing directory. |
| **Step 4** | `$innerEx -is [System.IO.PathTooLongException]` | Derived from `IOException` | **State 5D** | `DISCARD_HASH_PATH_TOO_LONG` | Evaluated before base `IOException`. Specifically matches path length overflow. |
| **Step 5** | `$innerEx -is [System.ArgumentException]` | Derived from `SystemException` (Sibling) | **State 5D** | `DISCARD_HASH_ARGUMENT_INVALID` | Evaluated before base `IOException`. Matches illegal characters and invalid path syntax. |
| **Step 6** | `$innerEx -is [System.UnauthorizedAccessException]` | Derived from `SystemException` (Sibling) | **State 5B** | `DISCARD_FILE_ACCESS_DENIED` | Evaluated before base `IOException`. Matches NTFS DACL access restriction. |
| **Step 7** | `$innerEx -is [System.IO.IOException]` | Base class for I/O exceptions | **State 5B** | `DISCARD_FILE_LOCKED` | Evaluated ONLY after all derived `IOException` types are filtered. Captures genuine sharing locks. |
| **Step 8** | `else` (Unrecognized Exception Type) | Root `System.Exception` | **State 5F** | `DISCARD_HASH_UNEXPECTED_ERROR_TYPE` | Final catch-all for unanticipated runtime/tooling exceptions (e.g. `OutOfMemoryException`). |

---

## 5. Finding 3 — Thrown Exceptions vs. Returned Error Metadata Contract

The execution architecture enforces strict separation between exceptions *thrown* by the helper and structured error metadata *returned* by the helper:

```
                                    Invoke Get-SafeFileHashV4($discardPath)
                                                       |
                    +----------------------------------+----------------------------------+
                    |                                                                     |
         UNHANDLED CLR THROW                                                    NORMAL RETURN
                    |                                                                     |
                    v                                                                     v
       Stage 3G Outer try/catch                                             Inspect $discardHashInfo.Status
                    |                                                                     |
                    v                                          +--------------------------+--------------------------+
      [STATE 5F: TOOLING CRASH]                                |                          |                          |
     DISCARD_HASH_QUERY_THREW                                  v                          v                          v
    (Helper crashed during exec)                       HASH_VERIFIED              HELPER_EXCEPTION            HASH_READ_FAILED
                                                               |                          |                          |
                                                               v                          v                          v
                                                        Inspect Hash &           [STATE 5F: TOOLING]         Execute 8-Way
                                                        Verify Equality        DISCARD_HELPER_EXCEPTION     Ordered Ladder
                                                                                 (Helper reported bug)       (Table in Sec 4)
```

| Operational Dimension | Thrown CLR Exception (`try/catch`) | Returned `HASH_READ_FAILED` Metadata | Returned `HELPER_EXCEPTION` Metadata |
|---|---|---|---|
| **Mechanism** | CLR exception propagates up call stack | Function returns `PSCustomObject` | Function returns `PSCustomObject` |
| **Interception Point** | Outer `catch` block wrapping helper invocation | `switch ($discardHashInfo.Status)` block | `switch ($discardHashInfo.Status)` block |
| **Operational Meaning** | Script syntax error, missing dependency, CLR panic | File stream could not be opened by OS | Helper trapped internal script fault |
| **Default Classification**| **State 5F** (`DISCARD_HASH_QUERY_THREW`) | Evaluated via 8-way ladder (States 5B, 5C, 5D, 5F) | **State 5F** (`DISCARD_HELPER_EXCEPTION`) |

---

## 6. Hardened Operational Specification: `Dispatch-RollbackResultV25`

Below is the complete, hardened operational specification for `Dispatch-RollbackResultV25`:

```powershell
# [NOT EXECUTED — UNTESTED OPERATIONAL PROCEDURE]

function Dispatch-RollbackResultV25 {
    <#
    .SYNOPSIS
        Outer rollback-result dispatcher with terminal fail-closed control flow,
        strictly ordered 8-way HASH_READ_FAILED error discrimination, full inheritance
        precedence preservation, and precise cryptographic metadata validation.
    #>
    param (
        [PSCustomObject]$RollbackResult,
        [string]$LiveConfigPath,
        [string]$GoldenBackupPath,
        [string]$ExpectedBaselineHash,
        [string]$ExpectedTriggerHash,
        [string]$CandidateHash,
        [System.Exception]$TriggerError,
        [string]$ContextName
    )

    $sha256Regex = '^[A-Fa-f0-9]{64}$'

    # -------------------------------------------------------------------------
    # STAGE 0: CALLER PARAMETER INTEGRITY ASSERTIONS (TRUST ROOTS)
    # -------------------------------------------------------------------------
    # 0A. Validate ExpectedBaselineHash
    if ([string]::IsNullOrWhiteSpace($ExpectedBaselineHash)) {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
            -Detail "[STATE 5D: $ContextName] BASELINE_HASH_MISSING: ExpectedBaselineHash parameter is null or empty. Fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: ExpectedBaselineHash is null or empty.")
    }
    if ($ExpectedBaselineHash -notmatch $sha256Regex) {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
            -Detail "[STATE 5D: $ContextName] BASELINE_HASH_MALFORMED: ExpectedBaselineHash [$ExpectedBaselineHash] is not a valid 64-char SHA-256 hex string. Fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: ExpectedBaselineHash is malformed.")
    }

    # 0B. Validate ExpectedTriggerHash (Trust Root for Discard Artifact)
    if ([string]::IsNullOrWhiteSpace($ExpectedTriggerHash)) {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
            -Detail "[STATE 5D: $ContextName] TRIGGER_HASH_MISSING: Caller failed to supply ExpectedTriggerHash. Discard validation impossible — fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: ExpectedTriggerHash parameter is null or empty.")
    }
    if ($ExpectedTriggerHash -notmatch $sha256Regex) {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
            -Detail "[STATE 5D: $ContextName] TRIGGER_HASH_MALFORMED: ExpectedTriggerHash [$ExpectedTriggerHash] is not a valid 64-char SHA-256 hex string. Fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: ExpectedTriggerHash is malformed.")
    }

    # -------------------------------------------------------------------------
    # STAGE 1: DEFENSIVE RESULT OBJECT VALIDATION
    # -------------------------------------------------------------------------
    if ($RollbackResult -eq $null) {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $null `
            -Detail "[STATE 5D: $ContextName] ROLLBACK_RESULT_NULL_OBJECT: Rollback engine returned null result object. Indeterminate — fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: RollbackResult is null.")
    }

    # -------------------------------------------------------------------------
    # STAGE 2: CONTRADICTION INTERCEPTION TRAPS
    # -------------------------------------------------------------------------
    if ($RollbackResult.Success -eq $true -and $RollbackResult.Status -ne "ROLLBACK_SUCCESS") {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
            -Detail "[STATE 5D: $ContextName] CONTRADICTORY_ROLLBACK_RESULT_FLAG_TRUE: Success is true, but Status is '$($RollbackResult.Status)'. Fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Contradictory flag/status pair (Success=true, Status!=ROLLBACK_SUCCESS).")
    }

    if ($RollbackResult.Success -ne $true -and $RollbackResult.Status -eq "ROLLBACK_SUCCESS") {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
            -Detail "[STATE 5D: $ContextName] CONTRADICTORY_ROLLBACK_RESULT_STATUS_SUCCESS: Status claims 'ROLLBACK_SUCCESS', but Success is false. Fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Contradictory flag/status pair (Success=false, Status=ROLLBACK_SUCCESS).")
    }

    # -------------------------------------------------------------------------
    # STAGE 3: MULTI-FACTOR SUCCESS EVIDENCE VALIDATION (STATE 4 AUTHORIZATION)
    # -------------------------------------------------------------------------
    if ($RollbackResult.Success -eq $true -and $RollbackResult.Status -eq "ROLLBACK_SUCCESS") {
        
        # 3A. RestoredHash Presence Check
        if ([string]::IsNullOrWhiteSpace($RollbackResult.RestoredHash)) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] RESTORED_HASH_MISSING: RestoredHash property is null or empty. Fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: RestoredHash is missing.")
        }

        # 3B. RestoredHash Format Validation
        if ($RollbackResult.RestoredHash -notmatch $sha256Regex) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] RESTORED_HASH_MALFORMED: RestoredHash [$($RollbackResult.RestoredHash)] is not a valid 64-char SHA-256 hex string. Fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: RestoredHash is malformed.")
        }

        # 3C. RestoredHash Equality against ExpectedBaselineHash
        if ($RollbackResult.RestoredHash -ine $ExpectedBaselineHash) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5C: $ContextName] RESTORED_HASH_MISMATCH: Restored configuration SHA-256 [$($RollbackResult.RestoredHash)] differs cryptographically from ExpectedBaselineHash [$ExpectedBaselineHash]. Verified hash mismatch — fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: RestoredHash mismatch against baseline.")
        }

        # 3D. DiscardBackup Property Presence Check
        if ([string]::IsNullOrWhiteSpace($RollbackResult.DiscardBackup)) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] DISCARD_PATH_MISSING: DiscardBackup property is null or empty. Fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: DiscardBackup property is missing.")
        }

        $discardPath = $RollbackResult.DiscardBackup

        # 3E. Discard Existence & Attributes Inspection via BCL GetAttributes
        $attr = [System.IO.FileAttributes]::Normal
        try {
            $attr = [System.IO.File]::GetAttributes($discardPath)
        }
        catch [System.IO.FileNotFoundException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5C: $ContextName] DISCARD_FILE_ABSENT: Discard backup file [$discardPath] does not exist on disk. Fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard file absent from disk.")
        }
        catch [System.IO.DirectoryNotFoundException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5C: $ContextName] DISCARD_DIRECTORY_MISSING: Discard backup directory path does not exist. Fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard directory missing.")
        }
        catch [System.IO.PathTooLongException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] DISCARD_PATH_INVALID: Discard path exceeds system length limit: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard path too long.")
        }
        catch [System.ArgumentException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] DISCARD_PATH_INVALID: Discard path contains invalid characters: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard path invalid.")
        }
        catch [System.UnauthorizedAccessException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5B: $ContextName] DISCARD_ATTRIBUTES_ACCESS_DENIED: Access denied inspecting discard attributes: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard attribute access denied.")
        }
        catch [System.IO.IOException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5B: $ContextName] DISCARD_ATTRIBUTES_LOCKED: Sharing violation inspecting discard attributes: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard attribute sharing violation.")
        }
        catch {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5F: $ContextName] DISCARD_ATTRIBUTES_QUERY_THREW: GetAttributes threw unexpected exception: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard GetAttributes threw an exception.")
        }

        # 3E-1. Reject Directory Containers
        if (($attr -band [System.IO.FileAttributes]::Directory) -ne 0) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5C: $ContextName] DISCARD_PATH_NOT_LEAF_FILE: Discard backup path [$discardPath] is a directory container, not a file. Fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard path is a directory container.")
        }

        # 3E-2. Reject Reparse Points (Symbolic Links, Junctions, Placeholders)
        if (($attr -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5C: $ContextName] DISCARD_PATH_REPARSE_POINT: Discard backup path [$discardPath] is a reparse point (symlink/junction). Quarantine artifact invalid — fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard path is a reparse point.")
        }

        # 3F. Discard Non-Zero Length Assertion via BCL FileInfo
        $discardLength = -1
        try {
            $fi = [System.IO.FileInfo]::new($discardPath)
            $discardLength = $fi.Length
        }
        catch [System.IO.FileNotFoundException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5C: $ContextName] DISCARD_FILE_DELETED_POST_STAT: Discard file was deleted between attribute check and size check. Fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard file deleted post-stat.")
        }
        catch [System.IO.PathTooLongException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] DISCARD_PATH_INVALID: Discard path too long during size query: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard path too long during size check.")
        }
        catch [System.ArgumentException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] DISCARD_PATH_INVALID: Invalid path argument during size query: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard argument invalid during size check.")
        }
        catch [System.UnauthorizedAccessException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5B: $ContextName] DISCARD_STAT_ACCESS_DENIED: Access denied querying discard file length: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard stat access denied.")
        }
        catch [System.IO.IOException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5B: $ContextName] DISCARD_STAT_LOCKED: Sharing violation querying discard file length: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard stat locked.")
        }
        catch {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5F: $ContextName] DISCARD_STAT_QUERY_THREW: FileInfo inspection threw an exception: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard stat query threw.")
        }

        if ($discardLength -le 0) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5C: $ContextName] DISCARD_FILE_EMPTY: Discard backup file [$discardPath] is 0 bytes. Quarantine artifact corrupt — fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard file is 0 bytes.")
        }

        # 3G. Independent Discard Cryptographic Hash Calculation (Hardened 8-Way Ladder)
        $discardHashInfo = $null
        try {
            $discardHashInfo = Get-SafeFileHashV4 -FilePath $discardPath
        }
        catch {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5F: $ContextName] DISCARD_HASH_QUERY_THREW: Hash query on discard backup threw an exception: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard hash query threw an exception.")
        }

        if ($discardHashInfo -eq $null -or $discardHashInfo.Status -eq $null) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] DISCARD_HASH_NULL_RESULT: Discard hash query returned null object or null status property. Fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard hash returned null.")
        }

        switch ($discardHashInfo.Status) {
            "HASH_READ_FAILED" {
                $innerEx = $discardHashInfo.Error

                # Ladder Step 1: Null Error Metadata (Helper defect -> State 5D)
                if ($innerEx -eq $null) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                        -Detail "[STATE 5D: $ContextName] DISCARD_HASH_ERROR_METADATA_MISSING: Status is HASH_READ_FAILED, but Error property is null. Indeterminate — fail-closed."
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard hash error metadata missing.")
                }

                # Ladder Step 2: Confirmed File Absence (Derived from IOException -> State 5C)
                elseif ($innerEx -is [System.IO.FileNotFoundException]) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5C: $ContextName] DISCARD_FILE_DELETED_PRE_HASH: Discard file disappeared before stream open: $($innerEx.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard file deleted pre-hash.")
                }

                # Ladder Step 3: Confirmed Directory Absence (Derived from IOException -> State 5C)
                elseif ($innerEx -is [System.IO.DirectoryNotFoundException]) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5C: $ContextName] DISCARD_DIRECTORY_DELETED_PRE_HASH: Discard parent directory disappeared before stream open: $($innerEx.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard directory deleted pre-hash.")
                }

                # Ladder Step 4: Path Too Long (Derived from IOException -> State 5D)
                elseif ($innerEx -is [System.IO.PathTooLongException]) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5D: $ContextName] DISCARD_HASH_PATH_TOO_LONG: Discard path exceeds system length limit during stream open: $($innerEx.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard path too long during stream open.")
                }

                # Ladder Step 5: Argument Syntax Error (Derived from SystemException -> State 5D)
                elseif ($innerEx -is [System.ArgumentException]) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5D: $ContextName] DISCARD_HASH_ARGUMENT_INVALID: Invalid path argument during stream open: $($innerEx.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard argument invalid during stream open.")
                }

                # Ladder Step 6: Permissions Restriction (Sibling of IOException -> State 5B)
                elseif ($innerEx -is [System.UnauthorizedAccessException]) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5B: $ContextName] DISCARD_FILE_ACCESS_DENIED: Access denied opening discard file: $($innerEx.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard file access denied.")
                }

                # Ladder Step 7: Genuine Sharing Violation / Lock (Base IOException -> State 5B)
                elseif ($innerEx -is [System.IO.IOException]) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5B: $ContextName] DISCARD_FILE_LOCKED: Sharing violation opening discard file: $($innerEx.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard file locked.")
                }

                # Ladder Step 8: Unexpected Exception Type (Tooling / runtime fault -> State 5F)
                else {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5F: $ContextName] DISCARD_HASH_UNEXPECTED_ERROR_TYPE: Unrecognized error type [$($innerEx.GetType().FullName)]: $($innerEx.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard hash helper returned unexpected exception type.")
                }
            }
            "HELPER_EXCEPTION" {
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                    -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                    -InitialError $TriggerError -HashInspectionError $discardHashInfo.Error -RollbackResult $RollbackResult `
                    -Detail "[STATE 5F: $ContextName] DISCARD_HELPER_EXCEPTION: Hash helper failed on discard backup: $($discardHashInfo.Message)"
                throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard helper exception.")
            }
            "HASH_VERIFIED" {
                # 3G-1. Discard Hash Metadata Presence Check
                if ([string]::IsNullOrWhiteSpace($discardHashInfo.Hash)) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                        -Detail "[STATE 5D: $ContextName] DISCARD_HASH_METADATA_MISSING: Helper returned HASH_VERIFIED, but Hash property is null or empty. Fail-closed."
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard hash property is missing.")
                }

                # 3G-2. Discard Hash Metadata Format Validation
                if ($discardHashInfo.Hash -notmatch $sha256Regex) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                        -Detail "[STATE 5D: $ContextName] DISCARD_HASH_METADATA_MALFORMED: Helper returned HASH_VERIFIED, but Hash [$($discardHashInfo.Hash)] is not a valid 64-char SHA-256 hex string. Fail-closed."
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard hash property is malformed.")
                }

                # 3G-3. Strict Cryptographic Equality Check against Trusted Trigger Hash
                if ($discardHashInfo.Hash -ine $ExpectedTriggerHash) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                        -Detail "[STATE 5C: $ContextName] VERIFIED_HASH_MISMATCH: Discard SHA-256 [$($discardHashInfo.Hash)] differs cryptographically from trusted trigger hash [$ExpectedTriggerHash]. Fail-closed."
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard hash mismatch against trusted trigger hash.")
                }
            }
            default {
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                    -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                    -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                    -Detail "[STATE 5D: $ContextName] DISCARD_HASH_UNKNOWN_STATUS: Discard hash query returned unknown status [$($discardHashInfo.Status)]. Fail-closed."
                throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard hash unknown status.")
            }
        }

        # ALL EVIDENCE CHECKS STRICTLY SATISFIED -> STATE 4 / OUTCOME 4 AUTHORIZED
        Write-Host "[OUTCOME 4: ROLLBACK SUCCESS] Original configuration verified and restored [SHA256: $($RollbackResult.RestoredHash)]." -ForegroundColor Yellow
        Write-Host "[OUTCOME 4: ARTIFACT STATUS] Golden backup [$GoldenBackupPath] and Discard backup [$discardPath] independently verified on disk." -ForegroundColor Yellow
        throw "FAIL-CLOSED ABORT [OUTCOME 4]: $ContextName failed ($($TriggerError.Message)), but rollback successfully restored original configuration. Live service safe."
    }

    # -------------------------------------------------------------------------
    # STAGE 4: FAILURE PATHS — STATUS STRING VALIDATION
    # -------------------------------------------------------------------------
    $rbStatus = $RollbackResult.Status

    if ([string]::IsNullOrEmpty($rbStatus)) {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
            -Detail "[STATE 5D: $ContextName] ROLLBACK_RESULT_NULL_STATUS: Rollback engine returned null or empty status string. Indeterminate — fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Rollback Status property is null or empty.")
    }

    # -------------------------------------------------------------------------
    # STAGE 5: EXHAUSTIVE STATUS-TO-STATE SWITCH (54 FAILURE STATUSES)
    # -------------------------------------------------------------------------
    switch ($rbStatus) {
        # STATE 5A: TARGET FILE CONFIRMED MISSING (3 STATUSES)
        { $_ -in @("ROLLBACK_DEST_MISSING", "PRE_ROLLBACK_LIVE_MISSING", "RESTORED_FILE_MISSING") } {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5A: $ContextName] Live destination file confirmed missing ($rbStatus): $($RollbackResult.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Handled State 5A ($rbStatus).")
        }

        # STATE 5B: TARGET FILE PRESENT BUT UNREADABLE (3 STATUSES)
        { $_ -in @("ROLLBACK_DEST_UNREADABLE", "PRE_ROLLBACK_LIVE_UNREADABLE", "RESTORED_FILE_UNREADABLE") } {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $RollbackResult.Error -RollbackResult $RollbackResult `
                -Detail "[STATE 5B: $ContextName] Live destination file present but unreadable ($rbStatus): $($RollbackResult.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Handled State 5B ($rbStatus).")
        }

        # STATE 5C: ROLLBACK MECHANICALLY FAILED (17 STATUSES)
        { $_ -in @(
            "GOLDEN_BACKUP_MISSING", "GOLDEN_BACKUP_UNREADABLE", "GOLDEN_BACKUP_HASH_MISMATCH",
            "ROLLBACK_DEST_TRIGGER_MISMATCH", "DISCARD_CAPTURE_READ_FAILED", "DISCARD_CAPTURE_FAILED",
            "DISCARD_FILE_MISSING", "DISCARD_FILE_UNREADABLE", "DISCARD_HASH_MISMATCH",
            "SACRIFICIAL_CLONE_READ_FAILED", "SACRIFICIAL_CLONE_CREATION_FAILED", "SACRIFICIAL_CLONE_MISSING",
            "SACRIFICIAL_CLONE_UNREADABLE", "SACRIFICIAL_CLONE_HASH_MISMATCH", "LIVE_MUTATED_POST_DISCARD",
            "ROLLBACK_SWAP_EXCEPTION", "RESTORED_HASH_MISMATCH"
        ) } {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5C: $ContextName] Rollback execution mechanically failed ($rbStatus): $($RollbackResult.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Handled State 5C ($rbStatus).")
        }

        # STATE 5D: INDETERMINATE NULL / UNKNOWN STATUS (18 STATUSES)
        { $_ -in @(
            "GOLDEN_BACKUP_NULL_RESULT", "GOLDEN_BACKUP_NULL_STATUS", "GOLDEN_BACKUP_UNKNOWN_STATUS",
            "ROLLBACK_DEST_NULL_RESULT", "ROLLBACK_DEST_NULL_STATUS", "ROLLBACK_DEST_UNKNOWN_STATUS",
            "DISCARD_NULL_RESULT", "DISCARD_NULL_STATUS", "DISCARD_UNKNOWN_STATUS",
            "SACRIFICIAL_CLONE_NULL_RESULT", "SACRIFICIAL_CLONE_NULL_STATUS", "SACRIFICIAL_CLONE_UNKNOWN_STATUS",
            "PRE_ROLLBACK_LIVE_NULL_RESULT", "PRE_ROLLBACK_LIVE_NULL_STATUS", "PRE_ROLLBACK_LIVE_UNKNOWN_STATUS",
            "RESTORED_NULL_RESULT", "RESTORED_NULL_STATUS", "RESTORED_UNKNOWN_STATUS"
        ) } {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] Rollback returned null/unknown status string ($rbStatus): $($RollbackResult.Message). Indeterminate — fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Handled State 5D ($rbStatus).")
        }

        # STATE 5E: ROLLBACK BYTE VERIFICATION FAILED (1 STATUS)
        "ROLLBACK_BYTE_VERIFY_FAILED" {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5E: $ContextName] Rollback restored baseline hash, but byte integrity verification failed: $($RollbackResult.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Handled State 5E ($rbStatus).")
        }

        # STATE 5F: TOOLING / HELPER / QUERY EXCEPTION (12 STATUSES)
        { $_ -in @(
            "GOLDEN_BACKUP_QUERY_THREW", "GOLDEN_BACKUP_HELPER_EXCEPTION", "ROLLBACK_DEST_QUERY_THREW",
            "ROLLBACK_DEST_HELPER_EXCEPTION", "DISCARD_QUERY_THREW", "DISCARD_HELPER_EXCEPTION",
            "SACRIFICIAL_CLONE_QUERY_THREW", "SACRIFICIAL_CLONE_HELPER_EXCEPTION", "PRE_ROLLBACK_LIVE_QUERY_THREW",
            "PRE_ROLLBACK_LIVE_HELPER_EXCEPTION", "RESTORED_QUERY_THREW", "RESTORED_HELPER_EXCEPTION"
        ) } {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $RollbackResult.Error -RollbackResult $RollbackResult `
                -Detail "[STATE 5F: $ContextName] Tooling/helper exception during rollback ($rbStatus): $($RollbackResult.Message). Indeterminate — fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Handled State 5F ($rbStatus).")
        }

        # DEFAULT CATCH-ALL: UNRECOGNIZED STATUS STRING (STATE 5D)
        default {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] UNRECOGNIZED_STATUS: Rollback returned unknown status string '$rbStatus'. Indeterminate — fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Unrecognized status string ($rbStatus).")
        }
    }
}
```

---

## 7. Discard Outcome Architecture & State Mapping Taxonomy (31-Class)

The discard artifact validation architecture is expanded from 28 to **31 discrete operational outcomes**:

| Outcome ID | Concrete Physical Condition on Disk / Memory | Exception / Status Trapped | Target State | Terminal Action | Diagnostic Classification |
|---|---|---|---|---|---|
| **DISC-01** | Discard path parameter missing or empty | `$RollbackResult.DiscardBackup` is `$null`/whitespace | **State 5D** | Local Terminal Throw | Metadata omission in engine return object. |
| **DISC-02** | Discard file absent from disk | `GetAttributes` throws `FileNotFoundException` | **State 5C** | Local Terminal Throw | Confirmed physical absence of quarantine file. |
| **DISC-03** | Discard directory container absent | `GetAttributes` throws `DirectoryNotFoundException`| **State 5C** | Local Terminal Throw | Parent directory missing; structural mechanical failure. |
| **DISC-04** | Discard path exceeds system length limit | `GetAttributes` throws `PathTooLongException` | **State 5D** | Local Terminal Throw | Indeterminate path syntax (precedes `IOException`). |
| **DISC-05** | Discard path contains invalid characters | `GetAttributes` throws `ArgumentException` | **State 5D** | Local Terminal Throw | Indeterminate path syntax. |
| **DISC-06** | Discard attributes access denied | `GetAttributes` throws `UnauthorizedAccessException`| **State 5B** | Local Terminal Throw | Permissions restriction; file present but inaccessible. |
| **DISC-07** | Discard attributes locked by external process | `GetAttributes` throws `IOException` | **State 5B** | Local Terminal Throw | Sharing violation / lock. NOT corruption. |
| **DISC-08** | `GetAttributes` throws unexpected CLR exception | Trapped in general `catch` block | **State 5F** | Local Terminal Throw | Tooling / OS exception inspecting attributes. |
| **DISC-09** | Discard path is a directory container | `($attr -band Directory) -ne 0` | **State 5C** | Local Terminal Throw | Artifact is a directory container, not a leaf file. |
| **DISC-10** | Discard path is a reparse point (symlink/junction)| `($attr -band ReparsePoint) -ne 0` | **State 5C** | Local Terminal Throw | Reparse point aliases external location. |
| **DISC-11** | Discard deleted between attribute and size checks | `FileInfo.Length` throws `FileNotFoundException` | **State 5C** | Local Terminal Throw | Mid-flight deletion race; file vanished post-stat. |
| **DISC-12** | Discard path exceeds limit on size query | `FileInfo.Length` throws `PathTooLongException` | **State 5D** | Local Terminal Throw | Path buffer error on size check. |
| **DISC-13** | Discard size query argument syntax error | `FileInfo.Length` throws `ArgumentException` | **State 5D** | Local Terminal Throw | Path argument syntax error on size check. |
| **DISC-14** | Discard size query access denied | `FileInfo.Length` throws `UnauthorizedAccessException`| **State 5B** | Local Terminal Throw | Permissions denied during size query. |
| **DISC-15** | Discard size query encounters sharing violation | `FileInfo.Length` throws `IOException` | **State 5B** | Local Terminal Throw | File locked by scanner during size check. |
| **DISC-16** | Discard size query throws unexpected exception | `FileInfo.Length` throws general exception | **State 5F** | Local Terminal Throw | Tooling / OS exception querying size. |
| **DISC-17** | Discard file is empty (0 bytes) | `$discardLength -le 0` | **State 5C** | Local Terminal Throw | Truncated or empty quarantine artifact. |
| **DISC-18** | Discard hash query threw CLR exception | Trapped in outer `try/catch` wrapping helper | **State 5F** | Local Terminal Throw | Tooling execution fault during hash invocation. |
| **DISC-19** | Discard hash helper returned null object/status | `$discardHashInfo -eq $null` or `Status -eq $null` | **State 5D** | Local Terminal Throw | Indeterminate metadata from helper. |
| **DISC-20** | Discard file deleted before stream open | Helper `HASH_READ_FAILED` (Inner: `FileNotFound`) | **State 5C** | Local Terminal Throw | Mid-flight file deletion race before stream open. |
| **DISC-21** | Discard directory deleted before stream open | Helper `HASH_READ_FAILED` (Inner: `DirectoryNotFound`)| **State 5C** | Local Terminal Throw | Mid-flight directory deletion race before stream open. |
| **DISC-22** | Discard path too long during stream open | Helper `HASH_READ_FAILED` (Inner: `PathTooLong`) | **State 5D** | Local Terminal Throw | Path length overflow during stream open. |
| **DISC-23** | Discard argument syntax invalid during stream open| Helper `HASH_READ_FAILED` (Inner: `ArgumentException`)| **State 5D** | Local Terminal Throw | Argument/syntax error during stream open. |
| **DISC-24** | Discard access denied during stream open | Helper `HASH_READ_FAILED` (Inner: `Unauthorized`) | **State 5B** | Local Terminal Throw | Permissions restriction opening stream. |
| **DISC-25** | Discard locked during stream open | Helper `HASH_READ_FAILED` (Inner: `IOException`) | **State 5B** | Local Terminal Throw | Sharing lock opening stream. |
| **DISC-26** | Discard hash read failed with null inner error | Helper `HASH_READ_FAILED` (Inner: `$null`) | **State 5D** | Local Terminal Throw | Missing error metadata in helper response. |
| **DISC-27** | Discard hash read failed with unexpected type | Helper `HASH_READ_FAILED` (Inner: Unrecognized)| **State 5F** | Local Terminal Throw | Unrecognized CLR exception type in helper response. |
| **DISC-28** | Hash helper encounters internal failure | Helper returns `HELPER_EXCEPTION` | **State 5F** | Local Terminal Throw | Helper reported internal execution fault. |
| **DISC-29** | Discard hash metadata missing on verified status | Status is `HASH_VERIFIED`, but `Hash` is null/empty | **State 5D** | Local Terminal Throw | Helper metadata defect; NOT proven corruption. |
| **DISC-30** | Discard hash metadata malformed on verified status | Status is `HASH_VERIFIED`, but `Hash` not 64-hex | **State 5D** | Local Terminal Throw | Helper metadata defect; NOT proven corruption. |
| **DISC-31** | Discard cryptographic comparison | Digest is valid 64-hex; compared to Trigger Hash | **State 5C / 4** | Branching Throw | Mismatch $\rightarrow$ `VERIFIED_HASH_MISMATCH` (5C); Match $\rightarrow$ State 4. |

---

## 8. Revised Test Matrix & Reconciled 4-Dimensional Counts

### 8.1 Newly Added Outer-Dispatch Test Specifications (DSP-111 through DSP-115)

To provide exhaustive test specification coverage for all findings in Step AO-Y, five new test specifications are added to the outer-dispatch test suite:

| Test ID | Input Scenario / Failure Injection | Expected Result Flag | Dispatch Path / Trigger | Target State | Mapped Diagnostic State | Expected Control Flow | Physical Disk State Guarantee |
|---|---|---|---|---|---|---|---|
| **DSP-111**| `HASH_READ_FAILED` with `DirectoryNotFoundException` | `$true` | Trapped by `$innerEx -is [DirectoryNotFoundException]` | **State 5C** | 5C | Local Throw | Candidate: Retained; Backup: Retained; Discard: Directory Deleted Pre-Hash; Live: Restored. NOT false 5B. |
| **DSP-112**| `HASH_READ_FAILED` with `PathTooLongException` | `$true` | Trapped by `$innerEx -is [PathTooLongException]` | **State 5D** | 5D | Local Throw | Candidate: Retained; Backup: Retained; Discard: Path Too Long Pre-Hash; Live: Restored. NOT false 5B. |
| **DSP-113**| `HASH_READ_FAILED` with `ArgumentException` | `$true` | Trapped by `$innerEx -is [ArgumentException]` | **State 5D** | 5D | Local Throw | Candidate: Retained; Backup: Retained; Discard: Argument Invalid Pre-Hash; Live: Restored. NOT false 5F. |
| **DSP-114**| Exception inheritance regression: Derived types vs `IOException` | `$true` | Verified that derived types match prior to base `IOException` | **State 5C/5D**| 5C/5D | Local Throw | Formal proof that no derived `IOException` type is shadowed by base `IOException`. |
| **DSP-115**| Separation of thrown CLR exception vs returned metadata | `$true` | Helper throws unhandled exception $\rightarrow$ caught in outer catch | **State 5F** | 5F | Local Throw | Candidate: Retained; Backup: Retained; Discard: Thrown Exception Handled; Live: Restored. State 5F isolated. |

### 8.2 Complete 4-Dimensional Engineering Accounting Model

#### Dimension 1: Syntactic AST Decision Points
- Pre-Flight Replacement Engine (PF-0 through PF-4B): **41 decision points**
- Replacement Swap & Post-Swap Live Inspection (Stages 2–3): **17 decision points**
- Recovery Boundary Non-Mutating Diagnostics: **7 decision points**
- Dispatcher V25 Decision Points: **49 decision points**
  - Stage 0: 4 checks (Baseline null/whitespace, Baseline regex, Trigger null/whitespace, Trigger regex)
  - Stage 1: 1 check (RollbackResult null)
  - Stage 2: 2 contradiction traps
  - Stage 3: 35 evidence checks & try/catch branches
    - RestoredHash checks: null (1), regex (1), equality (1) = 3
    - DiscardPath check: null (1)
    - GetAttributes try/catch: 7 typed catch branches + Directory bitmask (1) + Reparse bitmask (1) = 9
    - FileInfo.Length try/catch: 6 typed catch branches + length <= 0 (1) = 7
    - Hash calculation: try/catch (1), null check (1), switch with 8-way inner exception ladder (8), helper exception (1), hash null (1), hash regex (1), hash equality (1), switch default (1) = 15
  - Stage 4: 1 check (rbStatus null/empty)
  - Stage 5: 6 switch branches across 54 failure statuses
- **Total Syntactic AST Decision Points:** $41 + 17 + 7 + 49 = \mathbf{114 \text{ decision points}}$.

#### Dimension 2: Semantic Pipeline Outcome Paths
- Pre-Flight Replacement Outcomes: **50 semantic paths**
- Replacement Swap & Post-Swap Live Barrier Outcomes: **19 semantic paths**
- Rollback Engine Internal Return Paths: **55 return paths**
- Recovery Diagnostic Outcomes: **7 diagnostic paths**
- Outer Dispatcher Discard Validation Outcome Paths: **31 distinct paths** (DISC-01 through DISC-31)
- **Total Semantic Pipeline Outcome Paths:** $50 + 19 + 55 + 7 + 31 = \mathbf{162 \text{ paths}}$.

#### Dimension 3: Defined Test Specifications
- Replacement Pre-Flight & Promotion Suite: TEST-01 through TEST-34 (**34 specifications**)
- Outer-Dispatch Integrity Suite: DSP-01 through DSP-115 (**115 specifications**)
- Recovery Diagnostic Suite: REC-01 through REC-07 (**7 specifications**)
- **Total Test Specifications Defined:** $34 + 115 + 7 = \mathbf{156 \text{ test specifications}}$.

#### Dimension 4: Executed Operational Tests
- **Executed Operational Tests:** **ZERO (0).**  
  All 156 test specifications are strictly marked **[NOT EXECUTED — UNTESTED]**.

---

## 9. Open Blockers & Residual Risks

### 9.1 Active Open Blockers

1. **BLOCKER-1: Missing Manual Restoration Protocol Runbook (`docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md`):**  
   - Direct read-only filesystem assertion in Step AO confirmed `Test-Path` returned `False`.
   - **Status:** ACTIVE OPEN BLOCKER.
   - **Policy:** Step AP must NOT be initiated, and live restoration must NOT be authorized in this step. Authoring and reviewing the manual runbook remains a mandatory prerequisite for Gate 5/6 human sign-off.
2. **BLOCKER-2: Operational Implementation Authorization Pending:**  
   - Zero operational execution is permitted until human approval is formally recorded.
3. **BLOCKER-3: Inherent Windows User-Mode TOCTOU Windows:**  
   - Four distinct Windows user-mode filesystem race windows cannot be eliminated in software:
     - Window A: Gap between caller live measurement and rollback discard capture.
     - Window B: Gap between handle closure and `ReplaceFileW` acquisition during swap.
     - Window C: Gap between discard attribute inspection, size inspection, and stream open.
     - Window D: Gap between discard hash stream closure and post-evaluation archival.
   - All four are mitigated to fail-closed aborts, but zero race windows can be claimed as eliminated.
4. **BLOCKER-4: Standalone Migration Runner Absence:**  
   - CLI migration runner with pre-flight database assertions has not yet been authored.
5. **BLOCKER-5: Role Creation Interactive Credential Policy:**  
   - Interactive console `\password zentra_dev` prompt required to preserve zero-plaintext credential standard.

### 9.2 Residual Risks

- **UNVERIFIED: Antivirus / Endpoint Detection and Response (EDR) File Interception:**  
  Real-time antivirus filters frequently lock newly created `.discard` and `.golden` files during quarantine scanning. `Dispatch-RollbackResultV25` safely handles this via CLR exception trapping routing to `DISCARD_ATTRIBUTES_LOCKED`, `DISCARD_STAT_LOCKED`, or `DISCARD_FILE_LOCKED` (State 5B), preventing false success or false corruption classification. However, operational retry timing under active corporate EDR policies remains unverified.

---

## 10. Explicit Execution-Status & Safety Confirmation

### 10.1 Precise Execution-Status Accounting

To maintain absolute transparency and compliance:

- **Operational Procedures & Scripts:** **ZERO (0) EXECUTED.**  
  `Dispatch-RollbackResultV25`, `Invoke-SafeConfigReplacementV17`, `Invoke-ControlledRollbackV15`, `Enter-ManualRecoveryBoundaryV14`, and all 156 test specifications are strictly **[NOT EXECUTED — UNTESTED]**.
- **Read-Only Diagnostic Commands:** **ZERO (0)** commands were executed in Step AO-Y.
  (In Step AO, exactly one diagnostic command was run: `powershell -Command "Test-Path -Path 'docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md'"` returning `False`).
- **Host & Database Alterations:** **ZERO (0).** No configuration files (`postgresql.conf`, `pg_hba.conf`), Windows Firewall rules, Windows services, application code, or `.env` files were modified. No databases, schemas, tables, roles, or records were created, altered, or dropped.
- **Cloud Connections:** **ZERO (0).** No connections made to Neon, AWS, Supabase, Render, or any remote infrastructure.
- **Budget Preservation:** Strict ₹0/month budget preserved.
- **Preserved Application Databases:** Catalogs `hisecure_erp`, `hitech_platform`, and `zentra_test` remain completely untouched.

---

```
STOP — STEP 2D-2A-AO-Y COMPLETE — WAITING FOR HUMAN REVIEW
```
