# MUSE SPARK — ZENTRA STEP 2D-2A-AO-W
## EXCEPTION PRECEDENCE & HASH METADATA VALIDATION AUDIT REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Target Repository:** `D:\Zentra`  
**Input Reference:** [`docs/MUSE_SPARK_STEP2D_2A_AO_V_FILESYSTEM_ERROR_CLASSIFICATION_AUDIT_REPORT.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_AO_V_FILESYSTEM_ERROR_CLASSIFICATION_AUDIT_REPORT.md)  
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

A deep-level runtime and language specification audit of the Step 2D-2A-AO-V report (`Dispatch-RollbackResultV22`) identified two critical architectural defects in exception containment and cryptographic metadata validation:

1. **CLR Exception Inheritance & Catch Ordering Defect:**  
   In `Dispatch-RollbackResultV22`, Stage 3E placed `catch [System.IO.IOException]` *before* `catch [System.IO.PathTooLongException]`. Under the official Microsoft .NET Base Class Library (BCL) type system, `System.IO.PathTooLongException` derives directly from `System.IO.IOException`. Because PowerShell evaluates `catch` blocks sequentially from top to bottom, any `PathTooLongException` thrown during attribute inspection was intercepted prematurely by `catch [System.IO.IOException]`.  
   **Diagnostic Impact:** A structural path syntax/length defect was misclassified as `DISCARD_ATTRIBUTES_LOCKED` (**State 5B: file locked / sharing violation**), while the intended `catch [System.IO.PathTooLongException]` block remained **unreachable dead code**.
2. **Unvalidated Hash Metadata on `HASH_VERIFIED` Status:**  
   In Stage 3G of `Dispatch-RollbackResultV22`, upon receiving `Status = "HASH_VERIFIED"` from `Get-SafeFileHashV4`, the dispatcher immediately evaluated equality:  
   `if ($discardHashInfo.Hash -ine $ExpectedTriggerHash) { ... State 5C: DISCARD_HASH_MISMATCH ... }`.  
   If the helper returned `$null`, an empty string, or malformed non-hex metadata while claiming `HASH_VERIFIED`, the inequality check evaluated to `$true`.  
   **Diagnostic Impact:** Helper defect or corrupted metadata was falsely classified as **`DISCARD_HASH_MISMATCH` (State 5C - proven physical payload corruption on disk)** rather than an indeterminate helper failure (**State 5D**). State 5C must be strictly reserved for verified, well-formed 64-hex SHA-256 digests that disagree cryptographically with the expected value.

This report, **Step 2D-2A-AO-W**, provides the definitive architectural remediation:
- Corrects CLR exception catch ordering across all filesystem inspection stages, placing specific derived types (`FileNotFoundException`, `DirectoryNotFoundException`, `PathTooLongException`, `UnauthorizedAccessException`, `ArgumentException`) strictly ahead of base `IOException` and `Exception`.
- Specifies **`Dispatch-RollbackResultV23`**, adding strict 64-character SHA-256 regex and null validation to `$discardHashInfo.Hash` before cryptographic equality testing, mapping metadata omissions to **State 5D** (`DISCARD_HASH_METADATA_MISSING` / `DISCARD_HASH_METADATA_MALFORMED`).
- Expands the discard outcome architecture to a **25-class taxonomy (DISC-01 through DISC-25)**.
- Expands the outer-dispatch test suite to **104 exhaustive test specifications (DSP-01 through DSP-104)**, bringing the total system test specification count to **145 specifications**, all strictly marked `NOT EXECUTED — UNTESTED`.

> [!IMPORTANT]
> **Strict Documentation Boundary:** All operational scripts, procedures, and test specifications documented in this report are strictly **[NOT EXECUTED — UNTESTED]**. Zero operational commands of any kind were executed. Zero operational files (`postgresql.conf`, `pg_hba.conf`), Windows Firewall rules, Windows services, application source files, `.env` files, or databases were modified.

---

## 2. Findings with Exact AO-V Section & Line References

| Finding ID | Location in AO-V Report | Defect / Vulnerability Description | Technical Impact | Mandatory Correction in Step AO-W |
|---|---|---|---|---|
| **FIND-AW1** | `Dispatch-RollbackResultV22`<br/>Lines 216–224 | **Catch Block Shadowing (`PathTooLongException`):** `catch [System.IO.IOException]` was positioned before `catch [System.IO.PathTooLongException]`. Since `PathTooLongException` derives from `IOException`, it is caught by `IOException`. | Dead-code catch block. Long path errors are misclassified as `DISCARD_ATTRIBUTES_LOCKED` (State 5B) rather than `DISCARD_PATH_INVALID` (State 5D). | Reorder catch blocks: place `PathTooLongException` strictly before `IOException` in both attribute and size inspection. |
| **FIND-AW2** | `Dispatch-RollbackResultV22`<br/>Lines 296–304 | **Unvalidated Hash Metadata on `HASH_VERIFIED`:** Stage 3G tests `$discardHashInfo.Hash -ine $ExpectedTriggerHash` without validating whether `$discardHashInfo.Hash` is null, empty, or a valid 64-char hex string. | Null, empty, or truncated hash strings evaluate as not equal, falsely reporting on-disk file corruption (State 5C) instead of helper metadata defect (State 5D). | Assert `$discardHashInfo.Hash` is non-empty and matches `^[A-Fa-f0-9]{64}$` before equality check. Map metadata defects to State 5D. |
| **FIND-AW3** | `Dispatch-RollbackResultV22`<br/>Lines 254–268 | **Missing PathTooLong & ArgumentException Traps in Size Check:** `FileInfo.Length` catch blocks omitted explicit traps for `PathTooLongException` and `ArgumentException`. | Path length and syntax exceptions during size query fall into generic `IOException` (State 5B) or `Exception` (State 5F). | Add explicit `catch [System.IO.PathTooLongException]` and `catch [System.ArgumentException]` mapping to State 5D. |
| **FIND-AW4** | Section 7.1<br/>Lines 352–365 | **Outer-Dispatch Test Suite Coverage Gaps:** DSP suite ended at DSP-96, omitting tests for catch block precedence, null hash metadata on verified status, and malformed hash metadata. | Test matrix lacks verification for exception hierarchy ordering and metadata validation traps. | Expand DSP suite from 96 to 104 test specifications (DSP-01 through DSP-104). |

---

## 3. Finding 1 — Exception Inheritance & Catch Ordering Audit

### 3.1 The .NET BCL Exception Type Hierarchy in `System.IO`

In the Microsoft .NET Base Class Library, filesystem exceptions are arranged in a strict class hierarchy:

```
System.Object
  └── System.Exception
        └── System.SystemException
              ├── System.ArgumentException
              │     ├── System.ArgumentNullException
              │     └── System.ArgumentOutOfRangeException
              ├── System.UnauthorizedAccessException
              └── System.IO.IOException
                    ├── System.IO.FileNotFoundException
                    ├── System.IO.DirectoryNotFoundException
                    ├── System.IO.PathTooLongException  <-- DERIVED FROM IOException!
                    └── System.IO.EndOfStreamException
```

#### The Catch Ordering Principle in CLR and PowerShell

In PowerShell, `try { ... } catch [TypeA] { ... } catch [TypeB] { ... }` matches exceptions using standard CLR type assignment compatibility (`isinst` / `Type.IsAssignableFrom`).
- If an exception of type $T$ is thrown, the runtime tests each `catch` filter in lexical order.
- The **first** filter where `thrownException is FilterType` evaluates to `$true` is executed; all subsequent filters are bypassed.
- **Rule of Precedence:** A derived exception type **must always be caught before its base class**. If `catch [System.IO.IOException]` appears before `catch [System.IO.PathTooLongException]`, the derived filter is completely shadowed and dead code.

### 3.2 Audit of Catch Sequences in `Dispatch-RollbackResultV22`

#### Defective Ordering in AO-V (Stage 3E):
```powershell
# DEFECTIVE AO-V ORDERING:
catch [System.IO.FileNotFoundException] { ... }      # Ok: Derived from IOException
catch [System.IO.DirectoryNotFoundException] { ... } # Ok: Derived from IOException
catch [System.UnauthorizedAccessException] { ... }   # Ok: Sibling of IOException
catch [System.IO.IOException] { ... }                # BASE CLASS CAUGHT HERE!
catch [System.IO.PathTooLongException] { ... }       # DEAD CODE! SHADOWED BY IOException!
catch [System.ArgumentException] { ... }             # Sibling
catch { ... }                                        # Base Exception
```

#### Corrected Fail-Closed Ordering in AO-W (Stage 3E & 3F):
```powershell
# CORRECTED AO-W ORDERING:
# 1. Confirmed Missing Targets (Derived from IOException -> State 5C)
catch [System.IO.FileNotFoundException] { ... State 5C ... }
catch [System.IO.DirectoryNotFoundException] { ... State 5C ... }

# 2. Path Syntax & Length Violations (Must precede IOException -> State 5D)
catch [System.IO.PathTooLongException] { ... State 5D ... }
catch [System.ArgumentException] { ... State 5D ... }

# 3. Security & Permission Failures (Sibling of IOException -> State 5B)
catch [System.UnauthorizedAccessException] { ... State 5B ... }

# 4. Residual I/O Failures & Sharing Violations (Base Class -> State 5B)
catch [System.IO.IOException] { ... State 5B ... }

# 5. Unexpected / Runtime Faults (Catch-all Base -> State 5F)
catch { ... State 5F ... }
```

### 3.3 Precise State Mapping by Exception Class

| Exception Class Under Test | Inheritance Relationship | Target State | Mapped Diagnostic Reason | Technical Justification |
|---|---|---|---|---|
| `[System.IO.FileNotFoundException]` | Derived from `IOException` | **State 5C** | `DISCARD_FILE_ABSENT` | Confirmed absence of target file. |
| `[System.IO.DirectoryNotFoundException]` | Derived from `IOException` | **State 5C** | `DISCARD_DIRECTORY_MISSING` | Confirmed absence of parent folder. |
| `[System.IO.PathTooLongException]` | Derived from `IOException` | **State 5D** | `DISCARD_PATH_INVALID` | Path syntax exceeds OS buffer limit; indeterminate metadata. |
| `[System.ArgumentException]` | Derived from `SystemException` | **State 5D** | `DISCARD_PATH_INVALID` | Illegal characters, empty segments, device syntax. |
| `[System.UnauthorizedAccessException]` | Sibling of `IOException` | **State 5B** | `DISCARD_ATTRIBUTES_ACCESS_DENIED` | NTFS ACL denies read; file present but inaccessible. |
| `[System.IO.IOException]` | Base class for I/O errors | **State 5B** | `DISCARD_ATTRIBUTES_LOCKED` | Sharing violation, lock, or transient disk hold. NOT corruption. |
| `[System.Exception]` (Generic `catch`) | Root exception class | **State 5F** | `DISCARD_ATTRIBUTES_QUERY_THREW` | Unanticipated runtime or driver failure. |

---

## 4. Finding 2 — Hash Metadata Validation Audit

### 4.1 The Unvalidated Hash Defect in AO-V

In Stage 3G of `Dispatch-RollbackResultV22`, the dispatcher evaluated:
```powershell
switch ($discardHashInfo.Status) {
    "HASH_VERIFIED" {
        if ($discardHashInfo.Hash -ine $ExpectedTriggerHash) {
            Enter-ManualRecoveryBoundaryV14 ... -Detail "[STATE 5C: ...] DISCARD_HASH_MISMATCH: ..."
            throw [System.InvalidOperationException]::new("...")
        }
    }
}
```

#### Vulnerability Analysis:
1. If `Get-SafeFileHashV4` contains an internal bug or returns an object where `Status = "HASH_VERIFIED"`, but:
   - `Hash` is `$null`
   - `Hash` is `""` (empty string)
   - `Hash` is `"ERROR"`, `"FAILED"`, or a truncated non-hex string
2. The condition `$discardHashInfo.Hash -ine $ExpectedTriggerHash` evaluates to `$true` (since `$ExpectedTriggerHash` is a valid 64-char hex string).
3. The dispatcher enters the failure block and logs:  
   `[STATE 5C: ...] DISCARD_HASH_MISMATCH: Discard hash [] does not match trusted trigger hash... Content corrupt — fail-closed.`
4. **False Accusation of Corruption:** The engine falsely declares that the *quarantine file on disk is corrupt* (**State 5C**), when in reality the *hash helper emitted malformed metadata* (**State 5D**).

### 4.2 Hardened Multi-Stage Hash Metadata Verification

To maintain absolute diagnostic truth, `Dispatch-RollbackResultV23` implements a three-stage validation pipeline on `$discardHashInfo.Hash` before cryptographic comparison:

```
                             $discardHashInfo.Status == "HASH_VERIFIED"
                                                  |
                                                  v
                   +--------------------------------------------------------------+
                   | 1. Is Null or WhiteSpace?                                    |
                   |    YES -> State 5D: DISCARD_HASH_METADATA_MISSING             |
                   +--------------------------------------------------------------+
                                                  | NO
                                                  v
                   +--------------------------------------------------------------+
                   | 2. Matches ^[A-Fa-f0-9]{64}$ ?                               |
                   |    NO  -> State 5D: DISCARD_HASH_METADATA_MALFORMED          |
                   +--------------------------------------------------------------+
                                                  | YES (Well-formed 64-hex hash)
                                                  v
                   +--------------------------------------------------------------+
                   | 3. Cryptographic Equality: Hash -ine $ExpectedTriggerHash?   |
                   |    YES -> State 5C: DISCARD_HASH_MISMATCH (Genuine Mismatch) |
                   |    NO  -> Eligible for State 4 (Outcome 4: Success)          |
                   +--------------------------------------------------------------+
```

#### Full Audit of Hash Comparison Sites in the Pipeline

All four hash comparison sites across the pipeline are now validated with identical rigor:

1. **Caller Expected Baseline Hash (`Stage 0A`):** Must be non-whitespace and match `^[A-Fa-f0-9]{64}$` $\rightarrow$ Failure: **State 5D** (`BASELINE_HASH_MISSING` / `BASELINE_HASH_MALFORMED`).
2. **Caller Expected Trigger Hash (`Stage 0B`):** Must be non-whitespace and match `^[A-Fa-f0-9]{64}$` $\rightarrow$ Failure: **State 5D** (`TRIGGER_HASH_MISSING` / `TRIGGER_HASH_MALFORMED`).
3. **Rollback Result Restored Hash (`Stage 3A/3B/3C`):** Must be non-whitespace and match `^[A-Fa-f0-9]{64}$` $\rightarrow$ Failure: **State 5D** (`RESTORED_HASH_MISSING` / `RESTORED_HASH_MALFORMED`); equality mismatch: **State 5C** (`RESTORED_HASH_MISMATCH`).
4. **Discard Artifact Computed Hash (`Stage 3G`):** Must be non-whitespace and match `^[A-Fa-f0-9]{64}$` $\rightarrow$ Failure: **State 5D** (`DISCARD_HASH_METADATA_MISSING` / `DISCARD_HASH_METADATA_MALFORMED`); equality mismatch: **State 5C** (`DISCARD_HASH_MISMATCH`).

---

## 5. Finding 3 — Exception and Status Taxonomy (25-Class Model)

The discard artifact validation architecture is expanded from 22 to **25 discrete operational outcomes**:

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
| **DISC-13** | Discard size query encounters argument syntax error| `FileInfo.Length` throws `ArgumentException` | **State 5D** | Local Terminal Throw | Path argument syntax error on size check. |
| **DISC-14** | Discard size query access denied | `FileInfo.Length` throws `UnauthorizedAccessException`| **State 5B** | Local Terminal Throw | Permissions denied during size query. |
| **DISC-15** | Discard size query encounters sharing violation | `FileInfo.Length` throws `IOException` | **State 5B** | Local Terminal Throw | File locked by scanner during size check. |
| **DISC-16** | Discard size query throws unexpected exception | `FileInfo.Length` throws general exception | **State 5F** | Local Terminal Throw | Tooling / OS exception querying size. |
| **DISC-17** | Discard file is empty (0 bytes) | `$discardLength -le 0` | **State 5C** | Local Terminal Throw | Truncated or empty quarantine artifact. |
| **DISC-18** | Discard deleted before hash calculation stream open| Helper returns `HASH_READ_FAILED` (Inner: `FileNotFound`)| **State 5C** | Local Terminal Throw | Mid-flight deletion race before stream open. |
| **DISC-19** | Discard locked during hash calculation stream open | Helper returns `HASH_READ_FAILED` (Inner: `IOException`) | **State 5B** | Local Terminal Throw | Sharing lock during stream open. |
| **DISC-20** | Hash helper encounters internal exception | Helper returns `HELPER_EXCEPTION` | **State 5F** | Local Terminal Throw | Tooling execution fault inside helper. |
| **DISC-21** | Hash helper returns null object or status | `$discardHashInfo -eq $null` or `Status -eq $null` | **State 5D** | Local Terminal Throw | Indeterminate metadata from helper. |
| **DISC-22** | Discard hash calculation returns unknown status | Helper returns unrecognized status string | **State 5D** | Local Terminal Throw | Indeterminate status string from helper. |
| **DISC-23** | Discard hash metadata missing on verified status | Status is `HASH_VERIFIED`, but `Hash` is null/empty | **State 5D** | Local Terminal Throw | Helper metadata defect; NOT proven corruption. |
| **DISC-24** | Discard hash metadata malformed on verified status | Status is `HASH_VERIFIED`, but `Hash` not 64-hex | **State 5D** | Local Terminal Throw | Helper metadata defect; NOT proven corruption. |
| **DISC-25** | Discard cryptographic comparison | Digest is valid 64-hex; compared to Trigger Hash | **State 5C / 4** | Branching Throw | Disagreement $\rightarrow$ State 5C; Match $\rightarrow$ State 4. |

---

## 6. Hardened Operational Specification: `Dispatch-RollbackResultV23`

Below is the complete, hardened operational specification for `Dispatch-RollbackResultV23`, incorporating strict exception inheritance ordering, comprehensive hash metadata validation, and fail-closed terminal guards:

```powershell
# [NOT EXECUTED — UNTESTED OPERATIONAL PROCEDURE]

function Dispatch-RollbackResultV23 {
    <#
    .SYNOPSIS
        Outer rollback-result dispatcher with terminal fail-closed control flow,
        strict CLR exception inheritance ordering, rigorous cryptographic metadata
        validation, and exhaustive inter-step race containment.
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
                -Detail "[STATE 5C: $ContextName] RESTORED_HASH_MISMATCH: RestoredHash [$($RollbackResult.RestoredHash)] differs from ExpectedBaselineHash [$ExpectedBaselineHash]. Content corruption — fail-closed."
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
        # Catch ordering strictly adheres to .NET inheritance hierarchy
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
            # Must precede IOException; derived from IOException
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
            # Base class for remaining sharing violations and locked handles
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

        # 3F. Discard Non-Zero Length Assertion via BCL FileInfo (With Corrected Precedence)
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

        # 3G. Independent Discard Cryptographic Hash Calculation (Rigorous Metadata Validation)
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
                if ($innerEx -is [System.IO.FileNotFoundException]) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5C: $ContextName] DISCARD_FILE_DELETED_PRE_HASH: Discard file was deleted before hash calculation could open stream. Fail-closed."
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard file deleted pre-hash.")
                }
                else {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5B: $ContextName] DISCARD_FILE_UNREADABLE: Discard backup file is locked or unreadable: $($discardHashInfo.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard file unreadable.")
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
                        -Detail "[STATE 5C: $ContextName] DISCARD_HASH_MISMATCH: Discard hash [$($discardHashInfo.Hash)] does not match trusted trigger hash [$ExpectedTriggerHash]. Quarantine content corrupt — fail-closed."
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

## 7. Revised Test Matrix & Reconciled 4-Dimensional Counts

### 7.1 Newly Added Outer-Dispatch Test Specifications (DSP-97 through DSP-104)

To provide exhaustive test specification coverage for all findings in Step AO-W, eight new test specifications are added to the outer-dispatch test suite:

| Test ID | Input Scenario / Failure Injection | Expected Result Flag | Dispatch Path / Trigger | Target State | Mapped Diagnostic State | Expected Control Flow | Physical Disk State Guarantee |
|---|---|---|---|---|---|---|---|
| **DSP-97** | `PathTooLongException` precedence on attribute inspection | `$true` | Caught by `catch [PathTooLongException]` BEFORE `IOException` | **State 5D** | 5D | Local Throw | Candidate: Retained; Backup: Retained; Discard: Path Too Long; Live: Restored. NOT false 5B. |
| **DSP-98** | `ArgumentException` path syntax error on attribute inspection | `$true` | Caught by `catch [ArgumentException]` | **State 5D** | 5D | Local Throw | Candidate: Retained; Backup: Retained; Discard: Syntax Error; Live: Restored. |
| **DSP-99** | `PathTooLongException` on size inspection (`FileInfo.Length`)| `$true` | Caught by `catch [PathTooLongException]` BEFORE `IOException` | **State 5D** | 5D | Local Throw | Candidate: Retained; Backup: Retained; Discard: Path Too Long; Live: Restored. |
| **DSP-100**| `ArgumentException` on size inspection (`FileInfo.Length`)| `$true` | Caught by `catch [ArgumentException]` | **State 5D** | 5D | Local Throw | Candidate: Retained; Backup: Retained; Discard: Syntax Error; Live: Restored. |
| **DSP-101**| Discard hash helper returns `HASH_VERIFIED` with null Hash | `$true` | `IsNullOrWhiteSpace($discardHashInfo.Hash)` evaluates true | **State 5D** | 5D | Local Throw | Candidate: Retained; Backup: Retained; Discard: Metadata Missing; Live: Restored. NOT false 5C. |
| **DSP-102**| Discard hash helper returns `HASH_VERIFIED` with empty Hash string | `$true` | `IsNullOrWhiteSpace($discardHashInfo.Hash)` evaluates true | **State 5D** | 5D | Local Throw | Candidate: Retained; Backup: Retained; Discard: Metadata Missing; Live: Restored. NOT false 5C. |
| **DSP-103**| Discard hash helper returns `HASH_VERIFIED` with malformed Hash string | `$true` | `$discardHashInfo.Hash -notmatch '^[A-Fa-f0-9]{64}$'` | **State 5D** | 5D | Local Throw | Candidate: Retained; Backup: Retained; Discard: Metadata Malformed; Live: Restored. NOT false 5C. |
| **DSP-104**| Genuine cryptographic mismatch: Valid 64-hex discard != Trigger Hash | `$true` | All metadata valid; hashes differ cryptographically | **State 5C** | 5C | Local Throw | Candidate: Retained; Backup: Retained; Discard: Cryptographic Mismatch; Live: Restored. Proven 5C. |

### 7.2 Complete 4-Dimensional Engineering Accounting Model

#### Dimension 1: Syntactic AST Decision Points
- Pre-Flight Replacement Engine (PF-0 through PF-4B): **41 decision points**
- Replacement Swap & Post-Swap Live Inspection (Stages 2–3): **17 decision points**
- Recovery Boundary Non-Mutating Diagnostics: **7 decision points**
- Dispatcher V23 Decision Points: **43 decision points**
  - Stage 0: 4 checks (Baseline null/whitespace, Baseline regex, Trigger null/whitespace, Trigger regex)
  - Stage 1: 1 check (RollbackResult null)
  - Stage 2: 2 contradiction traps
  - Stage 3: 29 evidence checks & try/catch branches
    - RestoredHash checks: null (1), regex (1), equality (1) = 3
    - DiscardPath check: null (1)
    - GetAttributes try/catch: 7 typed catch branches + Directory bitmask (1) + Reparse bitmask (1) = 9
    - FileInfo.Length try/catch: 6 typed catch branches + length <= 0 (1) = 7
    - Hash calculation: try/catch (1), null check (1), switch with inner exception discrimination (2), helper exception (1), hash null (1), hash regex (1), hash equality (1), switch default (1) = 9
  - Stage 4: 1 check (rbStatus null/empty)
  - Stage 5: 6 switch branches across 54 failure statuses
- **Total Syntactic AST Decision Points:** $41 + 17 + 7 + 43 = \mathbf{108 \text{ decision points}}$.

#### Dimension 2: Semantic Pipeline Outcome Paths
- Pre-Flight Replacement Outcomes: **50 semantic paths**
- Replacement Swap & Post-Swap Live Barrier Outcomes: **19 semantic paths**
- Rollback Engine Internal Return Paths: **55 return paths**
- Recovery Diagnostic Outcomes: **7 diagnostic paths**
- Outer Dispatcher Discard Validation Outcome Paths: **25 distinct paths** (DISC-01 through DISC-25)
- **Total Semantic Pipeline Outcome Paths:** $50 + 19 + 55 + 7 + 25 = \mathbf{156 \text{ paths}}$.

#### Dimension 3: Defined Test Specifications
- Replacement Pre-Flight & Promotion Suite: TEST-01 through TEST-34 (**34 specifications**)
- Outer-Dispatch Integrity Suite: DSP-01 through DSP-104 (**104 specifications**)
- Recovery Diagnostic Suite: REC-01 through REC-07 (**7 specifications**)
- **Total Test Specifications Defined:** $34 + 104 + 7 = \mathbf{145 \text{ test specifications}}$.

#### Dimension 4: Executed Operational Tests
- **Executed Operational Tests:** **ZERO (0).**  
  All 145 test specifications are strictly marked **[NOT EXECUTED — UNTESTED]**.

---

## 8. Open Blockers & Residual Risks

### 8.1 Active Open Blockers

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

### 8.2 Residual Risks

- **UNVERIFIED: Antivirus / Endpoint Detection and Response (EDR) File Interception:**  
  Real-time antivirus filters frequently lock newly created `.discard` and `.golden` files during quarantine scanning. `Dispatch-RollbackResultV23` safely handles this via CLR exception trapping routing to `DISCARD_ATTRIBUTES_LOCKED` or `DISCARD_STAT_LOCKED` (State 5B), preventing false success or false corruption classification. However, operational retry timing under active corporate EDR policies remains unverified.

---

## 9. Explicit Execution-Status & Safety Confirmation

### 9.1 Precise Execution-Status Accounting

To maintain absolute transparency and compliance:

- **Operational Procedures & Scripts:** **ZERO (0) EXECUTED.**  
  `Dispatch-RollbackResultV23`, `Invoke-SafeConfigReplacementV17`, `Invoke-ControlledRollbackV15`, `Enter-ManualRecoveryBoundaryV14`, and all 145 test specifications are strictly **[NOT EXECUTED — UNTESTED]**.
- **Read-Only Diagnostic Commands:** **ZERO (0)** commands were executed in Step AO-W.
  (In Step AO, exactly one diagnostic command was run: `powershell -Command "Test-Path -Path 'docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md'"` returning `False`).
- **Host & Database Alterations:** **ZERO (0).** No configuration files (`postgresql.conf`, `pg_hba.conf`), Windows Firewall rules, Windows services, application code, or `.env` files were modified. No databases, schemas, tables, roles, or records were created, altered, or dropped.
- **Cloud Connections:** **ZERO (0).** No connections made to Neon, AWS, Supabase, Render, or any remote infrastructure.
- **Budget Preservation:** Strict ₹0/month budget preserved.
- **Preserved Application Databases:** Catalogs `hisecure_erp`, `hitech_platform`, and `zentra_test` remain completely untouched.

---

```
STOP — STEP 2D-2A-AO-W COMPLETE — WAITING FOR HUMAN REVIEW
```
