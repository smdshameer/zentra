# MUSE SPARK — ZENTRA STEP 2D-2A-AO-AB
## CANDIDATE HASH PARAMETER PROVENANCE & OUTCOME SEMANTICS AUDIT REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Target Repository:** `D:\Zentra`  
**Input Reference:** [`docs/MUSE_SPARK_STEP2D_2A_AO_AA_MISSING_DIRECTORY_EXCEPTION_AUDIT_REPORT.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_AO_AA_MISSING_DIRECTORY_EXCEPTION_AUDIT_REPORT.md)  
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

A comprehensive parameter provenance and semantic control-flow audit of Step 2D-2A-AO-AA (`Dispatch-RollbackResultV27`) identified **two critical specification defects**:

1. **Undeclared Variable & Ambient Scope Leakage (`$CandidateHash`):**  
   In `Dispatch-RollbackResultV27` (lines 244–267 of the AO-AA report), the parameter `$CandidateHash` was **omitted from the function's `param(...)` block**.  
   Despite being undeclared, `$CandidateHash` was actively passed into `Enter-ManualRecoveryBoundaryV14` across **42 distinct error and recovery call sites** (e.g., lines 274, 281, 288, 306, 317, 343, 365, 411, 452, 470, etc.).  
   **Technical Hazard:** In PowerShell, referencing an undeclared variable within a function does not trigger a compile-time or binding error; instead, PowerShell resolves the variable dynamically up the call stack via ambient dynamic scoping. If a parent scope defines `$CandidateHash`, that value is silently leaked into the recovery boundary. If no parent scope defines it, `$null` is passed. In either case, the parameter was never validated against the SHA-256 format (`^[A-Fa-f0-9]{64}$`), violating the fail-closed defense-in-depth invariant established for trust roots in Stage 0.
2. **Semantic Dualism of "Outcome 4 / Rollback Success" vs. Terminal Abort:**  
   In Stage 3 of `Dispatch-RollbackResultV27` (lines 575–579), when all evidence checks succeed, the dispatcher outputs:  
   `[OUTCOME 4: ROLLBACK SUCCESS] Original configuration verified and restored ...`  
   and immediately executes:  
   `throw "FAIL-CLOSED ABORT [OUTCOME 4]: ... live service safe."`  
   **Semantic Audit Finding:** There is an inherent conceptual tension between the word *"SUCCESS"* and a terminating *`throw`*. To external callers and automated orchestration pipelines, "SUCCESS" implies that the requested deployment succeeded and that dependent workflows (e.g., service restart, migration execution, schema updates) may proceed. In reality, **the candidate deployment failed, and the configuration was reverted to the baseline**. The terminal `throw` is semantically mandatory to halt the deployment pipeline fail-closed, but the diagnostic messaging must explicitly distinguish between **Rollback Verification Success** (the baseline was restored and verified) and **Deployment Pipeline Abort** (the proposed replacement was rejected; further deployment steps must not execute).

---

## 2. Summary of Identified Audit Findings

| Finding ID | Source Report Location | Description | Impact | Remediation in Step AO-AB |
|---|---|---|---|---|
| **FIND-AB1** | `Dispatch-RollbackResultV27`<br/>Lines 244–267 | **Omission of `$CandidateHash` in `param(...)`:** `$CandidateHash` passed to 42 recovery invocations but undeclared in the function signature. | Ambient dynamic scope leakage; unverified `$null` or stale caller data passed into forensic incident reports. | Formally declare `[Parameter(Mandatory = $true)][string]$CandidateHash` in the parameter block. |
| **FIND-AB2** | `Dispatch-RollbackResultV27`<br/>Lines 269–285 | **Missing Stage 0 Validation for `$CandidateHash`:** Stage 0 validated baseline and trigger hashes, but omitted candidate hash. | Malformed or missing candidate hashes bypass trust-root checks. | Add Stage 0 assertions enforcing null/whitespace check and 64-hex SHA-256 regex validation (`CALLER_CANDIDATE_HASH_*`). |
| **FIND-AB3** | Section 3 & 4 (All Reports)<br/>Step AO through AO-AA | **Unspecified Candidate Hash Provenance Contract:** Lack of formal contract defining where `$CandidateHash` originates and prohibiting silent substitution. | Risk of engineers inventing a candidate hash or substituting the trigger hash when missing. | Formalize provenance contract: `$CandidateHash` represents `$H_cand_pre` (pre-change candidate fingerprint). Strict prohibition on synthetic substitution. |
| **FIND-AB4** | `Dispatch-RollbackResultV27`<br/>Lines 575–579 | **Semantic Conflation of Rollback Success vs. Deployment Abort:** Message states `[OUTCOME 4: ROLLBACK SUCCESS]` immediately before a terminating `throw`. | Calling CI/CD or automation may mistake rollback recovery for a successful configuration rollout. | Refine diagnostic messaging to `[OUTCOME 4: ROLLBACK VERIFICATION SUCCEEDED — DEPLOYMENT ABORTED FAIL-CLOSED]`. Formalize terminal throw invariant. |
| **FIND-AB5** | Section 8.1<br/>Lines 730–742 | **Test Coverage Gaps for Candidate Hash Binding & Provenance:** Suite ended at DSP-127, lacking discrete specifications for candidate hash validation and Outcome 4 terminal halt. | Parameter binding defects and scope leakage remain untested. | Expand DSP suite from 127 to **133 test specifications (`DSP-01` through `DSP-133`)**. |

---

## 3. Finding 1 — `$CandidateHash` Parameter Provenance & Scope Leakage Audit

### 3.1 Every Reference to `$CandidateHash` in `Dispatch-RollbackResultV27`

In `Dispatch-RollbackResultV27`, the token `$CandidateHash` appears **42 times**, exclusively as an argument passed to `Enter-ManualRecoveryBoundaryV14`:

1. Line 274: `CALLER_BASELINE_HASH_INVALID` (Stage 0)
2. Line 281: `CALLER_TRIGGER_HASH_INVALID` (Stage 0)
3. Line 288: `ROLLBACK_RESULT_NULL` (Stage 1)
4. Line 297: `CONTRADICTION_SUCCESS_STATUS_MISMATCH` (Stage 2)
5. Line 306: `CONTRADICTION_FAILURE_STATUS_MISMATCH` (Stage 2)
6. Line 317: `RESTORED_HASH_MISSING` (Stage 3A)
7. Line 325: `RESTORED_HASH_MALFORMED` (Stage 3B)
8. Line 334: `RESTORED_HASH_MISMATCH` (Stage 3C)
9. Line 343: `DISCARD_PATH_MISSING` (Stage 3D)
10. Line 352: `DISCARD_FILE_ABSENT` (Stage 3E)
11. Line 365: `DISCARD_DIRECTORY_MISSING` (Stage 3E)
12. Line 372: `DISCARD_PATH_INVALID` (Stage 3E - Length)
13. Line 379: `DISCARD_PATH_INVALID` (Stage 3E - Argument)
14. Line 386: `DISCARD_ATTRIBUTES_ACCESS_DENIED` (Stage 3E)
15. Line 395: `DISCARD_ATTRIBUTES_SHARING_VIOLATION` (Stage 3E)
16. Line 402: `DISCARD_ATTRIBUTES_IO_UNDETERMINED` (Stage 3E)
17. Line 411: `DISCARD_ATTRIBUTES_QUERY_THREW` (Stage 3E)
18. Line 418: `DISCARD_PATH_NOT_LEAF_FILE` (Stage 3E-1)
19. Line 431: `DISCARD_PATH_REPARSE_POINT` (Stage 3E-2)
20. Line 439: `DISCARD_FILE_DELETED_POST_STAT` (Stage 3F)
21. Line 452: `DISCARD_DIRECTORY_DELETED_POST_STAT` (Stage 3F)
22. Line 461: `DISCARD_STAT_PATH_TOO_LONG` (Stage 3F)
23. Line 470: `DISCARD_STAT_ARGUMENT_INVALID` (Stage 3F)
24. Line 479: `DISCARD_STAT_ACCESS_DENIED` (Stage 3F)
25. Line 488: `DISCARD_STAT_SHARING_VIOLATION` (Stage 3F)
26. Line 497: `DISCARD_STAT_IO_UNDETERMINED` (Stage 3F)
27. Line 506: `DISCARD_STAT_QUERY_THREW` (Stage 3F)
28. Line 513: `DISCARD_FILE_EMPTY` (Stage 3F)
29. Line 525: `DISCARD_HASH_QUERY_THREW` (Stage 3G)
30. Line 532: `DISCARD_HASH_NULL_RESULT` (Stage 3G)
31. Line 542: `DISCARD_HASH_ERROR_METADATA_MISSING` (Stage 3G)
32. Line 551: `DISCARD_FILE_DELETED_PRE_HASH` (Stage 3G)
33. Line 560: `DISCARD_DIRECTORY_DELETED_PRE_HASH` (Stage 3G)
34. Line 568: `DISCARD_HASH_PATH_TOO_LONG` (Stage 3G)
35. Line 588: `ROLLBACK_RESULT_NULL_STATUS` (Stage 4)
36. Line 601: `STATE 5A` (Stage 5)
37. Line 610: `STATE 5B` (Stage 5)
38. Line 626: `STATE 5C` (Stage 5)
39. Line 642: `STATE 5D` (Stage 5)
40. Line 651: `STATE 5E` (Stage 5)
41. Line 665: `STATE 5F` (Stage 5)
42. Line 674: `UNRECOGNIZED_STATUS` (Stage 5 Default)

### 3.2 The Mechanism of Ambient Dynamic Scope Leakage

In PowerShell, variables not explicitly declared as local parameters or local assignments resolve by walking up the execution call stack (`Get-Variable` dynamic lookup).

```powershell
# SCRIPT SCOPE / CALLER SCOPE
$CandidateHash = "STALE_OR_MALICIOUS_HASH_FROM_EARLIER_PHASE"
Invoke-SafeConfigReplacement ...
    # Inside Dispatch-RollbackResultV27:
    # param([PSCustomObject]$RollbackResult, [string]$LiveConfigPath, ...)
    # Notice: $CandidateHash was NOT declared in param()!
    Enter-ManualRecoveryBoundaryV14 ... -CandidateHash $CandidateHash
    # PowerShell resolves $CandidateHash from caller scope!
```

**Consequences of this Defect:**
1. **Loss of Determinism:** If the caller scope does not define `$CandidateHash`, `$CandidateHash` evaluates to `$null` without any warning or error.
2. **Pollution of Forensic Audit Trail:** If a parent scope previously processed a different candidate configuration (e.g., in a batch runner or retry loop), that stale hash is forwarded to `Enter-ManualRecoveryBoundaryV14` and recorded in the forensic report (`Write-Host "  Candidate Hash: $CandidateHash"`), corrupting incident triage.
3. **Bypass of Validation:** Because `$CandidateHash` was not declared as a formal parameter, it could not be decorated with `[Parameter(Mandatory = $true)]` or validated against `$sha256Regex` in Stage 0.

---

## 4. Safe Parameter Contract Specification for `CandidateHash`

### 4.1 Provenance of `CandidateHash`

In the ZENTRA configuration management architecture:
- `LiveConfigPath`: Path to the active PostgreSQL configuration file (`postgresql.conf`).
- `GoldenBackupPath`: Path to the immutable pre-change baseline backup.
- `ExpectedBaselineHash` ($H_{\text{live\_pre}}$): SHA-256 hash of the known-good baseline, measured before any operation.
- `ExpectedTriggerHash` ($H_{\text{trigger}}$): SHA-256 hash of the live file that triggered the rollback, measured immediately before rollback initiation.
- **`CandidateHash` ($H_{\text{cand\_pre}}$):** The cryptographic SHA-256 fingerprint of the **proposed new configuration file**, measured and verified during Stage 1 pre-flight validation of `Invoke-SafeConfigReplacement`.

### 4.2 Mandatory vs. Optional Analysis

We evaluate two architectural options for `CandidateHash` in `Dispatch-RollbackResult`:

| Architecture Option | Description | Trade-offs | Verdict |
|---|---|---|---|
| **Option A: Optional Parameter** | `[Parameter(Mandatory = $false)][string]$CandidateHash` | Allows `Dispatch-RollbackResult` to be called in non-deployment scenarios (e.g., standalone rollback of unexpected drift). However, permits callers to accidentally omit it during deployment failures, leading to empty audit fields. | **REJECTED.** Opens a path for caller omission bugs. |
| **Option B: Mandatory Parameter with Strict Stage 0 Validation** | `[Parameter(Mandatory = $true)][string]$CandidateHash` | Enforces that every caller must explicitly supply the candidate hash. Validated in Stage 0 against `^[A-Fa-f0-9]{64}$`. | **ACCEPTED (RECOMMENDED).** Guarantees zero ambient scope leakage, full parameter encapsulation, and complete forensic audit integrity. |

### 4.3 Strict Prohibition Against Synthetic Substitution

Under **zero circumstances** may `Dispatch-RollbackResult` or any caller:
1. Synthesize a candidate hash by computing a hash on an unverified temporary file.
2. Silently substitute `$ExpectedTriggerHash` or `$ExpectedBaselineHash` when `$CandidateHash` is missing.
3. Default `$CandidateHash` to an empty string or dummy placeholder.

**Architectural Law:** If `$CandidateHash` is missing or malformed, the caller has violated the operational contract. The dispatcher must halt fail-closed in Stage 0 with **State 5D (`CALLER_CANDIDATE_HASH_INVALID`)**.

---

## 5. Finding 2 — Outcome 4 Semantics: Rollback Success vs. Deployment Abort

### 5.1 The Semantic Tension in Outcome 4

In Step AO Section 2.3 and Step AO-R Section 2.1, Outcome 4 is defined as:
```powershell
Write-Host "[OUTCOME 4: ROLLBACK SUCCESS] Original configuration verified and restored [SHA256: $($RollbackResult.RestoredHash)]." -ForegroundColor Yellow
Write-Host "[OUTCOME 4: ARTIFACT STATUS] Golden backup [$GoldenBackupPath] and Discard backup [$discardPath] independently verified on disk." -ForegroundColor Yellow
throw "FAIL-CLOSED ABORT [OUTCOME 4]: $ContextName failed ($($TriggerError.Message)), but rollback successfully restored original configuration. Live service safe."
```

An audit of developer expectations and automated deployment frameworks reveals a critical ambiguity:
- **"SUCCESS"** conveys to an orchestration tool that the target state was achieved and subsequent tasks (e.g., applying database schema migrations, restarting application pools) should continue.
- **However, the proposed configuration was NEVER applied.** The system successfully averted disaster by retreating to the previous baseline configuration.
- If a pipeline treats Outcome 4 as a normal success (e.g., exit code 0 without an exception), it might attempt to run database migrations designed for the new configuration against a PostgreSQL cluster running the old configuration, causing application downtime or data corruption.

### 5.2 Why the Terminal `throw` is Mathematically Mandatory

The terminal `throw` in Stage 3 is not an error in the recovery; it is the **mandatory mechanism to abort the deployment pipeline fail-closed**:

$$\text{Operation Outcome} = \text{Replacement Failed} \land \text{Rollback Succeeded} \implies \mathbf{Deploy Abort (ExitCode \neq 0)}$$

1. **Halts Sequential Execution:** In PowerShell, a terminating `throw` immediately halts script execution and prevents pipeline progression unless explicitly intercepted.
2. **Signals Calling Orchestrators:** CI/CD runners (GitHub Actions, Azure DevOps, Jenkins) intercept uncaught PowerShell terminating exceptions and report job failure (Exit Code 1), preventing automated traffic routing to the node.
3. **Live Service Safety Guaranteed:** While the deployment failed, the live service remains on the verified original baseline.

### 5.3 Diagnostic Messaging Refinement

To eliminate any misunderstanding while preserving the terminal throw, `Dispatch-RollbackResultV28` refines its terminal output:

```
[OUTCOME 4: ROLLBACK VERIFICATION SUCCEEDED — DEPLOYMENT ABORTED FAIL-CLOSED]
- Original baseline configuration verified and restored [SHA256: ...]
- Live PostgreSQL service safe on original configuration.
- Proposed configuration change was REJECTED and quarantined.
- Deployment pipeline MUST NOT PROCEED. Halting execution fail-closed.
```

---

## 6. Authoritative PowerShell Implementation: `Dispatch-RollbackResultV28`

```powershell
function Dispatch-RollbackResultV28 {
    <#
    .SYNOPSIS
        Evaluates the outcome of a controlled configuration rollback operation with
        exhaustive evidence validation, formal parameter provenance, precise .NET
        exception inheritance handling, and fail-closed terminal execution boundaries.
    .DESCRIPTION
        Step 2D-2A-AO-AB remediation:
        1. Formally declares [string]$CandidateHash as a mandatory parameter, eliminating
           ambient dynamic scope leakage.
        2. Implements Stage 0 caller validation for $CandidateHash (null check + 64-hex regex).
        3. Clarifies Outcome 4 diagnostic semantics: Rollback verification succeeded, but
           the overall deployment is aborted fail-closed via mandatory terminal throw.
        4. Preserves Stage 3F DirectoryNotFoundException handling and 35-class taxonomy.
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
    .PARAMETER CandidateHash
        The 64-character hex SHA-256 hash of the candidate configuration file being promoted.
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
        [string]$CandidateHash,

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
    # 0A. Validate ExpectedBaselineHash
    if ([string]::IsNullOrWhiteSpace($ExpectedBaselineHash) -or ($ExpectedBaselineHash -notmatch $sha256Regex)) {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
            -Detail "[STATE 5D: $ContextName] CALLER_BASELINE_HASH_INVALID: Expected baseline hash is missing or not a valid 64-char SHA-256 hex string. Fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: ExpectedBaselineHash is invalid.")
    }

    # 0B. Validate ExpectedTriggerHash
    if ([string]::IsNullOrWhiteSpace($ExpectedTriggerHash) -or ($ExpectedTriggerHash -notmatch $sha256Regex)) {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
            -Detail "[STATE 5D: $ContextName] CALLER_TRIGGER_HASH_INVALID: Expected trigger hash is missing or not a valid 64-char SHA-256 hex string. Fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: ExpectedTriggerHash is invalid.")
    }

    # 0C. Validate CandidateHash (Provenance & Integrity Assertion)
    if ([string]::IsNullOrWhiteSpace($CandidateHash) -or ($CandidateHash -notmatch $sha256Regex)) {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
            -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
            -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
            -Detail "[STATE 5D: $ContextName] CALLER_CANDIDATE_HASH_INVALID: CandidateHash parameter is missing or not a valid 64-char SHA-256 hex string. Fail-closed."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: CandidateHash is invalid.")
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

        # 3F. Discard Non-Zero Length Assertion via BCL FileInfo (Corrected Catch Order in V27/V28)
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

        # ALL EVIDENCE CHECKS STRICTLY SATISFIED -> OUTCOME 4 AUTHORIZED
        # DIAGNOSTIC SEMANTICS: ROLLBACK VERIFICATION SUCCEEDED, BUT DEPLOYMENT IS ABORTED FAIL-CLOSED
        Write-Host "[OUTCOME 4: ROLLBACK VERIFICATION SUCCEEDED] Original configuration verified and restored [SHA256: $($RollbackResult.RestoredHash)]." -ForegroundColor Yellow
        Write-Host "[OUTCOME 4: ARTIFACT STATUS] Golden backup [$GoldenBackupPath] and Discard backup [$discardPath] independently verified on disk." -ForegroundColor Yellow
        Write-Host "[OUTCOME 4: DEPLOYMENT STATUS] Candidate configuration rejected. Deployment pipeline halted fail-closed. Live service remains on baseline." -ForegroundColor Yellow
        throw "FAIL-CLOSED ABORT [OUTCOME 4]: $ContextName failed ($($TriggerError.Message)), but rollback successfully restored original configuration. Deployment pipeline terminated. Live service safe."
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

The 35-class Discard Outcome Architecture is preserved intact from Step AO-AA:

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
| **DISC-13** | Discard directory deleted between attribute and size checks | `FileInfo.Length` throws `DirectoryNotFoundException` | **State 5C** | Local Terminal Throw | Mid-flight directory removal during size query. |
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

### 8.1 Newly Added Outer-Dispatch Test Specifications (DSP-128 through DSP-133)

To validate the formal declaration, Stage 0 validation of `$CandidateHash`, and Outcome 4 fail-closed abort semantics, six new test specifications are added to the outer-dispatch test suite:

| Test ID | Input Scenario / Failure Injection | Expected Result Flag | Dispatch Path / Trigger | Target State | Mapped Diagnostic State | Expected Control Flow | Physical Disk State Guarantee |
|---|---|---|---|---|---|---|---|
| **DSP-128**| `CandidateHash` missing or whitespace in Stage 0 | `$true` | `$CandidateHash` is `$null` or empty string | **State 5D** | 5D | Local Throw | Candidate: Retained; Backup: Retained; Discard: Retained; Live: Restored. Stage 0 fails closed. |
| **DSP-129**| `CandidateHash` malformed in Stage 0 (e.g. 63 chars / non-hex) | `$true` | `$CandidateHash -notmatch $sha256Regex` | **State 5D** | 5D | Local Throw | Candidate: Retained; Backup: Retained; Discard: Retained; Live: Restored. Stage 0 fails closed. |
| **DSP-130**| Ambient dynamic scope leakage prevention | `$true` | Caller environment defines `$CandidateHash`, but argument omitted | **State 5D** | 5D | Local Throw | Parameter binding error / Stage 0 interception prevents dynamic inheritance. |
| **DSP-131**| Valid `CandidateHash` parameter binding & transmission | `$true` | Valid 64-hex passed to `-CandidateHash` | **State 5D** | 5D | Local Throw | Candidate hash cleanly transmitted to recovery boundary without scope leakage. |
| **DSP-132**| Outcome 4 Terminal Fail-Closed Abort Invariant | `$true` | All Stage 3 evidence checks pass | **State 4** | 4 | Terminal Throw | Verified baseline live. Script strictly throws `FAIL-CLOSED ABORT [OUTCOME 4]`. Pipeline halts. |
| **DSP-133**| Outcome 4 vs. Deployment Success Non-Conflation | `$true` | Orchestration runner intercepts Outcome 4 terminal throw | **State 4** | 4 | Pipeline Abort | Deployment runner marks job as FAILED / ABORTED; prevents subsequent schema migrations. |

### 8.2 Complete 4-Dimensional Engineering Accounting Model

#### Dimension 1: Syntactic AST Decision Points
- Pre-Flight Replacement Engine (PF-0 through PF-4B): **41 decision points**
- Replacement Swap & Post-Swap Live Inspection (Stages 2–3): **17 decision points**
- Recovery Boundary Non-Mutating Diagnostics: **7 decision points**
- Dispatcher V28 Decision Points: **55 decision points** (expanded by 2 for Stage 0 candidate hash null & regex assertions)
  - Stage 0: 6 checks (Baseline null/whitespace, Baseline regex, Trigger null/whitespace, Trigger regex, Candidate null/whitespace, Candidate regex)
  - Stage 1: 1 check (RollbackResult null)
  - Stage 2: 2 contradiction traps
  - Stage 3: 39 evidence checks & try/catch branches
    - RestoredHash checks: null (1), regex (1), equality (1) = 3
    - DiscardPath check: null (1)
    - GetAttributes try/catch: 7 typed catch branches + HResult sharing check inside IOException (1) + Directory bitmask (1) + Reparse bitmask (1) = 10
    - FileInfo.Length try/catch: 7 typed catch branches (`FileNotFound`, `DirectoryNotFound`, `PathTooLong`, `Argument`, `Unauthorized`, `IOException`, general catch) + HResult sharing check inside IOException (1) + length <= 0 (1) = 9
    - Hash calculation: try/catch (1), null check (1), switch with 8-way inner exception ladder + HResult sharing check inside IOException branch (1) = 9, helper exception (1), hash null (1), hash regex (1), hash equality (1), switch default (1) = 16
  - Stage 4: 1 check (rbStatus null/empty)
  - Stage 5: 6 switch branches across 54 failure statuses
- **Total Syntactic AST Decision Points:** $41 + 17 + 7 + 55 = \mathbf{120 \text{ decision points}}$.

#### Dimension 2: Semantic Pipeline Outcome Paths
- Pre-Flight Replacement Outcomes: **50 semantic paths**
- Replacement Swap & Post-Swap Live Barrier Outcomes: **19 semantic paths**
- Rollback Engine Internal Return Paths: **55 return paths**
- Recovery Diagnostic Outcomes: **7 diagnostic paths**
- Outer Dispatcher Discard Validation Outcome Paths: **35 distinct paths** (DISC-01 through DISC-35)
- **Total Semantic Pipeline Outcome Paths:** $50 + 19 + 55 + 7 + 35 = \mathbf{166 \text{ paths}}$.

#### Dimension 3: Defined Test Specifications
- Replacement Pre-Flight & Promotion Suite: TEST-01 through TEST-34 (**34 specifications**)
- Outer-Dispatch Integrity Suite: DSP-01 through DSP-133 (**133 specifications**, expanded from 127)
- Recovery Diagnostic Suite: REC-01 through REC-07 (**7 specifications**)
- **Total Test Specifications Defined:** $34 + 133 + 7 = \mathbf{174 \text{ test specifications}}$.

#### Dimension 4: Executed Operational Tests
- **Executed Operational Tests:** **ZERO (0).**  
  All 174 test specifications are strictly marked **[NOT EXECUTED — UNTESTED]**.

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
  Real-time antivirus filters frequently lock newly created `.discard` and `.golden` files during quarantine scanning. While `Dispatch-RollbackResultV28` safely handles sharing violations and undetermined I/O faults, whether corporate EDR drivers consistently preserve standard Win32 HResult codes remains unverified at runtime.

---

## 10. Explicit Execution-Status & Safety Confirmation

### 10.1 Precise Execution-Status Accounting

To maintain absolute transparency and compliance:

- **Operational Procedures & Scripts:** **ZERO (0) EXECUTED.**  
  `Dispatch-RollbackResultV28`, `Invoke-SafeConfigReplacementV17`, `Invoke-ControlledRollbackV15`, `Enter-ManualRecoveryBoundaryV14`, and all 174 test specifications are strictly **[NOT EXECUTED — UNTESTED]**.
- **Read-Only Diagnostic Commands:** **ZERO (0)** operational commands executed.  
  (In Step AO-AB, strictly read-only repository string inspection was performed to audit parameter occurrences).
- **Host & Database Alterations:** **ZERO (0).** No configuration files (`postgresql.conf`, `pg_hba.conf`), Windows Firewall rules, Windows services, application code, or `.env` files were modified. No databases, schemas, tables, roles, or records were created, altered, or dropped.
- **Cloud Connections:** **ZERO (0).** No connections made to Neon, AWS, Supabase, Render, or any remote infrastructure.
- **Budget Preservation:** Strict ₹0/month budget preserved.
- **Preserved Application Databases:** Catalogs `hisecure_erp`, `hitech_platform`, and `zentra_test` remain completely untouched.

---

```
STOP — STEP 2D-2A-AO-AB COMPLETE — WAITING FOR HUMAN REVIEW
```
