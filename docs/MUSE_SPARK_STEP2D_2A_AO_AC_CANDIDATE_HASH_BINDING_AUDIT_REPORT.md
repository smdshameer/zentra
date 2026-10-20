# MUSE SPARK — ZENTRA STEP 2D-2A-AO-AC
## CANDIDATE HASH BINDING, PROVENANCE & TEST SEMANTICS AUDIT REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Target Repository:** `D:\Zentra`  
**Input Reference:** [`docs/MUSE_SPARK_STEP2D_2A_AO_AB_CANDIDATE_HASH_PROVENANCE_AUDIT_REPORT.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_AO_AB_CANDIDATE_HASH_PROVENANCE_AUDIT_REPORT.md)  
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

A comprehensive parameter-binding, provenance-chain, and control-flow audit of Step 2D-2A-AO-AB (`Dispatch-RollbackResultV28`) identified **four critical specification refinements**:

1. **Pre-Body Parameter Binding vs. In-Function Validation (Finding AC-1):**  
   In Step AO-AB, test specification `DSP-128` claimed that omitting mandatory parameter `CandidateHash` causes Stage 0 to execute, invoke `Enter-ManualRecoveryBoundaryV14`, and transition to State 5D.  
   **Technical Reality under PowerShell Engine Semantics:** When a parameter is decorated with `[Parameter(Mandatory = $true)]` in PowerShell, omitting it in a non-interactive script causes the PowerShell engine's **Parameter Binder** to throw a terminating `System.Management.Automation.ParameterBindingException` (`MissingMandatoryParameter`) **before the function body is ever entered**.  
   Therefore, Stage 0 does not run, `Enter-ManualRecoveryBoundaryV14` does not run, and no State 5D transition occurs. The call halts fail-closed at the engine parameter-binding barrier.  
   Conversely, if an explicit `$null` or whitespace string is passed (`-CandidateHash $null`), parameter binding succeeds (in the absence of `ValidateNotNullOrEmpty`), the function body is entered, and Stage 0 validation executes, invokes the recovery boundary, and enters State 5D. These two distinct failure mechanisms must not be merged.
2. **Cryptographic Provenance Chain vs. Syntactic Format (Finding AC-2):**  
   Matching the 64-character hexadecimal regex (`^[A-Fa-f0-9]{64}$`) verifies **string format only**; it provides zero mathematical proof of **measurement provenance**, **file identity**, or **cryptographic integrity**.  
   A safe contract requires establishing the full provenance chain: the candidate file identity ($P_{\text{cand}}$), the pre-change trusted measurement by `Get-SafeFileHashV4` producing $H_{\text{cand\_pre}}$, the immediate pre-swap barrier assertion (PF-4A), and the explicit transmission of that verified digest to the dispatcher.  
   Silent substitution of baseline or trigger hashes is strictly prohibited. If provenance evidence is missing or inconsistent, deployment must fail closed.
3. **Decoupling Outcome 4 Semantics from Deployment Continuation (Finding AC-3):**  
   In Outcome 4, rollback evidence verification succeeds (original baseline restored, discard quarantine captured and verified), but **the configuration deployment has failed**.  
   To prevent calling orchestrators from misinterpreting "ROLLBACK SUCCESS" as deployment success, `Dispatch-RollbackResultV29` enforces that Outcome 4 **strictly terminates via a fail-closed `throw`**, preventing downstream tasks (e.g., schema migrations, application startup) from executing against an obsolete baseline configuration.
4. **Reconciled Test Matrix & Counting Arithmetic (Finding AC-4):**  
   Test specifications are expanded from 127 to **135 outer-dispatch specifications (`DSP-01` through `DSP-135`)**, separating pre-body parameter binding errors, in-function null checks, in-function syntax errors, valid binding, and Outcome 4 orchestration invariants. Total test specifications across all suites reconcile to **176 specifications**, all strictly marked **`[NOT EXECUTED — UNTESTED]`**.

---

## 2. Summary of Identified Audit Findings

| Finding ID | Source Report Location | Description | Impact | Remediation in Step AO-AC |
|---|---|---|---|---|
| **FIND-AC1** | Step AO-AB<br/>DSP-128 & Section 4.2 | **Conflation of Pre-Body Parameter Binding with In-Function Validation:** Claimed omitting `CandidateHash` runs Stage 0 recovery boundary. | Inaccurate control flow description; engine throws `ParameterBindingException` before function body starts. | Formulate separate specifications: `DSP-128` (pre-body binding failure, no recovery boundary) vs. `DSP-129` (in-function null check, recovery boundary runs). |
| **FIND-AC2** | Step AO-AB<br/>Section 4.1 & 6 | **Conflation of 64-Hex Format with Trusted Provenance:** Treated regex match as proof of candidate identity. | Valid hex string could be an arbitrary unverified number, a stale hash, or an unmeasured guess. | Formalize the 4-tier provenance architecture: Format Validation $\neq$ File Identity $\neq$ Measurement Provenance $\neq$ Integrity Verification. |
| **FIND-AC3** | Step AO-AB<br/>Section 5 & DSP-132 | **Ambiguity in Outcome 4 Deployment Control Flow:** Potential for automated callers to suppress Outcome 4 throw and continue deployment. | Deployment pipeline could run migrations or restart apps assuming the candidate was applied. | Formally specify that Outcome 4 guarantees live service baseline safety but strictly aborts deployment automation fail-closed. |
| **FIND-AC4** | Step AO-AB<br/>Section 8.1 & 8.2 | **Test Matrix Precision & Counting Separation:** Suite ended at DSP-133 without separating binding exceptions from in-function checks. | Parameter binding edge cases remained unverified in specification. | Expand DSP suite from 133 to **135 specifications (`DSP-01` through `DSP-135`)**. Reconcile total test specifications to **176**. |

---

## 3. Finding AC-1 — Mandatory Parameter Binding vs. In-Function Validation

### 3.1 The Two-Phase Evaluation Architecture in PowerShell

When invoking an advanced PowerShell function decorated with `[CmdletBinding()]`, parameter processing and code execution occur in two distinct, sequential phases:

```
[Phase 1: PowerShell Engine Parameter Binder] (PRE-BODY)
  ├── 1A. Check Mandatory Parameters -> Missing? Throws ParameterBindingException (MissingMandatoryParameter)
  ├── 1B. Evaluate Parameter Validation Attributes (e.g. ValidateNotNullOrEmpty) -> Fails? Throws ValidationMetadataException
  └── 1C. Bind Arguments to Local Scope Variables
        ▼ (Binding Successful)
[Phase 2: Function Body Execution] (IN-FUNCTION)
  ├── Stage 0: Defensive Caller Parameter Validation -> Fails? Invokes Enter-ManualRecoveryBoundaryV14 -> Local Throw
  ├── Stage 1: Result Object Validation
  ├── Stage 2: Contradiction Traps
  ├── Stage 3: Discard & Live Evidence Inspection
  ├── Stage 4: Status String Validation
  └── Stage 5: Failure State Mapping Switch
```

### 3.2 Concrete Behavior Matrix for `CandidateHash`

| Call-Site Invocation Scenario | Parameter Declaration | Trapping Layer | Executed Exception / Action | Does Function Body Run? | Does Recovery Boundary Run? | Final Target State | Control Flow Guarantee |
|---|---|---|---|---|---|---|---|
| **Scenario 1:** Parameter Omitted<br/>`Dispatch-RollbackResult` (no `-CandidateHash`) | `[Parameter(Mandatory = $true)]`<br/>`[string]$CandidateHash` | **Phase 1: Engine Binder** | `ParameterBindingException`<br/>(`MissingMandatoryParameter`) | **NO** | **NO** | N/A (Engine Error) | Halts fail-closed immediately at call site. |
| **Scenario 2:** Explicit Null Passed<br/>`-CandidateHash $null` | `[Parameter(Mandatory = $true)]`<br/>`[string]$CandidateHash` | **Phase 2: Stage 0 Body** | Caught by `[string]::IsNullOrWhiteSpace()` | **YES** | **YES** | **State 5D** (`CALLER_CANDIDATE_HASH_INVALID`) | Invokes recovery boundary, then local terminal throw. |
| **Scenario 3:** Explicit Whitespace Passed<br/>`-CandidateHash "   "` | `[Parameter(Mandatory = $true)]`<br/>`[string]$CandidateHash` | **Phase 2: Stage 0 Body** | Caught by `[string]::IsNullOrWhiteSpace()` | **YES** | **YES** | **State 5D** (`CALLER_CANDIDATE_HASH_INVALID`) | Invokes recovery boundary, then local terminal throw. |
| **Scenario 4:** Malformed String (63 Hex)<br/>`-CandidateHash "a1b2...63chars"` | `[Parameter(Mandatory = $true)]`<br/>`[string]$CandidateHash` | **Phase 2: Stage 0 Body** | Caught by `$CandidateHash -notmatch $sha256Regex` | **YES** | **YES** | **State 5D** (`CALLER_CANDIDATE_HASH_INVALID`) | Invokes recovery boundary, then local terminal throw. |
| **Scenario 5:** Malformed Characters<br/>`-CandidateHash "ZZZZ...64chars"` | `[Parameter(Mandatory = $true)]`<br/>`[string]$CandidateHash` | **Phase 2: Stage 0 Body** | Caught by `$CandidateHash -notmatch $sha256Regex` | **YES** | **YES** | **State 5D** (`CALLER_CANDIDATE_HASH_INVALID`) | Invokes recovery boundary, then local terminal throw. |
| **Scenario 6:** Valid 64-Hex String<br/>`-CandidateHash "e3b0c442...64hex"` | `[Parameter(Mandatory = $true)]`<br/>`[string]$CandidateHash` | **Phase 2: Stage 0 Body** | Passes Stage 0 assertions | **YES** | Only on downstream failure | Stage 4 or downstream failure state | Bound to `$CandidateHash` and passed to Stage 1. |

**Critical Architectural Law:** When mandatory parameter binding fails in Phase 1, **no recovery handler executes**. This is safe and strictly fail-closed because:
1. The function was called improperly by an upstream developer/caller bug.
2. The filesystem was untouched by the dispatcher.
3. Execution terminates immediately with a non-zero exit code / terminating exception.

---

## 4. Finding AC-2 — Trusted Candidate Hash Provenance Chain

### 4.1 The 4-Tier Provenance Architecture

A 64-character hexadecimal string ($S \in \{0\dots 9, a\dots f\}^{64}$) does not establish trust. Trust requires an unbroken cryptographic provenance chain consisting of four distinct verification tiers:

```
[Tier 1: Format Validation] ───────> Pure syntax assertion (String matches ^[A-Fa-f0-9]{64}$)
                                     Proves ONLY that string has valid SHA-256 shape.
                                            ▼
[Tier 2: File Identity] ───────────> Path assertion ($CandidatePath is regular leaf file on volume)
                                     Proves target file exists, accessible, non-symlink.
                                            ▼
[Tier 3: Measurement Provenance] ──> Pre-change measurement event (Get-SafeFileHashV4 on Candidate)
                                     Produces H_cand_pre directly from unmutated bytes.
                                            ▼
[Tier 4: Integrity Verification] ──> Pre-swap immediate barrier assertion (PF-4A)
                                     Asserts H_cand_immediate == H_cand_pre immediately before swap.
```

### 4.2 The Complete Provenance Chain in `Invoke-SafeConfigReplacement`

```powershell
# 1. TIER 2: CANDIDATE FILE IDENTITY VALIDATION (Stage 1 Pre-Flight PF-0)
$candAttr = [System.IO.File]::GetAttributes($CandidatePath)
if (($candAttr -band [System.IO.FileAttributes]::Directory) -ne 0) { throw "Candidate is directory" }
if (($candAttr -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Candidate is symlink" }

# 2. TIER 3: TRUSTED MEASUREMENT PROVENANCE (Stage 1 Pre-Flight PF-1)
$candPreInfo = Get-SafeFileHashV4 -FilePath $CandidatePath
if ($candPreInfo.Status -ne "HASH_VERIFIED") { throw "Candidate pre-flight hash failed" }
$H_cand_pre = $candPreInfo.Hash  # TRUST ROOT ESTABLISHED

# 3. TIER 4: IMMEDIATE PRE-SWAP INTEGRITY ASSERTION (Stage 2 Pre-Swap PF-4A)
$candImmediate = Get-SafeFileHashV4 -FilePath $CandidatePath
if ($candImmediate.Hash -ne $H_cand_pre) {
    throw "FAIL-CLOSED ABORT [PRE_SWAP_CANDIDATE_MUTATED]: Candidate modified prior to swap."
}

# 4. EXPLICIT TRANSMISSION TO DISPATCHER (On Swap Failure or Post-Validation Failure)
# Verified digest $H_cand_pre is transmitted explicitly without alteration or substitution:
Dispatch-RollbackResultV29 `
    -RollbackResult $rollbackResult `
    -LiveConfigPath $LiveConfigPath `
    -GoldenBackupPath $goldenBackupPath `
    -ExpectedBaselineHash $H_live_pre `
    -ExpectedTriggerHash $liveCurrInfo.Hash `
    -CandidateHash $H_cand_pre `
    -TriggerError $replaceError `
    -ContextName "SWAP_FAILURE_RECOVERY"
```

### 4.3 Prohibition of Synthetic Substitution

Under **zero circumstances** may the dispatcher or calling procedure:
1. Fabricate a candidate hash or compute a hash on an unverified temporary file.
2. Substitute `$ExpectedTriggerHash` (the hash of the broken live configuration).
3. Substitute `$ExpectedBaselineHash` (the hash of the golden backup).
4. Substitute an empty string, `$null`, or a placeholder such as `"UNKNOWN"`.

**Architectural Law:** If candidate provenance cannot be established (e.g., pre-flight was bypassed or `$H_cand_pre` was lost), the deployment is **untrusted and unrecoverable by automation**. It must fail closed immediately.

---

## 5. Finding AC-3 — Outcome 4 Control Flow: Rollback Success vs. Deployment Abort

### 5.1 The Separation of the Three Outcome Concepts

To ensure unambiguous control flow across automation and CI/CD pipelines, three concepts that were previously conflated under "Outcome 4" are decoupled:

```
[Concept A: Rollback Evidence Verification]
  - Physical live configuration restored to baseline.
  - Live hash verified: H_live == ExpectedBaselineHash.
  - Discard quarantine captured and verified: H_discard == ExpectedTriggerHash.
  - Status: VERIFIED CLEAN (Live database cluster remains healthy on original baseline).
         │
         ▼
[Concept B: Recovery-Handler Execution]
  - Forensic diagnostic logging via Enter-ManualRecoveryBoundaryV14.
  - Executed ONLY when rollback fails or evidence is compromised (States 5A-5F).
  - Status: NOT EXECUTED IN OUTCOME 4 (Automated rollback succeeded).
         │
         ▼
[Concept C: Deployment Continuation]
  - Execution of subsequent pipeline steps (e.g., database migrations, service restarts).
  - Status: STRICTLY PROHIBITED AND ABORTED FAIL-CLOSED.
  - Enforced by: Mandatory terminating throw in Stage 3.
```

### 5.2 The Terminal Throw Invariant

In Stage 3 of `Dispatch-RollbackResultV29`, the terminal statement:

```powershell
throw "FAIL-CLOSED ABORT [OUTCOME 4]: $ContextName failed ($($TriggerError.Message)), but rollback successfully restored original configuration. Deployment pipeline terminated. Live service safe."
```

guarantees that:
1. **Calling Scripts Halt:** PowerShell terminates the current execution context immediately, preventing any following lines in the deployment script from running.
2. **CI/CD Pipelines Catch Failure:** Non-zero exit code ($1$) is reported to orchestration runners (GitHub Actions, GitLab CI, Azure Pipelines, Jenkins).
3. **Database Migrations Are Prevented:** Post-deployment database migrations that depend on the new configuration settings are never executed against the rolled-back baseline cluster.

---

## 6. Authoritative PowerShell Implementation: `Dispatch-RollbackResultV29`

```powershell
function Dispatch-RollbackResultV29 {
    <#
    .SYNOPSIS
        Evaluates the outcome of a controlled configuration rollback operation with
        exhaustive evidence validation, formal parameter provenance, precise .NET
        exception inheritance handling, and fail-closed terminal execution boundaries.
    .DESCRIPTION
        Step 2D-2A-AO-AC remediation:
        1. Formally distinguishes pre-body parameter binding exceptions (Phase 1) from
           in-function Stage 0 validation failures (Phase 2).
        2. Enforces unbroken candidate cryptographic provenance: requires verified
           pre-flight candidate digest ($H_cand_pre); rejects synthetic substitution.
        3. Decouples rollback verification success from deployment continuation:
           guarantees that Outcome 4 halts the deployment pipeline fail-closed.
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
    # Executed ONLY when Phase 1 Parameter Binding succeeds.
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

        # 3F. Discard Non-Zero Length Assertion via BCL FileInfo (Corrected Catch Order)
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

The 35-class Discard Outcome Architecture is preserved intact:

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

### 8.1 Reconciled Outer-Dispatch Test Specifications (DSP-128 through DSP-135)

To clearly separate pre-body engine parameter binding errors from in-function Stage 0 validation errors, and to test candidate provenance and Outcome 4 control flow, the Outer-Dispatch test suite is expanded from 127 to **135 specifications**:

| Test ID | Input Scenario / Failure Injection | Expected Result Flag | Dispatch Path / Trigger | Target State | Mapped Diagnostic State | Expected Control Flow | Physical Disk State Guarantee |
|---|---|---|---|---|---|---|---|
| **DSP-128**| Mandatory parameter omitted at call site | `$true` | Pre-body parameter binder throws `ParameterBindingException` | **N/A** | Pre-Body Engine Error | Halts at Call Site | Function body NOT entered; recovery boundary NOT run. Pre-body engine halt. |
| **DSP-129**| Explicit `$null` or whitespace passed to `-CandidateHash` | `$true` | Parameter binding succeeds; Stage 0 `IsNullOrWhiteSpace` traps | **State 5D** | 5D | Local Throw | Function body entered; recovery boundary runs; local throw executes. State 5D recorded. |
| **DSP-130**| Malformed candidate hash string (non-hex / 63 chars) | `$true` | Parameter binding succeeds; Stage 0 regex check traps | **State 5D** | 5D | Local Throw | Function body entered; recovery boundary runs; local throw executes. State 5D recorded. |
| **DSP-131**| Ambient dynamic scope leakage prevention | `$true` | Caller environment defines `$CandidateHash`, but argument omitted | **N/A** | Pre-Body Engine Error | Halts at Call Site | Binder throws `ParameterBindingException`. Dynamic inheritance strictly blocked. |
| **DSP-132**| Valid candidate hash binding & transmission | `$true` | Valid 64-hex passed to `-CandidateHash` | **State 5D/Downstream**| 5D/Downstream | Local Throw | Valid candidate hash bound cleanly; forwarded to recovery boundary on downstream fault. |
| **DSP-133**| Outcome 4 Terminal Fail-Closed Abort Invariant | `$true` | All Stage 3 evidence checks pass | **State 4** | 4 | Terminal Throw | Baseline verified live. Script strictly throws `FAIL-CLOSED ABORT [OUTCOME 4]`. Pipeline halts. |
| **DSP-134**| Outcome 4 vs. Deployment Success Non-Conflation | `$true` | Orchestration runner intercepts Outcome 4 terminal throw | **State 4** | 4 | Pipeline Abort | Deployment runner marks job as FAILED / ABORTED; prevents subsequent schema migrations. |
| **DSP-135**| Candidate Provenance Chain Assertion | `$true` | Pre-flight candidate measurement `$H_cand_pre` verified pre-swap | **State 4/5D** | 4/5D | Verified Transmission | Candidate digest originates from verified measurement; synthetic substitution blocked. |

### 8.2 Complete 4-Dimensional Engineering Accounting Model

#### Dimension 1: Syntactic AST Decision Points
- Pre-Flight Replacement Engine (PF-0 through PF-4B): **41 decision points**
- Replacement Swap & Post-Swap Live Inspection (Stages 2–3): **17 decision points**
- Recovery Boundary Non-Mutating Diagnostics: **7 decision points**
- Dispatcher V29 Decision Points: **55 decision points**
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
- Outer-Dispatch Integrity Suite: DSP-01 through DSP-135 (**135 specifications**, expanded from 127)
- Recovery Diagnostic Suite: REC-01 through REC-07 (**7 specifications**)
- **Total Test Specifications Defined:** $34 + 135 + 7 = \mathbf{176 \text{ test specifications}}$.

#### Dimension 4: Executed Operational Tests
- **Executed Operational Tests:** **ZERO (0).**  
  All 176 test specifications are strictly marked **[NOT EXECUTED — UNTESTED]**.

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
  Real-time antivirus filters frequently lock newly created `.discard` and `.golden` files during quarantine scanning. While `Dispatch-RollbackResultV29` safely handles sharing violations and undetermined I/O faults, whether corporate EDR drivers consistently preserve standard Win32 HResult codes remains unverified at runtime.

---

## 10. Explicit Execution-Status & Safety Confirmation

### 10.1 Precise Execution-Status Accounting

To maintain absolute transparency and compliance:

- **Operational Procedures & Scripts:** **ZERO (0) EXECUTED.**  
  `Dispatch-RollbackResultV29`, `Invoke-SafeConfigReplacementV17`, `Invoke-ControlledRollbackV15`, `Enter-ManualRecoveryBoundaryV14`, and all 176 test specifications are strictly **[NOT EXECUTED — UNTESTED]**.
- **Read-Only Diagnostic Commands:** **ZERO (0)** operational commands executed.  
- **Host & Database Alterations:** **ZERO (0).** No configuration files (`postgresql.conf`, `pg_hba.conf`), Windows Firewall rules, Windows services, application code, or `.env` files were modified. No databases, schemas, tables, roles, or records were created, altered, or dropped.
- **Cloud Connections:** **ZERO (0).** No connections made to Neon, AWS, Supabase, Render, or any remote infrastructure.
- **Budget Preservation:** Strict ₹0/month budget preserved.
- **Preserved Application Databases:** Catalogs `hisecure_erp`, `hitech_platform`, and `zentra_test` remain completely untouched.

---

```
STOP — STEP 2D-2A-AO-AC COMPLETE — WAITING FOR HUMAN REVIEW
```
