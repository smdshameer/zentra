# MUSE SPARK — ZENTRA STEP 2D-2A-AO-AA
## MISSING DIRECTORY EXCEPTION CLASSIFICATION AUDIT REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Target Repository:** `D:\Zentra`  
**Input Reference:** [`docs/MUSE_SPARK_STEP2D_2A_AO_Z_GENERIC_IO_EXCEPTION_CLASSIFICATION_AUDIT_REPORT.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_AO_Z_GENERIC_IO_EXCEPTION_CLASSIFICATION_AUDIT_REPORT.md)  
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

A comprehensive exception inheritance and control-flow audit of the Step 2D-2A-AO-Z report (`Dispatch-RollbackResultV26`) identified an **omitted exception catch block in Stage 3F (discard file-size inspection using `FileInfo.Length`)**, resulting in a diagnostic misclassification defect:

1. **Omission of Dedicated `DirectoryNotFoundException` Handler in Stage 3F:**  
   In `Dispatch-RollbackResultV26` (Stage 3F, lines 357–414 of the AO-Z report), the `try/catch` block wrapping `[System.IO.FileInfo]::new($discardPath).Length` intercepted `FileNotFoundException`, `PathTooLongException`, `ArgumentException`, `UnauthorizedAccessException`, and generic `IOException`.  
   However, it **omitted an explicit handler for `[System.IO.DirectoryNotFoundException]`**.
2. **Inheritance Shadowing Under .NET Base Class Library (BCL):**  
   Under the CLR type system, `System.IO.DirectoryNotFoundException` derives directly from `System.IO.IOException`. When an operational failure or race condition removes the parent directory containing the quarantine discard artifact during the interval between attribute inspection (Stage 3E) and size inspection (Stage 3F), `FileInfo.Length` triggers an internal Win32 `FindData` query that fails with Win32 error code `3` (`ERROR_PATH_NOT_FOUND`). The .NET runtime wraps this as a `DirectoryNotFoundException`.
3. **Severe Diagnostic Misclassification (False State 5B Instead of State 5C):**  
   Because `catch [System.IO.DirectoryNotFoundException]` was absent, the exception fell through derived filters and was trapped by `catch [System.IO.IOException]`. Inside that block, its HResult (`0x80070003` / `COR_E_DIRECTORYNOTFOUND`) failed the sharing violation test (`$hres -in @(0x80070020, 0x80070021)`), landing in the `else` branch:  
   `-Detail "[STATE 5B: $ContextName] DISCARD_STAT_IO_UNDETERMINED: Undetermined I/O failure querying discard file length [HResult: 0x80070003]: ..."`  
   **Diagnostic Impact:** The dispatcher misclassified a **confirmed physical absence of the directory container (State 5C: mechanical failure / evidence compromised)** as **State 5B (target present on disk but locked/inaccessible)**. An operator receiving State 5B is instructed to troubleshoot file locks or process handles, whereas the actual physical condition is that the entire quarantine folder was deleted, unmounted, or never created.
4. **Surrounding Implementation Symmetries:**  
   - In **Stage 3E** (`GetAttributes`), `DirectoryNotFoundException` was already caught and mapped to State 5C (`DISCARD_DIRECTORY_MISSING`).
   - In **Stage 3G** (`HASH_READ_FAILED`), `DirectoryNotFoundException` was already mapped to State 5C (`DISCARD_DIRECTORY_DELETED_PRE_HASH`).
   - Stage 3F was an isolated architectural asymmetry, which is now corrected in `Dispatch-RollbackResultV27`.

### 1.2 Summary of Identified Findings

| Finding ID | Source Report Location | Description | Impact | Remediation in Step AO-AA |
|---|---|---|---|---|
| **FIND-AA1** | `Dispatch-RollbackResultV26`<br/>Lines 357–414 | **Missing `DirectoryNotFoundException` in Stage 3F:** Catch sequence lacks explicit handler for missing directory during `FileInfo.Length`. | Deleted directory container is trapped by generic `IOException` and misclassified as State 5B (`DISCARD_STAT_IO_UNDETERMINED`). | Insert explicit `catch [System.IO.DirectoryNotFoundException]` ahead of `IOException`, routing to State 5C (`DISCARD_DIRECTORY_DELETED_POST_STAT`). |
| **FIND-AA2** | Section 7 (Taxonomy)<br/>Lines 702–709 | **Omission of Stage 3F Directory Deletion in Discard Taxonomy:** 34-class taxonomy contained `DISC-12` (`FileNotFound`) but lacked a discrete entry for directory disappearance on size query. | Taxonomy arithmetic did not account for directory absence during size check. | Expand taxonomy from 34 to **35 discrete operational outcomes (`DISC-01` through `DISC-35`)**, adding `DISC-13`. |
| **FIND-AA3** | `Dispatch-RollbackResultV26`<br/>Lines 370–383 | **Coarse Diagnostic Tagging for Path/Argument Errors in Stage 3F:** Both `PathTooLongException` and `ArgumentException` reused identical tag `DISCARD_PATH_INVALID`. | Decreased diagnostic distinction between buffer length overflow and invalid argument characters. | Differentiate tags: `DISCARD_STAT_PATH_TOO_LONG` and `DISCARD_STAT_ARGUMENT_INVALID` (both State 5D). |
| **FIND-AA4** | Section 8.1<br/>Lines 730–742 | **Test Matrix Coverage Gaps for Stage 3F Directory Absence:** DSP suite ended at DSP-121, lacking dedicated specifications for Stage 3F missing directory, missing file, and terminal guard execution. | Test suite omitted verification for the corrected Stage 3F catch ordering. | Expand DSP suite from 121 to **127 test specifications (`DSP-01` through `DSP-127`)**. |

---

## 2. Finding 1 — Stage 3F Exception Inheritance & Catch Ordering Audit

### 2.1 The .NET CLR Type Inheritance Hierarchy for `FileInfo.Length`

When querying `[System.IO.FileInfo]::new($discardPath).Length`, the CLR interacts with the underlying Win32 file subsystem. The relevant exception hierarchy defined in the Base Class Library (`System.Private.CoreLib` / `mscorlib`) is structured as follows:

```
System.Object
  └── System.Exception
        └── System.SystemException
              ├── System.ArgumentException (State 5D: Path argument malformed)
              │     └── System.ArgumentNullException (State 5D)
              ├── System.UnauthorizedAccessException (State 5B: ACL / permissions denied)
              └── System.IO.IOException (Base I/O exception class)
                    ├── System.IO.FileNotFoundException (State 5C: Leaf file confirmed missing)
                    ├── System.IO.DirectoryNotFoundException (State 5C: Directory container confirmed missing)
                    └── System.IO.PathTooLongException (State 5D: Path buffer exceeds MAX_PATH / 32,767 chars)
```

### 2.2 PowerShell Catch Evaluation Semantics

In PowerShell, `try { ... } catch [Type1] { ... } catch [Type2] { ... } catch { ... }` blocks are evaluated sequentially from top to bottom. The first catch block whose type filter is assignable from the thrown exception type (`[Type]::IsAssignableFrom($thrown.GetType())`) captures the exception.

In `Dispatch-RollbackResultV26` (AO-Z), the Stage 3F catch block was defined as:

```powershell
# V26 FLAWED IMPLEMENTATION (AO-Z Lines 363-414)
catch [System.IO.FileNotFoundException] { ... State 5C ... }
catch [System.IO.PathTooLongException] { ... State 5D ... }
catch [System.ArgumentException] { ... State 5D ... }
catch [System.UnauthorizedAccessException] { ... State 5B ... }
catch [System.IO.IOException] {
    # DirectoryNotFoundException is assignable to IOException!
    # Trapped here prematurely!
    $hres = $_.Exception.HResult
    if ($hres -in $sharingViolationHResults) { ... State 5B SHARING_VIOLATION ... }
    else { ... State 5B IO_UNDETERMINED ... }
}
catch { ... State 5F ... }
```

### 2.3 Diagnostic Distortion Analysis

When a parent directory vanishes (e.g., deleted by a concurrent cleanup script, unmounted volume, or filesystem race):

1. `FileInfo.Length` throws `System.IO.DirectoryNotFoundException`.
2. The exception is evaluated against `[System.IO.FileNotFoundException]` $\rightarrow$ `$false`.
3. Evaluated against `[System.IO.PathTooLongException]` $\rightarrow$ `$false`.
4. Evaluated against `[System.ArgumentException]` $\rightarrow$ `$false`.
5. Evaluated against `[System.UnauthorizedAccessException]` $\rightarrow$ `$false`.
6. Evaluated against `[System.IO.IOException]` $\rightarrow$ **`$true` (Inheritance match)**.
7. Inside `catch [System.IO.IOException]`, `$hres = 0x80070003` (`ERROR_PATH_NOT_FOUND`).
8. `$hres -in @(0x80070020, 0x80070021)` evaluates to `$false`.
9. The `else` branch executes, invoking `Enter-ManualRecoveryBoundaryV14` with:
   `-Detail "[STATE 5B: $ContextName] DISCARD_STAT_IO_UNDETERMINED: Undetermined I/O failure querying discard file length [HResult: 0x80070003]: ..."`

**Severity Assessment:**  
- **False State:** State 5B (`TARGET PRESENT BUT INACCESSIBLE`).
- **Correct State:** State 5C (`ARTIFACT ABSENT / DISAPPEARED / EVIDENCE COMPROMISED`).
- **Operational Hazard:** An operator or automated monitor seeing State 5B assumes the discard file exists on disk and attempts lock inspection via `handle.exe` or `openfiles`. In reality, the file does not exist because its parent directory was deleted, which requires immediate physical investigation of storage volumes or quarantine paths (State 5C).

---

## 3. Corrected Catch-Order & State Mapping Specification

### 3.1 Before vs. After Exception-Classification Matrix (Stage 3F)

| Thrown Exception Type | Inheritance Relation | V26 Trapping Block | V26 State & Detail | V27 Trapping Block | V27 State & Detail | Verdict / Remediation |
|---|---|---|---|---|---|---|
| `FileNotFoundException` | Derives from `IOException` | `catch [FileNotFoundException]` | **State 5C**<br/>`DISCARD_FILE_DELETED_POST_STAT` | `catch [FileNotFoundException]` | **State 5C**<br/>`DISCARD_FILE_DELETED_POST_STAT` | Preserved. Confirmed leaf absence. |
| `DirectoryNotFoundException` | Derives from `IOException` | **OMITTED** (fell to `catch [IOException]`) | **State 5B** (INCORRECT)<br/>`DISCARD_STAT_IO_UNDETERMINED` | `catch [DirectoryNotFoundException]` | **State 5C** (CORRECTED)<br/>`DISCARD_DIRECTORY_DELETED_POST_STAT` | **REMEDIATED (FIND-AA1).** Placed before `IOException`. |
| `PathTooLongException` | Derives from `IOException` | `catch [PathTooLongException]` | **State 5D**<br/>`DISCARD_PATH_INVALID` | `catch [PathTooLongException]` | **State 5D**<br/>`DISCARD_STAT_PATH_TOO_LONG` | Preserved precedence; refined diagnostic tag. |
| `ArgumentException` | Derives from `SystemException` | `catch [ArgumentException]` | **State 5D**<br/>`DISCARD_PATH_INVALID` | `catch [ArgumentException]` | **State 5D**<br/>`DISCARD_STAT_ARGUMENT_INVALID` | Preserved precedence; refined diagnostic tag. |
| `UnauthorizedAccessException` | Derives from `SystemException` | `catch [UnauthorizedAccessException]` | **State 5B**<br/>`DISCARD_STAT_ACCESS_DENIED` | `catch [UnauthorizedAccessException]` | **State 5B**<br/>`DISCARD_STAT_ACCESS_DENIED` | Preserved. Permissions failure. |
| `IOException` (`0x80070020`/`21`) | Base I/O Class | `catch [IOException]` (sharing branch) | **State 5B**<br/>`DISCARD_STAT_SHARING_VIOLATION` | `catch [IOException]` (sharing branch) | **State 5B**<br/>`DISCARD_STAT_SHARING_VIOLATION` | Preserved. Confirmed sharing lock. |
| `IOException` (Other HResult) | Base I/O Class | `catch [IOException]` (else branch) | **State 5B**<br/>`DISCARD_STAT_IO_UNDETERMINED` | `catch [IOException]` (else branch) | **State 5B**<br/>`DISCARD_STAT_IO_UNDETERMINED` | Preserved. Undetermined I/O fault. |
| Other CLR Exception | Any | `catch` (general) | **State 5F**<br/>`DISCARD_STAT_QUERY_THREW` | `catch` (general) | **State 5F**<br/>`DISCARD_STAT_QUERY_THREW` | Preserved. Tooling/runtime crash. |

### 3.2 Symmetrical Alignment Across Stages 3E, 3F, and 3G

With `Dispatch-RollbackResultV27`, all three discard inspection stages maintain identical, rigorous exception classification:

```
Stage 3E (Attribute Query):
  ├── FileNotFoundException             ──> State 5C (DISCARD_FILE_ABSENT)
  ├── DirectoryNotFoundException        ──> State 5C (DISCARD_DIRECTORY_MISSING)
  ├── PathTooLongException              ──> State 5D (DISCARD_PATH_INVALID)
  ├── ArgumentException                 ──> State 5D (DISCARD_PATH_INVALID)
  ├── UnauthorizedAccessException       ──> State 5B (DISCARD_ATTRIBUTES_ACCESS_DENIED)
  ├── IOException (Sharing Violation)   ──> State 5B (DISCARD_ATTRIBUTES_SHARING_VIOLATION)
  ├── IOException (Undetermined)        ──> State 5B (DISCARD_ATTRIBUTES_IO_UNDETERMINED)
  └── General Catch                     ──> State 5F (DISCARD_ATTRIBUTES_QUERY_THREW)

Stage 3F (Size Query via FileInfo.Length) [CORRECTED IN V27]:
  ├── FileNotFoundException             ──> State 5C (DISCARD_FILE_DELETED_POST_STAT)
  ├── DirectoryNotFoundException        ──> State 5C (DISCARD_DIRECTORY_DELETED_POST_STAT)
  ├── PathTooLongException              ──> State 5D (DISCARD_STAT_PATH_TOO_LONG)
  ├── ArgumentException                 ──> State 5D (DISCARD_STAT_ARGUMENT_INVALID)
  ├── UnauthorizedAccessException       ──> State 5B (DISCARD_STAT_ACCESS_DENIED)
  ├── IOException (Sharing Violation)   ──> State 5B (DISCARD_STAT_SHARING_VIOLATION)
  ├── IOException (Undetermined)        ──> State 5B (DISCARD_STAT_IO_UNDETERMINED)
  └── General Catch                     ──> State 5F (DISCARD_STAT_QUERY_THREW)

Stage 3G (Hash Calculation Inner Ladder on HASH_READ_FAILED):
  ├── Inner is Null                     ──> State 5D (DISCARD_HASH_ERROR_METADATA_MISSING)
  ├── FileNotFoundException             ──> State 5C (DISCARD_FILE_DELETED_PRE_HASH)
  ├── DirectoryNotFoundException        ──> State 5C (DISCARD_DIRECTORY_DELETED_PRE_HASH)
  ├── PathTooLongException              ──> State 5D (DISCARD_HASH_PATH_TOO_LONG)
  ├── ArgumentException                 ──> State 5D (DISCARD_HASH_ARGUMENT_INVALID)
  ├── UnauthorizedAccessException       ──> State 5B (DISCARD_FILE_ACCESS_DENIED)
  ├── IOException (Sharing Violation)   ──> State 5B (DISCARD_FILE_SHARING_VIOLATION)
  ├── IOException (Undetermined)        ──> State 5B (DISCARD_FILE_IO_UNDETERMINED)
  └── Else (Unrecognized Type)          ──> State 5F (DISCARD_HASH_UNEXPECTED_ERROR_TYPE)
```

---

## 4. Architectural Separation: Thrown Exceptions vs. Returned Error Metadata

To prevent future regression, the architectural boundary separating **thrown CLR exceptions** from **returned error metadata** is strictly formalized:

| Dimension | Thrown CLR Exceptions (Stages 3E, 3F, 3G-Try) | Returned Error Metadata (Stage 3G Switch) |
|---|---|---|
| **Mechanism** | PowerShell `try { ... } catch [Type] { ... }` blocks | PowerShell `switch ($discardHashInfo.Status)` and `$innerEx -is [Type]` |
| **Origin** | Thrown by .NET BCL methods (`GetAttributes`, `FileInfo.Length`, or unhandled crashes inside helper) | Structured PSCustomObject returned by `Get-SafeFileHashV4` in `.Error` property |
| **Control Flow** | Immediate stack unwind intercepted by local catch block | Normal sequential flow inspecting object properties |
| **Null Treatment** | Not possible (a caught `$_` always encapsulates an `[Exception]` object) | `$innerEx -eq $null` is a valid possibility requiring explicit State 5D handling |
| **Unrecognized Type** | Caught by untyped `catch { ... }` $\rightarrow$ **State 5F (`*_QUERY_THREW`)** | Caught by ladder `else { ... }` $\rightarrow$ **State 5F (`DISCARD_HASH_UNEXPECTED_ERROR_TYPE`)** |
| **Fail-Closed Terminal Guard** | Explicit local `throw [InvalidOperationException]` inside every catch block | Explicit local `throw [InvalidOperationException]` inside every ladder branch |

---

## 5. Fail-Closed Control Flow & TOCTOU Boundary Guarantees

### 5.1 Terminal Throw Guards on Every Non-Success Branch

In `Dispatch-RollbackResultV27`, every error branch invokes `Enter-ManualRecoveryBoundaryV14` and immediately executes an immutable local throw guard:

```powershell
throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: <Diagnostic Context>")
```

This guarantees:
1. **Control flow cannot fall through:** Even if `Enter-ManualRecoveryBoundaryV14` returns normally (e.g., if a developer modifies it to log without re-throwing, or if an internal catch suppresses an error), execution inside `Dispatch-RollbackResultV27` terminates immediately.
2. **State 4 is unreachable on error:** Control flow can never proceed to Stage 4 or line 580 (`OUTCOME 4: ROLLBACK SUCCESS`) if any check fails.

### 5.2 Unavoidable Windows User-Mode Filesystem Race Windows (TOCTOU)

Exception handling provides robust diagnostic classification when a failure occurs, but **cannot eliminate user-mode filesystem race conditions**. The four fundamental Windows TOCTOU race windows remain active:

```
[Window A] Gap between caller live measurement and rollback engine discard capture.
           (A concurrent process may alter the file after pre-flight inspection).
[Window B] Gap between file handle closure and ReplaceFileW acquisition during atomic swap.
           (A third-party filter driver or antivirus engine may lock the target).
[Window C] Gap between discard attribute inspection, size query, and hash stream open.
           (The discard file or its directory may be deleted between Stages 3E, 3F, and 3G).
[Window D] Gap between hash stream closure and post-evaluation archival.
           (The discard file may be modified after its SHA-256 hash was verified).
```

**Architectural Law:** `Dispatch-RollbackResultV27` detects and safely aborts on any mid-flight alteration across Windows A, B, C, and D, but **zero race-free operation is claimed or possible in user-mode software**.

---

## 6. Authoritative PowerShell Implementation: `Dispatch-RollbackResultV27`

```powershell
function Dispatch-RollbackResultV27 {
    <#
    .SYNOPSIS
        Evaluates the outcome of a controlled configuration rollback operation with
        exhaustive evidence validation, precise .NET exception inheritance handling,
        and fail-closed terminal execution boundaries.
    .DESCRIPTION
        Step 2D-2A-AO-AA remediation: Corrects Stage 3F catch ordering to include
        [System.IO.DirectoryNotFoundException] ahead of generic [System.IO.IOException],
        preventing missing directory containers from being misdiagnosed as State 5B locks.
        Implements two-way HResult discrimination for sharing violations, 8-way inner
        ladder for HASH_READ_FAILED, and local terminal throws on all error branches.
    .PARAMETER RollbackResult
        The result PSCustomObject returned by Invoke-ControlledRollbackV15.
    .PARAMETER LiveConfigPath
        Absolute path to the active live postgresql.conf file.
    .PARAMETER GoldenBackupPath
        Absolute path to the known-good baseline backup file.
    .PARAMETER ExpectedBaselineHash
        The 64-character hex SHA-256 hash of the golden baseline backup.
    .PARAMETER ExpectedTriggerHash
        The 64-character hex SHA-256 hash captured from the live file that triggered rollback.
    .PARAMETER TriggerError
        The original Exception that initiated the rollback sequence.
    .PARAMETER ContextName
        Diagnostic identifier for the calling operational phase.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $false)]
        [PSCustomObject]$RollbackResult,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$LiveConfigPath,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$GoldenBackupPath,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedBaselineHash,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedTriggerHash,

        [Parameter(Mandatory = $true)]
        [System.Exception]$TriggerError,

        [Parameter(Mandatory = $false)]
        [string]$ContextName = "ROLLBACK_DISPATCH"
    )

    $sha256Regex = '^[A-Fa-f0-9]{64}$'
    $sharingViolationHResults = @([int]0x80070020, [int]0x80070021)

    # -------------------------------------------------------------------------
    # STAGE 0: CALLER PARAMETER VALIDATION (FAIL-CLOSED DEFENSE-IN-DEPTH)
    # -------------------------------------------------------------------------
    if ([string]::IsNullOrWhiteSpace($ExpectedBaselineHash) -or ($ExpectedBaselineHash -notmatch $sha256Regex)) {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
            -Detail "[STATE 5D: $ContextName] CALLER_BASELINE_HASH_INVALID: Expected baseline hash is missing or not a valid 64-char SHA-256 hex string. Fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: ExpectedBaselineHash is invalid.")
    }

    if ([string]::IsNullOrWhiteSpace($ExpectedTriggerHash) -or ($ExpectedTriggerHash -notmatch $sha256Regex)) {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
            -Detail "[STATE 5D: $ContextName] CALLER_TRIGGER_HASH_INVALID: Expected trigger hash is missing or not a valid 64-char SHA-256 hex string. Fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: ExpectedTriggerHash is invalid.")
    }

    # -------------------------------------------------------------------------
    # STAGE 1: DEFENSIVE RESULT OBJECT VALIDATION
    # -------------------------------------------------------------------------
    if ($RollbackResult -eq $null) {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $null `
            -Detail "[STATE 5D: $ContextName] ROLLBACK_RESULT_NULL: Rollback engine returned a null result object. Indeterminate — fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: RollbackResult object is null.")
    }

    # -------------------------------------------------------------------------
    # STAGE 2: CONTRADICTION INTERCEPTION TRAPS
    # -------------------------------------------------------------------------
    if ($RollbackResult.Success -eq $true -and $RollbackResult.Status -ne "ROLLBACK_SUCCESS") {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
            -Detail "[STATE 5D: $ContextName] CONTRADICTION_SUCCESS_STATUS_MISMATCH: Rollback reported Success=$true but Status='$($RollbackResult.Status)'. Indeterminate — fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Success=$true with Status!=$($RollbackResult.Status) contradiction.")
    }

    if ($RollbackResult.Success -ne $true -and $RollbackResult.Status -eq "ROLLBACK_SUCCESS") {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
            -Detail "[STATE 5D: $ContextName] CONTRADICTION_FAILURE_STATUS_MISMATCH: Rollback reported Success=$($RollbackResult.Success) but Status='ROLLBACK_SUCCESS'. Indeterminate — fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Success!=true with Status=ROLLBACK_SUCCESS contradiction.")
    }

    # -------------------------------------------------------------------------
    # STAGE 3: MULTI-FACTOR EVIDENCE VALIDATION (SUCCESS APPLICANT PATH)
    # -------------------------------------------------------------------------
    if ($RollbackResult.Success -eq $true -and $RollbackResult.Status -eq "ROLLBACK_SUCCESS") {

        # 3A. Restored Hash Metadata Presence Check
        if ([string]::IsNullOrWhiteSpace($RollbackResult.RestoredHash)) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] RESTORED_HASH_MISSING: Rollback reported success but RestoredHash property is null or empty. Fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: RestoredHash property is missing.")
        }

        # 3B. Restored Hash Format Validation (64-Char Hex)
        if ($RollbackResult.RestoredHash -notmatch $sha256Regex) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] RESTORED_HASH_MALFORMED: RestoredHash [$($RollbackResult.RestoredHash)] is not a valid 64-character SHA-256 hex string. Fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: RestoredHash property is malformed.")
        }

        # 3C. Strict Cryptographic Equality Check against Baseline
        if ($RollbackResult.RestoredHash -ine $ExpectedBaselineHash) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5C: $ContextName] RESTORED_HASH_MISMATCH: Restored live file SHA-256 [$($RollbackResult.RestoredHash)] does not match golden baseline [$ExpectedBaselineHash]. Fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: RestoredHash does not match golden baseline.")
        }

        # 3D. Discard Artifact Path Presence Check
        $discardPath = $RollbackResult.DiscardBackup
        if ([string]::IsNullOrWhiteSpace($discardPath)) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] DISCARD_PATH_MISSING: Rollback reported success but DiscardBackup path is null or empty. Fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: DiscardBackup path is missing.")
        }

        # 3E. Discard Artifact Physical Inspection via BCL GetAttributes
        $attr = $null
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
            $hres = $_.Exception.HResult
            if ($hres -in $sharingViolationHResults) {
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                    -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                    -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                    -Detail "[STATE 5B: $ContextName] DISCARD_ATTRIBUTES_SHARING_VIOLATION: Verified file sharing violation inspecting discard attributes: $($_.Exception.Message)"
                throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard attribute sharing violation.")
            }
            else {
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                    -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                    -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                    -Detail "[STATE 5B: $ContextName] DISCARD_ATTRIBUTES_IO_UNDETERMINED: Undetermined I/O failure inspecting discard attributes [HResult: 0x$($hres.ToString('X8'))]: $($_.Exception.Message)"
                throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard attribute undetermined I/O failure.")
            }
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

        # 3F. Discard Non-Zero Length Assertion via BCL FileInfo (Corrected Catch Order in V27)
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
        catch [System.IO.DirectoryNotFoundException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5C: $ContextName] DISCARD_DIRECTORY_DELETED_POST_STAT: Discard parent directory was deleted between attribute check and size check. Fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard directory deleted post-stat.")
        }
        catch [System.IO.PathTooLongException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] DISCARD_STAT_PATH_TOO_LONG: Discard path too long during size query: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard path too long during size check.")
        }
        catch [System.ArgumentException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] DISCARD_STAT_ARGUMENT_INVALID: Invalid path argument during size query: $($_.Exception.Message)"
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
            $hres = $_.Exception.HResult
            if ($hres -in $sharingViolationHResults) {
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                    -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                    -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                    -Detail "[STATE 5B: $ContextName] DISCARD_STAT_SHARING_VIOLATION: Verified file sharing violation querying discard file length: $($_.Exception.Message)"
                throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard stat sharing violation.")
            }
            else {
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                    -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                    -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                    -Detail "[STATE 5B: $ContextName] DISCARD_STAT_IO_UNDETERMINED: Undetermined I/O failure querying discard file length [HResult: 0x$($hres.ToString('X8'))]: $($_.Exception.Message)"
                throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard stat undetermined I/O failure.")
            }
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

        # 3G. Independent Discard Cryptographic Hash Calculation (Hardened Error Discrimination)
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
                        -Detail "[STATE 5D: $ContextName] DISCARD_HASH_PATH_TOO_LONG: Discard path length overflow during stream open: $($innerEx.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard hash path too long.")
                }

                # Ladder Step 5: Argument Invalid / Malformed (Derived from SystemException -> State 5D)
                elseif ($innerEx -is [System.ArgumentException]) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5D: $ContextName] DISCARD_HASH_ARGUMENT_INVALID: Discard path argument invalid during stream open: $($innerEx.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard hash argument invalid.")
                }

                # Ladder Step 6: Access Denied / ACL Restriction (Derived from SystemException -> State 5B)
                elseif ($innerEx -is [System.UnauthorizedAccessException]) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5B: $ContextName] DISCARD_FILE_ACCESS_DENIED: Access denied opening discard file stream: $($innerEx.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard file stream access denied.")
                }

                # Ladder Step 7: Generic IOException with HResult Sharing Violation Discrimination (State 5B)
                elseif ($innerEx -is [System.IO.IOException]) {
                    $hres = $innerEx.HResult
                    if ($hres -in $sharingViolationHResults) {
                        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                            -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                            -Detail "[STATE 5B: $ContextName] DISCARD_FILE_SHARING_VIOLATION: Verified file sharing violation opening discard stream: $($innerEx.Message)"
                        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard file sharing violation.")
                    }
                    else {
                        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                            -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                            -Detail "[STATE 5B: $ContextName] DISCARD_FILE_IO_UNDETERMINED: Undetermined I/O failure opening discard stream [HResult: 0x$($hres.ToString('X8'))]: $($innerEx.Message)"
                        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard file stream undetermined I/O failure.")
                    }
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

## 7. Discard Outcome Architecture & State Mapping Taxonomy (35-Class)

With the addition of discrete `DirectoryNotFoundException` handling in Stage 3F, the discard artifact validation architecture expands from 34 to **35 discrete operational outcomes**:

| Outcome ID | Concrete Physical Condition on Disk / Memory | Exception / Status Trapped | Target State | Terminal Action | Diagnostic Classification |
|---|---|---|---|---|---|
| **DISC-01** | Discard path parameter missing or empty | `$RollbackResult.DiscardBackup` is `$null`/whitespace | **State 5D** | Local Terminal Throw | Metadata omission in engine return object. |
| **DISC-02** | Discard file absent from disk | `GetAttributes` throws `FileNotFoundException` | **State 5C** | Local Terminal Throw | Confirmed physical absence of quarantine file. |
| **DISC-03** | Discard directory container absent | `GetAttributes` throws `DirectoryNotFoundException`| **State 5C** | Local Terminal Throw | Parent directory missing; structural mechanical failure. |
| **DISC-04** | Discard path exceeds system length limit | `GetAttributes` throws `PathTooLongException` | **State 5D** | Local Terminal Throw | Indeterminate path syntax (precedes `IOException`). |
| **DISC-05** | Discard path contains invalid characters | `GetAttributes` throws `ArgumentException` | **State 5D** | Local Terminal Throw | Indeterminate path syntax. |
| **DISC-06** | Discard attributes access denied | `GetAttributes` throws `UnauthorizedAccessException`| **State 5B** | Local Terminal Throw | Permissions restriction; file present but inaccessible. |
| **DISC-07** | Discard attributes sharing violation | `GetAttributes` throws `IOException` (`0x80070020`/`21`)| **State 5B** | Local Terminal Throw | Confirmed file sharing lock during attribute check. |
| **DISC-08** | Discard attributes undetermined I/O failure | `GetAttributes` throws `IOException` (Other HResult) | **State 5B** | Local Terminal Throw | Undetermined I/O failure during attribute check. |
| **DISC-09** | `GetAttributes` throws unexpected CLR exception | Trapped in general `catch` block | **State 5F** | Local Terminal Throw | Tooling / OS exception inspecting attributes. |
| **DISC-10** | Discard path is a directory container | `($attr -band Directory) -ne 0` | **State 5C** | Local Terminal Throw | Artifact is a directory container, not a leaf file. |
| **DISC-11** | Discard path is a reparse point (symlink/junction)| `($attr -band ReparsePoint) -ne 0` | **State 5C** | Local Terminal Throw | Reparse point aliases external location. |
| **DISC-12** | Discard deleted between attribute and size checks | `FileInfo.Length` throws `FileNotFoundException` | **State 5C** | Local Terminal Throw | Mid-flight deletion race; file vanished post-stat. |
| **DISC-13** | **Discard directory deleted between attribute and size checks** | **`FileInfo.Length` throws `DirectoryNotFoundException`** | **State 5C** | **Local Terminal Throw** | **NEW (FIND-AA1/AA2). Mid-flight directory removal.** |
| **DISC-14** | Discard path exceeds limit on size query | `FileInfo.Length` throws `PathTooLongException` | **State 5D** | Local Terminal Throw | Path buffer error on size check. |
| **DISC-15** | Discard size query argument syntax error | `FileInfo.Length` throws `ArgumentException` | **State 5D** | Local Terminal Throw | Path argument syntax error on size check. |
| **DISC-16** | Discard size query access denied | `FileInfo.Length` throws `UnauthorizedAccessException`| **State 5B** | Local Terminal Throw | Permissions denied during size query. |
| **DISC-17** | Discard size query sharing violation | `FileInfo.Length` throws `IOException` (`0x80070020`/`21`)| **State 5B** | Local Terminal Throw | Confirmed sharing lock during size query. |
| **DISC-18** | Discard size query undetermined I/O failure | `FileInfo.Length` throws `IOException` (Other HResult)| **State 5B** | Local Terminal Throw | Undetermined I/O failure during size query. |
| **DISC-19** | Discard size query throws unexpected exception | `FileInfo.Length` throws general exception | **State 5F** | Local Terminal Throw | Tooling / OS exception querying size. |
| **DISC-20** | Discard file is empty (0 bytes) | `$discardLength -le 0` | **State 5C** | Local Terminal Throw | Truncated or empty quarantine artifact. |
| **DISC-21** | Discard hash query threw CLR exception | Trapped in outer `try/catch` wrapping helper | **State 5F** | Local Terminal Throw | Tooling execution fault during hash invocation. |
| **DISC-22** | Discard hash helper returned null object/status | `$discardHashInfo -eq $null` or `Status -eq $null` | **State 5D** | Local Terminal Throw | Indeterminate metadata from helper. |
| **DISC-23** | Discard file deleted before stream open | Helper `HASH_READ_FAILED` (Inner: `FileNotFound`) | **State 5C** | Local Terminal Throw | Mid-flight file deletion race before stream open. |
| **DISC-24** | Discard directory deleted before stream open | Helper `HASH_READ_FAILED` (Inner: `DirectoryNotFound`)| **State 5C** | Local Terminal Throw | Mid-flight directory deletion race before stream open. |
| **DISC-25** | Discard path too long during stream open | Helper `HASH_READ_FAILED` (Inner: `PathTooLong`) | **State 5D** | Local Terminal Throw | Path length overflow during stream open. |
| **DISC-26** | Discard argument syntax invalid during stream open| Helper `HASH_READ_FAILED` (Inner: `ArgumentException`)| **State 5D** | Local Terminal Throw | Argument/syntax error during stream open. |
| **DISC-27** | Discard access denied during stream open | Helper `HASH_READ_FAILED` (Inner: `Unauthorized`) | **State 5B** | Local Terminal Throw | Permissions restriction opening stream. |
| **DISC-28** | Discard sharing violation during stream open | Helper `HASH_READ_FAILED` (Inner: `IOException` 0x80070020)| **State 5B** | Local Terminal Throw | Confirmed sharing lock opening stream. |
| **DISC-29** | Discard undetermined I/O failure during stream open | Helper `HASH_READ_FAILED` (Inner: `IOException` other)| **State 5B** | Local Terminal Throw | Undetermined I/O failure opening stream. |
| **DISC-30** | Discard hash read failed with null inner error | Helper `HASH_READ_FAILED` (Inner: `$null`) | **State 5D** | Local Terminal Throw | Missing error metadata in helper response. |
| **DISC-31** | Discard hash read failed with unexpected type | Helper `HASH_READ_FAILED` (Inner: Unrecognized)| **State 5F** | Local Terminal Throw | Unrecognized CLR exception type in helper response. |
| **DISC-32** | Hash helper encounters internal failure | Helper returns `HELPER_EXCEPTION` | **State 5F** | Local Terminal Throw | Helper reported internal execution fault. |
| **DISC-33** | Discard hash metadata missing on verified status | Status is `HASH_VERIFIED`, but `Hash` is null/empty | **State 5D** | Local Terminal Throw | Helper metadata defect; NOT proven corruption. |
| **DISC-34** | Discard hash metadata malformed on verified status | Status is `HASH_VERIFIED`, but `Hash` not 64-hex | **State 5D** | Local Terminal Throw | Helper metadata defect; NOT proven corruption. |
| **DISC-35** | Discard cryptographic comparison | Digest is valid 64-hex; compared to Trigger Hash | **State 5C / 4** | Branching Throw | Mismatch $\rightarrow$ `VERIFIED_HASH_MISMATCH` (5C); Match $\rightarrow$ State 4. |

---

## 8. Revised Test Matrix & Reconciled 4-Dimensional Counts

### 8.1 Newly Added Outer-Dispatch Test Specifications (DSP-122 through DSP-127)

To validate the corrected Stage 3F catch ordering and fail-closed termination semantics, six new test specifications are added to the outer-dispatch test suite:

| Test ID | Input Scenario / Failure Injection | Expected Result Flag | Dispatch Path / Trigger | Target State | Mapped Diagnostic State | Expected Control Flow | Physical Disk State Guarantee |
|---|---|---|---|---|---|---|---|
| **DSP-122**| Discard parent directory deleted during size query | `$true` | `FileInfo.Length` throws `DirectoryNotFoundException` (Stage 3F) | **State 5C** | 5C | Local Throw | Candidate: Retained; Backup: Retained; Discard: Directory Deleted Post-Stat; Live: Restored. NOT false 5B. |
| **DSP-123**| Discard leaf file deleted during size query | `$true` | `FileInfo.Length` throws `FileNotFoundException` (Stage 3F) | **State 5C** | 5C | Local Throw | Candidate: Retained; Backup: Retained; Discard: File Deleted Post-Stat; Live: Restored. Confirmed absence. |
| **DSP-124**| Discard size query encounters generic I/O failure (Disk Full) | `$true` | `FileInfo.Length` throws `IOException` (`HResult = 0x80070070`) | **State 5B** | 5B | Local Throw | Candidate: Retained; Backup: Retained; Discard: Undetermined I/O Fault; Live: Restored. No false lock claim. |
| **DSP-125**| Discard size query encounters confirmed sharing violation | `$true` | `FileInfo.Length` throws `IOException` (`HResult = 0x80070020`) | **State 5B** | 5B | Local Throw | Candidate: Retained; Backup: Retained; Discard: Sharing Violation Confirmed; Live: Restored. |
| **DSP-126**| Discard size query throws unexpected CLR exception (`SecurityException`)| `$true` | `FileInfo.Length` throws unexpected type $\rightarrow$ general catch | **State 5F** | 5F | Local Throw | Candidate: Retained; Backup: Retained; Discard: Tooling Exception; Live: Restored. State 5F isolated. |
| **DSP-127**| Stage 3F Terminal Fail-Closed Invariant Test | `$true` | Recovery boundary returns normally across all Stage 3F catches | **N/A** | N/A | Local Throw | Control flow strictly intercepted by local `throw [InvalidOperationException]`. State 4 unreachable. |

### 8.2 Complete 4-Dimensional Engineering Accounting Model

#### Dimension 1: Syntactic AST Decision Points
- Pre-Flight Replacement Engine (PF-0 through PF-4B): **41 decision points**
- Replacement Swap & Post-Swap Live Inspection (Stages 2–3): **17 decision points**
- Recovery Boundary Non-Mutating Diagnostics: **7 decision points**
- Dispatcher V27 Decision Points: **53 decision points** (expanded by 1 for the new Stage 3F typed catch branch)
  - Stage 0: 4 checks (Baseline null/whitespace, Baseline regex, Trigger null/whitespace, Trigger regex)
  - Stage 1: 1 check (RollbackResult null)
  - Stage 2: 2 contradiction traps
  - Stage 3: 39 evidence checks & try/catch branches
    - RestoredHash checks: null (1), regex (1), equality (1) = 3
    - DiscardPath check: null (1)
    - GetAttributes try/catch: 7 typed catch branches + HResult sharing check inside IOException (1) + Directory bitmask (1) + Reparse bitmask (1) = 10
    - FileInfo.Length try/catch: 7 typed catch branches (`FileNotFound`, `DirectoryNotFound`, `PathTooLong`, `Argument`, `Unauthorized`, `IOException`, general catch) + HResult sharing check inside IOException (1) + length <= 0 (1) = **9 decision points** (was 8)
    - Hash calculation: try/catch (1), null check (1), switch with 8-way inner exception ladder + HResult sharing check inside IOException branch (1) = 9, helper exception (1), hash null (1), hash regex (1), hash equality (1), switch default (1) = 16
  - Stage 4: 1 check (rbStatus null/empty)
  - Stage 5: 6 switch branches across 54 failure statuses
- **Total Syntactic AST Decision Points:** $41 + 17 + 7 + 53 = \mathbf{118 \text{ decision points}}$.

#### Dimension 2: Semantic Pipeline Outcome Paths
- Pre-Flight Replacement Outcomes: **50 semantic paths**
- Replacement Swap & Post-Swap Live Barrier Outcomes: **19 semantic paths**
- Rollback Engine Internal Return Paths: **55 return paths**
- Recovery Diagnostic Outcomes: **7 diagnostic paths**
- Outer Dispatcher Discard Validation Outcome Paths: **35 distinct paths** (DISC-01 through DISC-35)
- **Total Semantic Pipeline Outcome Paths:** $50 + 19 + 55 + 7 + 35 = \mathbf{166 \text{ paths}}$.

#### Dimension 3: Defined Test Specifications
- Replacement Pre-Flight & Promotion Suite: TEST-01 through TEST-34 (**34 specifications**)
- Outer-Dispatch Integrity Suite: DSP-01 through DSP-127 (**127 specifications**, expanded from 121)
- Recovery Diagnostic Suite: REC-01 through REC-07 (**7 specifications**)
- **Total Test Specifications Defined:** $34 + 127 + 7 = \mathbf{168 \text{ test specifications}}$.

#### Dimension 4: Executed Operational Tests
- **Executed Operational Tests:** **ZERO (0).**  
  All 168 test specifications are strictly marked **[NOT EXECUTED — UNTESTED]**.

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
   - Four distinct Windows user-mode filesystem race windows cannot be eliminated in software (Windows A, B, C, and D).
   - All four are mitigated to fail-closed aborts, but zero race windows can be claimed as eliminated.
4. **BLOCKER-4: Standalone Migration Runner Absence:**  
   - CLI migration runner with pre-flight database assertions has not yet been authored.
5. **BLOCKER-5: Role Creation Interactive Credential Policy:**  
   - Interactive console `\password zentra_dev` prompt required to preserve zero-plaintext credential standard.

### 9.2 Residual Risks

- **UNVERIFIED: Antivirus / Endpoint Detection and Response (EDR) File Interception & HResult Preservation:**  
  Real-time antivirus filters frequently lock newly created `.discard` and `.golden` files during quarantine scanning. While `Dispatch-RollbackResultV27` safely routes `0x80070020`/`21` to `DISCARD_STAT_SHARING_VIOLATION` and other codes to `DISCARD_STAT_IO_UNDETERMINED` (both State 5B), whether corporate EDR drivers consistently preserve standard Win32 HResult codes remains unverified at runtime.

---

## 10. Explicit Execution-Status & Safety Confirmation

### 10.1 Precise Execution-Status Accounting

To maintain absolute transparency and compliance:

- **Operational Procedures & Scripts:** **ZERO (0) EXECUTED.**  
  `Dispatch-RollbackResultV27`, `Invoke-SafeConfigReplacementV17`, `Invoke-ControlledRollbackV15`, `Enter-ManualRecoveryBoundaryV14`, and all 168 test specifications are strictly **[NOT EXECUTED — UNTESTED]**.
- **Read-Only Diagnostic Commands:** **ZERO (0)** commands were executed in Step AO-AA.
  (In Step AO, exactly one diagnostic command was run: `powershell -Command "Test-Path -Path 'docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md'"` returning `False`).
- **Host & Database Alterations:** **ZERO (0).** No configuration files (`postgresql.conf`, `pg_hba.conf`), Windows Firewall rules, Windows services, application code, or `.env` files were modified. No databases, schemas, tables, roles, or records were created, altered, or dropped.
- **Cloud Connections:** **ZERO (0).** No connections made to Neon, AWS, Supabase, Render, or any remote infrastructure.
- **Budget Preservation:** Strict ₹0/month budget preserved.
- **Preserved Application Databases:** Catalogs `hisecure_erp`, `hitech_platform`, and `zentra_test` remain completely untouched.

---

```
STOP — STEP 2D-2A-AO-AA COMPLETE — WAITING FOR HUMAN REVIEW
```
