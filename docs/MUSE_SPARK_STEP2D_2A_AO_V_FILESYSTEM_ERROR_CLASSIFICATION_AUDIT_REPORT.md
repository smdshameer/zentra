# MUSE SPARK — ZENTRA STEP 2D-2A-AO-V
## FILE-SYSTEM ERROR CLASSIFICATION AUDIT REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Target Repository:** `D:\Zentra`  
**Input Reference:** [`docs/MUSE_SPARK_STEP2D_2A_AO_U_DISCARD_VALIDATION_AND_TRUST_PROVENANCE_AUDIT_REPORT.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_AO_U_DISCARD_VALIDATION_AND_TRUST_PROVENANCE_AUDIT_REPORT.md)  
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

A specialized file-system audit of the Step 2D-2A-AO-U report (`Dispatch-RollbackResultV21`) revealed a critical **silent exception suppression defect** in the discard artifact existence verification pipeline:

1. **`File.Exists()` Silent Error Suppression & Dead-Code Catch Block:**  
   In `Dispatch-RollbackResultV21`, Stage 3E evaluated file existence via `[System.IO.File]::Exists($discardPath)` wrapped inside a `try/catch` block. Under the official Microsoft .NET Base Class Library (BCL) specification, **`File.Exists` intentionally suppresses all filesystem exceptions internally** (including `UnauthorizedAccessException`, `PathTooLongException`, `IOException` sharing violations, and invalid device syntax) and returns `$false`. Consequently:
   - The `catch` block wrapping `[System.IO.File]::Exists()` is **dead code** and will never execute for filesystem errors.
   - If access to the discard backup path is denied (e.g. restrictive ACLs), or if the file is locked by an antivirus filter, or if the path syntax is invalid, `File.Exists` silently returns `$false`.
   - The dispatcher then immediately evaluates `if (-not $fileExists)` and declares **`DISCARD_FILE_ABSENT` (State 5C)**.
   - **Critical Diagnostic Corruption:** An unreadable, locked, or access-denied file is falsely classified as *confirmed file absence / mechanical rollback engine corruption* (State 5C) rather than an accessibility failure (**State 5B**) or path error (**State 5D**).
2. **Missing Inter-Step Race Failure Containment:**  
   The discard verification pipeline involves three sequential inspection operations: attributes inspection, size querying (`FileInfo.Length`), and stream hashing (`Get-SafeFileHashV4`). `Dispatch-RollbackResultV21` did not fully account for file state changes occurring *between* these inspection steps (e.g. file deleted after attribute check before size check, or locked between size check and stream open).
3. **Absence of Confirmed Absence Discrimination:**  
   To reliably distinguish *confirmed absence* from an *indeterminate or inaccessible query*, the implementation must bypass `File.Exists` and utilize an API that throws discrete, typed CLR exceptions (`GetAttributes`).

This report, **Step 2D-2A-AO-V**, provides the definitive architectural remediation:
- Eliminates `[System.IO.File]::Exists()` entirely from the discard verification pipeline.
- Specifies **`Dispatch-RollbackResultV22`**, anchoring primary existence, type, and accessibility validation in `[System.IO.File]::GetAttributes($discardPath)` with exhaustive, typed CLR exception discrimination.
- Maps `FileNotFoundException` and `DirectoryNotFoundException` to **confirmed absence** (State 5C), `UnauthorizedAccessException` and sharing violations to **inaccessible/locked** (State 5B), path syntax errors to **indeterminate path** (State 5D), and unexpected errors to **query failed** (State 5F).
- Fully specifies fail-closed behavior for files deleted or locked *between* inspection steps.
- Expands the outer-dispatch test suite to **96 exhaustive test specifications (DSP-01 through DSP-96)**, bringing the total system test specification count to **137 specifications**, all strictly marked `NOT EXECUTED — UNTESTED`.

> [!IMPORTANT]
> **Strict Documentation Boundary:** All operational scripts, procedures, and test specifications documented in this report are strictly **[NOT EXECUTED — UNTESTED]**. Zero operational commands of any kind were executed. Zero operational files (`postgresql.conf`, `pg_hba.conf`), Windows Firewall rules, Windows services, application source files, `.env` files, or databases were modified.

---

## 2. Findings with Exact AO-U Section & Line References

| Finding ID | Location in AO-U Report | Defect / Vulnerability Description | Technical Impact | Mandatory Correction in Step AO-V |
|---|---|---|---|---|
| **FIND-AV1** | `Dispatch-RollbackResultV21`<br/>Lines 229–251 | **`File.Exists` Silent Error Suppression:** Code executes `[System.IO.File]::Exists($discardPath)` in a `try/catch`. `File.Exists` never throws on access-denied or locked paths; it silently returns `$false`. | Dead-code `catch` block. Access-denied, locked, or malformed paths evaluate to `$false` and are falsely classified as `DISCARD_FILE_ABSENT` (State 5C corruption) instead of State 5B/5D. | Remove `File.Exists`. Use `[System.IO.File]::GetAttributes` directly with typed catch blocks for `FileNotFoundException`, `UnauthorizedAccessException`, and `IOException`. |
| **FIND-AV2** | `Dispatch-RollbackResultV21`<br/>Lines 279–299 | **Missing Inter-Step Deletion Trap in Size Check:** `FileInfo.Length` caught `UnauthorizedAccessException` and general exception, but omitted explicit trap for `FileNotFoundException`. | If the discard file is deleted between attribute inspection and size inspection, it falls into generic `State 5F` rather than discrete `DISCARD_FILE_DELETED_POST_STAT` (State 5C). | Add typed `catch [System.IO.FileNotFoundException]` in size inspection, mapping mid-flight deletion cleanly to State 5C. |
| **FIND-AV3** | `Dispatch-RollbackResultV21`<br/>Lines 325–332 | **Coarse Exception Discrimination in Hash Read Failure:** When `Get-SafeFileHashV4` returns `HASH_READ_FAILED`, the dispatcher maps unconditionally to State 5B without inspecting inner exception. | If the file was deleted between size check and stream open, the inner exception is `FileNotFoundException`, but the dispatcher reports `DISCARD_FILE_UNREADABLE` (State 5B). | Inspect inner exception of `HASH_READ_FAILED`: if `FileNotFoundException`, map to `DISCARD_FILE_DELETED_PRE_HASH` (State 5C); otherwise State 5B. |
| **FIND-AV4** | Section 9.1<br/>Lines 504–514 | **Outer-Dispatch Test Suite Coverage Gaps:** DSP suite ended at DSP-88, lacking discrete specifications for false-return ambiguity, deleted-between-checks files, locked-between-checks files, and path syntax errors. | Test specification does not test inter-step race conditions or typed BCL exception discrimination. | Expand DSP suite from 88 to 96 test specifications (DSP-01 through DSP-96). |

---

## 3. Audit 1 — `File.Exists` Semantics & Silent Error Suppression

### 3.1 BCL Implementation Details of `System.IO.File.Exists`

According to official Microsoft .NET BCL engineering specifications for `System.IO.File.Exists(string path)`:

```csharp
// Underlying .NET Runtime Pattern (CoreCLR / .NET Framework)
public static bool Exists(string path)
{
    try
    {
        if (string.IsNullOrEmpty(path)) return false;
        // Calls Win32 GetFileAttributesEx
        Interop.Kernel32.WIN32_FILE_ATTRIBUTE_DATA data = default;
        int errorCode = FillAttributeInfo(path, ref data, returnErrorOnNotFound: true);
        return errorCode == 0 && (data.dwFileAttributes & FileAttributes.Directory) == 0;
    }
    catch
    {
        // Suppresses all ArgumentException, NotSupportedException, PathTooLongException, etc.
        return false;
    }
}
```

#### The Four Fallacies of `File.Exists` in Diagnostic Dispatchers

1. **Fallacy 1: "If `File.Exists` returns `$false`, the file does not exist on disk."**  
   **Reality:** `File.Exists` returns `$false` if the caller lacks NTFS `ReadAttributes` permission, if the parent directory has restrictive DACLs, if the path length exceeds `MAX_PATH` without `\\?\` prefix, or if an invalid character is present. The file may physically exist on disk, but the query was suppressed.
2. **Fallacy 2: "The enclosing `catch` block will intercept permission or I/O errors."**  
   **Reality:** `File.Exists` catches all exceptions internally. It **never throws** `UnauthorizedAccessException`, `SecurityException`, or `IOException`. The outer `catch` block in `Dispatch-RollbackResultV21` was **dead code**.
3. **Fallacy 3: "Returning `$false` can be safely treated as mechanical failure."**  
   **Reality:** Treating `$false` as mechanical failure converts an environmental permissions defect into an accusation of data corruption against the rollback engine (**State 5C**), leading operators to suspect corrupted backups instead of addressing local ACL or EDR locking issues.
4. **Fallacy 4: "Combining `File.Exists` with `GetAttributes` provides layered safety."**  
   **Reality:** Placing `File.Exists` ahead of `GetAttributes` short-circuits the pipeline on any permission defect, preventing `GetAttributes` from ever exposing the true underlying error.

### 3.2 Safe Replacement Strategy: Direct BCL Exception Discrimination

To eliminate false-absence ambiguity, `Dispatch-RollbackResultV22` completely removes `[System.IO.File]::Exists()`. It proceeds directly to `[System.IO.File]::GetAttributes($discardPath)`, which calls Win32 `GetFileAttributesExW` and **directly throws typed CLR exceptions on failure**:

```
                                 [System.IO.File]::GetAttributes($discardPath)
                                                        |
         +----------------------------------------------+----------------------------------------------+
         |                                              |                                              |
     SUCCESS (Attributes returned)              TYPED CLR EXCEPTION THROWN                       UNEXPECTED FAULT
         |                                              |                                              |
         v                                              v                                              v
+-------------------+                      +---------------------------------------+          +-------------------+
| Bitmask Checks:   |                      | FileNotFoundException /               |          | Any other         |
| Directory == 0    |                      | DirectoryNotFoundException            |          | Exception         |
| ReparsePoint == 0 |                      |   -> State 5C: CONFIRMED ABSENCE      |          |   -> State 5F:    |
|   -> Pass to Size |                      +---------------------------------------+          |      QUERY_THREW  |
+-------------------+                      | UnauthorizedAccessException           |          +-------------------+
                                           |   -> State 5B: ACCESS_DENIED          |
                                           +---------------------------------------+
                                           | IOException (Sharing Violation)       |
                                           |   -> State 5B: FILE_LOCKED            |
                                           +---------------------------------------+
                                           | PathTooLongException / ArgumentEx     |
                                           |   -> State 5D: PATH_INVALID           |
                                           +---------------------------------------+
```

---

## 4. Audit 2 — Attributes, Size, and Hash Operation Audit

### 4.1 Exhaustive Operational Failure Matrix

| Operation Step | Underlying BCL API / Method | Expected Return Value | Potential CLR Exception | Concrete Physical Cause | Exact Mapped State | Justification |
|---|---|---|---|---|---|---|
| **Step 3E-1: Primary Attribute Inspection** | `[System.IO.File]::GetAttributes($path)` | `FileAttributes` bitmask | None (Normal return) | File exists and attributes readable | Evaluated | Proceed to bitmask checks |
| | | | `FileNotFoundException` | File absent from disk | **State 5C** (`DISCARD_FILE_ABSENT`) | Confirmed physical absence |
| | | | `DirectoryNotFoundException` | Parent folder absent | **State 5C** (`DISCARD_DIRECTORY_MISSING`) | Confirmed container absence |
| | | | `UnauthorizedAccessException` | NTFS DACL denies read | **State 5B** (`DISCARD_ATTRIBUTES_ACCESS_DENIED`) | Access restricted; NOT corruption |
| | | | `IOException` | File locked by EDR | **State 5B** (`DISCARD_ATTRIBUTES_LOCKED`) | Sharing lock; NOT corruption |
| | | | `PathTooLongException` | Path exceeds limit | **State 5D** (`DISCARD_PATH_INVALID`) | Indeterminate path syntax |
| | | | `ArgumentException` | Illegal path characters | **State 5D** (`DISCARD_PATH_INVALID`) | Indeterminate path syntax |
| | | | Generic `Exception` | CLR / driver crash | **State 5F** (`DISCARD_ATTRIBUTES_QUERY_THREW`) | Tooling execution fault |
| **Step 3E-2: Type Bitmask Checks** | `($attr -band Directory)` | Bitwise `0` | N/A | Regular file entry | Evaluated | Proceed to reparse check |
| | | Bitwise `!= 0` | N/A | Path is a directory | **State 5C** (`DISCARD_PATH_NOT_LEAF_FILE`) | Invalid object type |
| | `($attr -band ReparsePoint)` | Bitwise `0` | N/A | Regular non-reparse file | Evaluated | Proceed to size check |
| | | Bitwise `!= 0` | N/A | Symlink or junction | **State 5C** (`DISCARD_PATH_REPARSE_POINT`) | Quarantine isolation breached |
| **Step 3F: Size Inspection** | `[System.IO.FileInfo]::new($path).Length` | `long > 0` | None (Normal return) | File has content | Evaluated | Proceed to stream hashing |
| | | `long <= 0` | None (Normal return) | File truncated to 0 bytes | **State 5C** (`DISCARD_FILE_EMPTY`) | Empty quarantine artifact |
| | | | `FileNotFoundException` | Deleted between 3E & 3F | **State 5C** (`DISCARD_FILE_DELETED_POST_STAT`) | Inter-step deletion race |
| | | | `UnauthorizedAccessException` | ACL revoked between 3E & 3F | **State 5B** (`DISCARD_STAT_ACCESS_DENIED`) | Inter-step permission race |
| | | | `IOException` | Locked between 3E & 3F | **State 5B** (`DISCARD_STAT_LOCKED`) | Inter-step locking race |
| | | | Generic `Exception` | Tooling / CLR error | **State 5F** (`DISCARD_STAT_QUERY_THREW`) | Tooling execution fault |
| **Step 3G: Stream Hashing** | `Get-SafeFileHashV4 -FilePath $path` | `PSCustomObject` | `HASH_VERIFIED` + Hash match | Bytes match Trigger Hash | **State 4** | Rollback Success Authorized |
| | | | `HASH_VERIFIED` + Hash mismatch | Bytes differ from Trigger | **State 5C** (`DISCARD_HASH_MISMATCH`) | Cryptographic proof of corruption |
| | | | `HASH_READ_FAILED` (Inner: `FileNotFound`) | Deleted between 3F & 3G | **State 5C** (`DISCARD_FILE_DELETED_PRE_HASH`) | Inter-step deletion race |
| | | | `HASH_READ_FAILED` (Inner: `IOException`/Access) | Locked during OpenRead | **State 5B** (`DISCARD_FILE_UNREADABLE`) | Sharing violation during stream open |
| | | | `HELPER_EXCEPTION` | Script / helper crash | **State 5F** (`DISCARD_HELPER_EXCEPTION`) | Tooling execution fault |
| | | | Status is null / unknown | Metadata malformed | **State 5D** (`DISCARD_HASH_UNKNOWN_STATUS`) | Indeterminate status |
| | | | Helper throws CLR exception | Uncaught exception | **State 5F** (`DISCARD_HASH_QUERY_THREW`) | Tooling execution fault |

### 4.2 Behavior When File Changes Between Inspection Steps

In user-mode Windows filesystem programming, multiple discrete API calls cannot be bound in a hardware-atomic transaction without transactional NTFS (which is deprecated). The pipeline must handle mid-flight state transitions:

1. **File Deleted Between Attribute Check (3E) and Size Check (3F):**  
   - `GetAttributes` succeeds at $t_1$.
   - File is deleted by an external agent at $t_2$.
   - `FileInfo.Length` at $t_3$ throws `[System.IO.FileNotFoundException]`.
   - `Dispatch-RollbackResultV22` catches `FileNotFoundException` directly and routes to **State 5C** (`DISCARD_FILE_DELETED_POST_STAT`).
2. **File Locked Between Attribute Check (3E) and Size Check (3F):**  
   - An antivirus scanner opens an exclusive handle at $t_2$.
   - `FileInfo.Length` at $t_3$ throws `[System.IO.IOException]`.
   - Caught and routed to **State 5B** (`DISCARD_STAT_LOCKED`).
3. **File Deleted Between Size Check (3F) and Stream Open (3G):**  
   - `FileInfo.Length` succeeds at $t_3$.
   - File is deleted at $t_4$.
   - `Get-SafeFileHashV4` attempts `[System.IO.File]::OpenRead` at $t_5$ and encounters `FileNotFoundException`.
   - Helper returns `Status = "HASH_READ_FAILED"` with `Error = [FileNotFoundException]`.
   - Dispatcher inspects inner error and routes to **State 5C** (`DISCARD_FILE_DELETED_PRE_HASH`).
4. **File Modified / Truncated Between Size Check (3F) and Stream Open (3G):**  
   - File bytes are altered at $t_4$.
   - Stream opens successfully at $t_5$, and SHA-256 digest is calculated.
   - Digest does not match `$ExpectedTriggerHash`.
   - Dispatcher detects mismatch and routes to **State 5C** (`DISCARD_HASH_MISMATCH`).

### 4.3 Terminal Fail-Closed Guarantee

Every non-success branch in `Dispatch-RollbackResultV22` follows an immutable structural pattern:
```powershell
Enter-ManualRecoveryBoundaryV14 ... -Detail "[STATE XX: ...] ..."
throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: ...")
```
Even if `Enter-ManualRecoveryBoundaryV14` returns normally without throwing, execution cannot fall through to subsequent dispatch checks.

---

## 5. Hardened Operational Specification: `Dispatch-RollbackResultV22`

Below is the complete, hardened operational specification for `Dispatch-RollbackResultV22`:

```powershell
# [NOT EXECUTED — UNTESTED OPERATIONAL PROCEDURE]

function Dispatch-RollbackResultV22 {
    <#
    .SYNOPSIS
        Outer rollback-result dispatcher with terminal fail-closed control flow,
        complete elimination of File.Exists silent suppression, typed BCL exception
        discrimination, and inter-step race containment.
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
        # Eliminates File.Exists silent suppression defect; exposes underlying filesystem errors
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
        catch [System.IO.PathTooLongException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] DISCARD_PATH_INVALID: Discard path exceeds system length limit: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard path invalid.")
        }
        catch [System.ArgumentException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] DISCARD_PATH_INVALID: Discard path contains invalid characters: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard path invalid.")
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

        # 3F. Discard Non-Zero Length Assertion via BCL FileInfo (With Inter-Step Race Containment)
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

        # 3G. Independent Discard Cryptographic Hash Calculation (With Inner Exception Discrimination)
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

## 6. Discard Outcome Architecture & State Mapping Taxonomy (22-Class)

The discard artifact validation taxonomy is expanded from 18 to **22 discrete operational outcomes**, providing complete coverage for inter-step race conditions and typed BCL exceptions:

| Outcome ID | Concrete Physical Condition on Disk / Memory | Exception / Status Trapped | Target State | Terminal Action | Rationale for State Assignment |
|---|---|---|---|---|---|
| **DISC-01** | Discard path parameter missing or empty | `$RollbackResult.DiscardBackup` is `$null`/whitespace | **State 5D** | Local Terminal Throw | Metadata omission in engine return object; indeterminate state. |
| **DISC-02** | Discard file absent from disk | `GetAttributes` throws `FileNotFoundException` | **State 5C** | Local Terminal Throw | Confirmed physical absence of quarantine file; mechanical failure. |
| **DISC-03** | Discard directory container absent | `GetAttributes` throws `DirectoryNotFoundException`| **State 5C** | Local Terminal Throw | Parent folder missing; structural mechanical failure. |
| **DISC-04** | Discard attributes access denied | `GetAttributes` throws `UnauthorizedAccessException`| **State 5B** | Local Terminal Throw | Permissions restriction; file exists but inaccessible. NOT corruption. |
| **DISC-05** | Discard attributes locked by external process | `GetAttributes` throws `IOException` | **State 5B** | Local Terminal Throw | Sharing violation / lock. NOT corruption. |
| **DISC-06** | Discard path exceeds system length limit | `GetAttributes` throws `PathTooLongException` | **State 5D** | Local Terminal Throw | Indeterminate path syntax. |
| **DISC-07** | Discard path contains invalid characters | `GetAttributes` throws `ArgumentException` | **State 5D** | Local Terminal Throw | Indeterminate path syntax. |
| **DISC-08** | `GetAttributes` throws unexpected CLR exception | Trapped in general `catch` block | **State 5F** | Local Terminal Throw | Tooling / OS exception inspecting attributes. |
| **DISC-09** | Discard path is a directory container | `($attr -band Directory) -ne 0` | **State 5C** | Local Terminal Throw | Artifact is a directory container, not a leaf file. |
| **DISC-10** | Discard path is a reparse point (symlink/junction)| `($attr -band ReparsePoint) -ne 0` | **State 5C** | Local Terminal Throw | Reparse point aliases external location; quarantine isolation breached. |
| **DISC-11** | Discard deleted between attribute and size checks | `FileInfo.Length` throws `FileNotFoundException` | **State 5C** | Local Terminal Throw | Mid-flight deletion race; file vanished post-stat. |
| **DISC-12** | Discard size query access denied | `FileInfo.Length` throws `UnauthorizedAccessException`| **State 5B** | Local Terminal Throw | Permissions denied during size query. |
| **DISC-13** | Discard size query encounters sharing violation | `FileInfo.Length` throws `IOException` | **State 5B** | Local Terminal Throw | File locked by scanner between attribute and size checks. |
| **DISC-14** | Discard size query throws unexpected exception | `FileInfo.Length` throws general exception | **State 5F** | Local Terminal Throw | Tooling / OS exception querying size. |
| **DISC-15** | Discard file is empty (0 bytes) | `$discardLength -le 0` | **State 5C** | Local Terminal Throw | Truncated or empty quarantine artifact. |
| **DISC-16** | Discard deleted before hash calculation stream open| Helper returns `HASH_READ_FAILED` (Inner: `FileNotFound`)| **State 5C** | Local Terminal Throw | Mid-flight deletion race; vanished before stream open. |
| **DISC-17** | Discard locked during hash calculation stream open | Helper returns `HASH_READ_FAILED` (Inner: `IOException`) | **State 5B** | Local Terminal Throw | Sharing lock during stream open. |
| **DISC-18** | Hash helper encounters internal exception | Helper returns `HELPER_EXCEPTION` | **State 5F** | Local Terminal Throw | Tooling execution fault inside helper. |
| **DISC-19** | Hash helper returns null object or status | `$discardHashInfo -eq $null` or `Status -eq $null` | **State 5D** | Local Terminal Throw | Indeterminate metadata from helper. |
| **DISC-20** | Discard hash calculation returns unknown status | Helper returns unrecognized status string | **State 5D** | Local Terminal Throw | Indeterminate status string from helper. |
| **DISC-21** | Discard SHA-256 does NOT match `$ExpectedTriggerHash`| `$discardHashInfo.Hash -ine $ExpectedTriggerHash` | **State 5C** | Local Terminal Throw | Cryptographic proof that quarantine payload is corrupt or altered. |
| **DISC-22** | All 8 BCL checks & cryptographic comparisons pass | All checks satisfied; hash matches exactly | **State 4** | Success Throw | Validated quarantine artifact and verified restored configuration. |

---

## 7. Revised Test Matrix & Reconciled 4-Dimensional Counts

### 7.1 Newly Added Outer-Dispatch Test Specifications (DSP-89 through DSP-96)

To provide exhaustive test specification coverage for all findings in Step AO-V, eight new test specifications are added to the outer-dispatch test suite:

| Test ID | Input Scenario / Failure Injection | Expected Result Flag | Dispatch Path / Trigger | Target State | Mapped Diagnostic State | Expected Control Flow | Physical Disk State Guarantee |
|---|---|---|---|---|---|---|---|
| **DSP-89** | False-return ambiguity: Discard path has restrictive ACLs | `$true` | `GetAttributes` throws `UnauthorizedAccessException` | **State 5B** | 5B | Local Throw | Candidate: Retained; Backup: Retained; Discard: Access Denied; Live: Restored. NOT false 5C. |
| **DSP-90** | Discard parent directory absent | `$true` | `GetAttributes` throws `DirectoryNotFoundException` | **State 5C** | 5C | Local Throw | Candidate: Retained; Backup: Retained; Discard: Directory Absent; Live: Restored. |
| **DSP-91** | Discard path exceeds MAX_PATH or contains illegal chars | `$true` | `GetAttributes` throws `PathTooLongException` / `ArgumentException` | **State 5D** | 5D | Local Throw | Candidate: Retained; Backup: Retained; Discard: Invalid Syntax; Live: Restored. |
| **DSP-92** | Mid-flight race: Discard deleted between attributes and size checks | `$true` | `FileInfo.Length` throws `FileNotFoundException` | **State 5C** | 5C | Local Throw | Candidate: Retained; Backup: Retained; Discard: Deleted Post-Stat; Live: Restored. |
| **DSP-93** | Mid-flight race: Discard locked between attributes and size checks | `$true` | `FileInfo.Length` throws `IOException` | **State 5B** | 5B | Local Throw | Candidate: Retained; Backup: Retained; Discard: Locked Post-Stat; Live: Restored. |
| **DSP-94** | Mid-flight race: Discard deleted before hash calculation stream open | `$true` | `Get-SafeFileHashV4` inner error is `FileNotFoundException` | **State 5C** | 5C | Local Throw | Candidate: Retained; Backup: Retained; Discard: Deleted Pre-Hash; Live: Restored. |
| **DSP-95** | Mid-flight race: Discard locked by scanner before hash stream open | `$true` | `Get-SafeFileHashV4` inner error is `IOException` sharing violation | **State 5B** | 5B | Local Throw | Candidate: Retained; Backup: Retained; Discard: Locked Pre-Hash; Live: Restored. |
| **DSP-96** | Size inspection encounters unexpected CLR exception | `$true` | `FileInfo.Length` throws unexpected `SecurityException` | **State 5F** | 5F | Local Throw | Candidate: Retained; Backup: Retained; Discard: Indeterminate; Live: Restored. |

### 7.2 Complete 4-Dimensional Engineering Accounting Model

#### Dimension 1: Syntactic AST Decision Points
- Pre-Flight Replacement Engine (PF-0 through PF-4B): **41 decision points**
- Replacement Swap & Post-Swap Live Inspection (Stages 2–3): **17 decision points**
- Recovery Boundary Non-Mutating Diagnostics: **7 decision points**
- Dispatcher V22 Decision Points: **39 decision points**
  - Stage 0: 4 checks (Baseline null/whitespace, Baseline regex, Trigger null/whitespace, Trigger regex)
  - Stage 1: 1 check (RollbackResult null)
  - Stage 2: 2 contradiction traps
  - Stage 3: 25 evidence checks & try/catch branches (RestoredHash null, regex, mismatch; DiscardPath null; GetAttributes try/catch with 6 typed catch blocks, directory bitmask, reparse bitmask; FileInfo try/catch with 4 typed catch blocks, length <= 0; Get-SafeFileHash try/catch, null-check, switch with inner exception discrimination)
  - Stage 4: 1 check (rbStatus null/empty)
  - Stage 5: 6 switch branches across 54 failure statuses
- **Total Syntactic AST Decision Points:** $41 + 17 + 7 + 39 = \mathbf{104 \text{ decision points}}$.

#### Dimension 2: Semantic Pipeline Outcome Paths
- Pre-Flight Replacement Outcomes: **50 semantic paths**
- Replacement Swap & Post-Swap Live Barrier Outcomes: **19 semantic paths**
- Rollback Engine Internal Return Paths: **55 return paths**
- Recovery Diagnostic Outcomes: **7 diagnostic paths**
- Outer Dispatcher Discard Validation Outcome Paths: **22 distinct paths** (DISC-01 through DISC-22)
- **Total Semantic Pipeline Outcome Paths:** $50 + 19 + 55 + 7 + 22 = \mathbf{153 \text{ paths}}$.

#### Dimension 3: Defined Test Specifications
- Replacement Pre-Flight & Promotion Suite: TEST-01 through TEST-34 (**34 specifications**)
- Outer-Dispatch Integrity Suite: DSP-01 through DSP-96 (**96 specifications**)
- Recovery Diagnostic Suite: REC-01 through REC-07 (**7 specifications**)
- **Total Test Specifications Defined:** $34 + 96 + 7 = \mathbf{137 \text{ test specifications}}$.

#### Dimension 4: Executed Operational Tests
- **Executed Operational Tests:** **ZERO (0).**  
  All 137 test specifications are strictly marked **[NOT EXECUTED — UNTESTED]**.

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
  Real-time antivirus filters (e.g. Windows Defender, CrowdStrike) frequently lock newly created `.discard` and `.golden` files during quarantine scanning. `Dispatch-RollbackResultV22` safely handles this via CLR exception trapping routing to `DISCARD_ATTRIBUTES_LOCKED` or `DISCARD_STAT_LOCKED` (State 5B), preventing false success or false corruption classification. However, operational retry timing under active corporate EDR policies remains unverified.

---

## 9. Explicit Execution-Status & Safety Confirmation

### 9.1 Precise Execution-Status Accounting

To maintain absolute transparency and compliance:

- **Operational Procedures & Scripts:** **ZERO (0) EXECUTED.**  
  `Dispatch-RollbackResultV22`, `Invoke-SafeConfigReplacementV17`, `Invoke-ControlledRollbackV15`, `Enter-ManualRecoveryBoundaryV14`, and all 137 test specifications are strictly **[NOT EXECUTED — UNTESTED]**.
- **Read-Only Diagnostic Commands:** **ZERO (0)** commands were executed in Step AO-V.
  (In Step AO, exactly one diagnostic command was run: `powershell -Command "Test-Path -Path 'docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md'"` returning `False`).
- **Host & Database Alterations:** **ZERO (0).** No configuration files (`postgresql.conf`, `pg_hba.conf`), Windows Firewall rules, Windows services, application code, or `.env` files were modified. No databases, schemas, tables, roles, or records were created, altered, or dropped.
- **Cloud Connections:** **ZERO (0).** No connections made to Neon, AWS, Supabase, Render, or any remote infrastructure.
- **Budget Preservation:** Strict ₹0/month budget preserved.
- **Preserved Application Databases:** Catalogs `hisecure_erp`, `hitech_platform`, and `zentra_test` remain completely untouched.

---

```
STOP — STEP 2D-2A-AO-V COMPLETE — WAITING FOR HUMAN REVIEW
```
