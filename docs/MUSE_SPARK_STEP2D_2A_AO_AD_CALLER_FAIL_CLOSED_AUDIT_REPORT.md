# MUSE SPARK — ZENTRA STEP 2D-2A-AO-AD
## CALLER-LEVEL FAIL-CLOSED, HASH MEASUREMENT & TEST EXPECTATION AUDIT REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Target Repository:** `D:\Zentra`  
**Input Reference:** [`docs/MUSE_SPARK_STEP2D_2A_AO_AC_CANDIDATE_HASH_BINDING_AUDIT_REPORT.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_AO_AC_CANDIDATE_HASH_BINDING_AUDIT_REPORT.md)  
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

A comprehensive caller-level control-flow, hash-measurement, and test-expectation audit of Step 2D-2A-AO-AC (`Dispatch-RollbackResultV29` and companion caller procedures) identified **four critical architectural defects**:

1. **Caller-Level Interception of Engine Parameter Binding Failures (Finding AD-1):**  
   While Step AO-AC correctly distinguished pre-body engine parameter binding exceptions from in-function Stage 0 validation, it evaluated the function in isolation. When calling `Dispatch-RollbackResultV29` from an outer orchestrator (such as `Invoke-SafeConfigReplacement` or an automated CI/CD deployment script), any failure in mandatory parameter binding throws `System.Management.Automation.ParameterBindingException` (`MissingMandatoryParameter`).  
   **The Critical Defect:** If the calling procedure wraps the dispatch call in a generic `try/catch` or if an upstream wrapper traps and suppresses exceptions without rethrowing, execution would continue past the recovery boundary. Furthermore, because parameter binding fails before function body entry, `Enter-ManualRecoveryBoundaryV14` **never executes**.  
   **Remediation:** The caller/orchestrator contract is formally hardened: callers must explicitly trap binding exceptions, capture an emergency forensic incident record, assign a terminating non-zero exit code, and strictly prohibit deployment continuation.
2. **Outcome 4 Exception Suppression and Continuation Risks (Finding AD-2):**  
   In Outcome 4, rollback verification succeeds (the live PostgreSQL file matches the golden baseline and the discard artifact is quarantined and verified), but **the configuration deployment has failed**. `Dispatch-RollbackResultV29` enforces a terminal throw (`throw "FAIL-CLOSED ABORT [OUTCOME 4]: ..."`).  
   **The Critical Defect:** If an automated deployment runner, pipeline wrapper, or retry harness catches this exception, logs "Rollback Succeeded", and does not terminate the pipeline, downstream deployment tasks (e.g., executing database schema migrations or toggling application features dependent on the new configuration) would run against an obsolete baseline configuration.  
   **Remediation:** Complete caller decoupling is enforced: "Rollback Verification Success" is strictly separated from "Deployment Success". Callers are mathematically forbidden from retrying, swallowing the throw, or proceeding downstream.
3. **Hardened Candidate Hash Measurement Validation (Finding AD-3):**  
   In Step AO-AC Section 4.2, the pre-flight measurement assigned `$H_cand_pre = $candPreInfo.Hash` after only checking `$candPreInfo.Status -eq "HASH_VERIFIED"`.  
   **The Critical Defect:** A buggy or compromised hash helper could return `Status = "HASH_VERIFIED"` while leaving the `Hash` property `$null`, whitespace, or truncated (as audited in `DISC-33` and `DISC-34`). Furthermore, the immediate pre-swap check (PF-4A) compared `$candImmediate.Hash` to `$H_cand_pre` without asserting that `$candImmediate.Status` was `HASH_VERIFIED` or validating its 64-hex string format.  
   **Remediation:** `Invoke-SafeConfigReplacementV18` enforces a strict 4-step assertion protocol for candidate measurement at both pre-flight (PF-1B) and pre-swap (PF-4A): non-null result object, `Status -eq "HASH_VERIFIED"`, non-null/non-whitespace `.Hash`, and strict 64-hex regex format validation before any assignment or comparison. Silent substitution of baseline or trigger hashes remains strictly prohibited.
4. **Deterministic Test Expectations & Arithmetic Reconciliation (Finding AD-4):**  
   Audit of test specifications `DSP-132` and `DSP-135` in Step AO-AC revealed ambiguous, multi-valued target states (`State 5D/Downstream` and `State 4/5D`).  
   **Remediation:** Ambiguous test specifications are split into single-target deterministic specifications (`DSP-132` / `DSP-136` and `DSP-135` / `DSP-137`), and seven new required test scenarios are added (`DSP-138` through `DSP-144`) covering caller exception suppression, Outcome 4 non-zero exit code propagation, downstream continuation blocking, pre-flight candidate helper faults, malformed candidate metadata, pre-swap helper status failure, and pre-swap candidate mutation.  
   The Outer-Dispatch suite expands from 135 to **144 specifications (`DSP-01` through `DSP-144`)**, bringing total defined specifications across all suites to **185 specifications**, all strictly marked **`[NOT EXECUTED — UNTESTED]`**.

---

## 2. Summary of Identified Audit Findings

| Finding ID | Source Report Location | Description | Impact | Remediation in Step AO-AD |
|---|---|---|---|---|
| **FIND-AD1** | Step AO-AC<br/>Section 3 & DSP-128 | **Uncontained Caller-Level Parameter Binding Exception:** Caller wrappers could trap and swallow pre-body `ParameterBindingException`, or fail to record forensic context when Stage 0 never runs. | Deployment pipeline could silently proceed without configuration replacement and without running manual recovery diagnostics. | Formally specify the caller fail-closed contract: callers must intercept binding errors, record an emergency forensic snapshot, and terminate with non-zero exit code. |
| **FIND-AD2** | Step AO-AC<br/>Section 5 & DSP-134 | **Ambiguity in Outer Caller Chain After Outcome 4:** Conflation of "Rollback Success" with "Deployment Success" in outer pipeline runners, risking exception suppression and unauthorized continuation. | Automated CI/CD pipelines might catch the Outcome 4 throw, report "Success", and execute schema migrations against the old baseline cluster. | Mandate strict orchestration decoupling: Outcome 4 guarantees baseline safety but MUST abort the deployment pipeline fail-closed. |
| **FIND-AD3** | Step AO-AC<br/>Section 4.2 & PF-1B/4A | **Missing Defensive Format Validation on Candidate Helper Outputs:** `$H_cand_pre` assigned without checking for null/whitespace or regex format on `$candPreInfo.Hash`; PF-4A compared digests without validating helper status. | Helper metadata defects (`DISC-33`/`DISC-34`) during candidate measurement could propagate null or malformed hashes into downstream barriers and dispatchers. | Implement 4-step defensive validation protocol in `Invoke-SafeConfigReplacementV18` for both PF-1B (pre-flight) and PF-4A (pre-swap). |
| **FIND-AD4** | Step AO-AC<br/>Table 8.1 (DSP-132 & 135) | **Ambiguous / Combined Test Target States:** `DSP-132` specified `Target State: State 5D/Downstream`; `DSP-135` specified `Target State: State 4/5D`. Missing caller-chain test specifications. | Test assertions are non-deterministic, masking distinct failure modes and leaving caller suppression unverified. | Split ambiguous tests into deterministic singles; add `DSP-138` through `DSP-144` (7 new scenarios); expand Outer-Dispatch suite to **144 tests** (185 total). |

---

## 3. Finding AD-1 — Caller-Level Parameter Binding Failure & Engine Interception

### 3.1 PowerShell ParameterBinder vs. Runtime In-Function Execution

In PowerShell, when a function declares `[CmdletBinding()]` and parameters with `[Parameter(Mandatory = $true)]`, argument binding is executed by the internal CLR class `System.Management.Automation.ParameterBinderBase` before the first line of the function's `begin`, `process`, or `end` block (or general body) is reached:

```
[Calling Context: Invoke-SafeConfigReplacement or CI/CD Wrapper]
  │
  ├─► Invoke: Dispatch-RollbackResultV30 (without mandatory -CandidateHash)
  │     │
  │     ▼
  │   [PowerShell Engine: Parameter Binder Phase] (PRE-BODY)
  │     ├── Binder detects missing mandatory parameter 'CandidateHash'
  │     ├── Binder throws System.Management.Automation.ParameterBindingException
  │     └── EXECUTION HALTS BEFORE DISPATCHER BODY IS REACHED
  │           │
  │           ├─► Dispatch-RollbackResultV30 Stage 0 DOES NOT RUN
  │           └─► Enter-ManualRecoveryBoundaryV14 DOES NOT RUN
  │
  ▼
[Exception Bubbles Back to Caller Catch Block]
```

### 3.2 The Caller Trap Vulnerability

When `Dispatch-RollbackResultV29` was designed, it assumed that all invalid parameters would trigger its internal `Stage 0` validation:
```powershell
# STAGE 0 IN DISPATCHER:
if ([string]::IsNullOrWhiteSpace($CandidateHash) -or ($CandidateHash -notmatch $sha256Regex)) {
    Enter-ManualRecoveryBoundaryV14 ...
    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: CandidateHash is invalid.")
}
```

However, if an upstream caller invokes the dispatcher with an **omitted parameter**:
1. `Dispatch-RollbackResult` is never entered.
2. `Enter-ManualRecoveryBoundaryV14` is never invoked.
3. No forensic snapshot is recorded by the dispatcher.
4. If the caller has an exception handler:
   ```powershell
   # VULNERABLE CALLER IMPLEMENTATION:
   try {
       Dispatch-RollbackResultV29 -RollbackResult $res -LiveConfigPath $live ... # OMITTED -CandidateHash
   }
   catch {
       Write-Warning "Rollback dispatch encountered an error: $_"
       # FLAW: Exception swallowed! Function exits normally!
   }
   # FLAW: Caller continues to next deployment phase!
   ```

### 3.3 Fail-Closed Caller Protocol for Parameter Binding Failures

To ensure absolute containment, the calling architecture must adhere to the **Four Caller Binding Laws**:

1. **Law of Non-Suppression:**  
   Under no circumstances may a calling script, function, or runner suppress or convert a `ParameterBindingException` into a warning or non-terminating error.
2. **Law of Emergency Forensic Capture:**  
   Because the dispatcher's Stage 0 did not run, the caller is directly responsible for logging an **Emergency Parameter Binding Failure Record** containing:
   - Name of the failed cmdlet/function.
   - Exact missing or invalid parameter name.
   - Raw `$RollbackResult` object (if present).
   - Paths to the live file, golden backup, and candidate file.
   - Full stack trace of the calling context.
3. **Law of Caller-Side Recovery Invocation:**  
   If a parameter binding exception occurs during a rollback dispatch sequence, the caller must directly invoke `Enter-ManualRecoveryBoundaryV14` with context `CALLER_PARAMETER_BINDING_FAILURE` before terminating.
4. **Law of Terminal Non-Zero Exit:**  
   The calling process must terminate immediately with an exit code $\neq 0$ (Exit Code 1 or dedicated error code 105).

---

## 4. Finding AD-2 — Outcome 4 Exception Propagation & Orchestration Decoupling

### 4.1 Rollback Verification Success vs. Deployment Pipeline Success

A fundamental architectural distinction governs Outcome 4:

$$\mathbf{Outcome\ 4} \equiv \mathbf{Live\ Cluster\ Safe\ on\ Baseline} \land \mathbf{Deployment\ Operation\ FAILED}$$

| Attribute | Rollback Verification Status | Deployment Pipeline Status |
|---|---|---|
| **Physical Cluster State** | Restored to Golden Baseline ($H_{\text{live}} = H_{\text{baseline}}$) | Candidate configuration **NOT** active ($H_{\text{live}} \neq H_{\text{cand}}$) |
| **Quarantine State** | Discard file verified ($H_{\text{discard}} = H_{\text{trigger}}$) | Candidate discarded to `.discard.<timestamp>` |
| **Production Risk** | Minimal (Cluster remains operational on tested baseline) | Critical if automated deployment pipeline proceeds |
| **Action Permitted** | Keep live service running | **HALT IMMEDIATELY**. Zero downstream tasks permitted. |
| **Exit Code Requirement** | N/A (Internal recovery status) | **Strictly Non-Zero** ($ExitCode \neq 0$) |

### 4.2 Analysis of Caller Failure Modes

```
                                  [Dispatch-RollbackResultV30]
                                               │
                                 Stage 3 Multi-Factor Pass
                                               │
                                               ▼
                     ┌──────────────────────────────────────────────────┐
                     │ throw "FAIL-CLOSED ABORT [OUTCOME 4]: ..."      │
                     └──────────────────────────────────────────────────┘
                                               │
                                               ▼
                              [Invoke-SafeConfigReplacementV18]
                                               │
                                      (Uncaught or Rethrown)
                                               │
                                               ▼
                              [Deployment Orchestrator / CI/CD]
                                               │
               ┌───────────────────────────────┴───────────────────────────────┐
               ▼                                                               ▼
   [VULNERABLE PATH: SWALLOW]                                      [SECURE PATH: HARDENED]
   try { Invoke-SafeConfigReplacement }                            try { Invoke-SafeConfigReplacement }
   catch { Write-Host "Rollback safe!" }                           catch [System.Exception] {
   # Continues to schema migrations!                                   Log-RollbackForensicEvidence $_
   # Runs: pg_upgrade / flyway / alembic                               Set-DeploymentFailed -ExitCode 104
   # FATAL INCONSISTENCY ON BASELINE CLUSTER                           throw $_  # HALTS PIPELINE
                                                                   }
```

### 4.3 Risks in Automated Runners

1. **The "Green Pipeline" False Positive:**  
   A CI/CD runner (GitHub Actions, GitLab CI, Azure Pipelines) that catches the exception and exits with `0` because "the rollback prevented downtime" will mark the pipeline build as **Passed**. Subsequent automated jobs (e.g., canary traffic shifts, smoke tests) will execute, expecting new database settings, leading to runtime application faults.
2. **The "Automated Retry Loop" Catastrophe:**  
   If an orchestrator has a retry policy (`retry: 3`), catching Outcome 4 and immediately re-triggering `Invoke-SafeConfigReplacement` will:
   - Read the candidate file again.
   - Attempt another swap.
   - Encounter the same underlying configuration error.
   - Trigger a second rollback.
   - Generate redundant `.discard` files and potentially flap PostgreSQL process availability.
3. **The Terminal Throw Contract:**  
   `Dispatch-RollbackResultV30` guarantees that Outcome 4 **never returns a value**. It exclusively terminates via `throw`. Callers must preserve this terminating behavior.

---

## 5. Finding AD-3 — Candidate Hash Measurement Validation & Provenance Hardening

### 5.1 Hardened Pre-Flight Candidate Hash Measurement (PF-1B)

In Step AO-AC Section 4.2, the pre-flight check on the candidate configuration was specified as:
```powershell
$candPreInfo = Get-SafeFileHashV4 -FilePath $CandidatePath
if ($candPreInfo.Status -ne "HASH_VERIFIED") { throw "Candidate pre-flight hash failed" }
$H_cand_pre = $candPreInfo.Hash
```

**The Vulnerability:**  
If `Get-SafeFileHashV4` returns `$candPreInfo` with `Status = "HASH_VERIFIED"`, but due to an internal defect `Hash` is `$null`, an empty string `""`, or a truncated hash string (e.g., 63 characters), `$H_cand_pre` becomes invalid. The replacement engine would proceed to create a golden backup, swap the file, and only fail much later during post-swap validation or dispatch Stage 0.

**Hardened Specification in `Invoke-SafeConfigReplacementV18` (PF-1B):**
```powershell
# PF-1B: Hardened Candidate Pre-Flight Hash Inspection
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
        # DEFENSIVE ASSERTION 1: Non-null and non-whitespace check
        if ([string]::IsNullOrWhiteSpace($candPreInfo.Hash)) {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_CAND_HASH_METADATA_MISSING]: Candidate status is HASH_VERIFIED but Hash property is null or empty."
        }
        # DEFENSIVE ASSERTION 2: Strict 64-character hexadecimal SHA-256 regex validation
        if ($candPreInfo.Hash -notmatch '^[A-Fa-f0-9]{64}$') {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_CAND_HASH_METADATA_MALFORMED]: Candidate status is HASH_VERIFIED but Hash [$($candPreInfo.Hash)] is not a valid 64-char SHA-256 hex string."
        }
        # TRUST ROOT ESTABLISHED
        $H_cand_pre = $candPreInfo.Hash
    }
    default {
        throw "FAIL-CLOSED ABORT [PREFLIGHT_CAND_UNKNOWN_STATUS]: Candidate pre-hash check returned unknown status [$($candPreInfo.Status)]."
    }
}
```

### 5.2 Strict Pre-Swap Candidate Barrier Assertion (PF-4A)

Immediately before invoking `[System.IO.File]::Replace()`, the engine must verify that the candidate file has not been mutated, truncated, or locked by an external process during the golden backup creation window.

**Hardened Specification in `Invoke-SafeConfigReplacementV18` (PF-4A):**
```powershell
# PF-4A: Immediate Pre-Swap Candidate Verification Barrier
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
        # DEFENSIVE ASSERTION 1: Non-null metadata check
        if ([string]::IsNullOrWhiteSpace($candImmediate.Hash)) {
            throw "FAIL-CLOSED ABORT [PRE_SWAP_CAND_HASH_MISSING]: Pre-swap candidate Hash property is null or empty."
        }
        # DEFENSIVE ASSERTION 2: 64-hex format check
        if ($candImmediate.Hash -notmatch '^[A-Fa-f0-9]{64}$') {
            throw "FAIL-CLOSED ABORT [PRE_SWAP_CAND_HASH_MALFORMED]: Pre-swap candidate Hash [$($candImmediate.Hash)] is not a valid 64-char hex string."
        }
        # DEFENSIVE ASSERTION 3: Cryptographic equality against pre-flight trust root
        if ($candImmediate.Hash -ine $H_cand_pre) {
            throw "FAIL-CLOSED ABORT [PRE_SWAP_CANDIDATE_MUTATED]: Candidate modified after pre-flight verification (Pre: $H_cand_pre, Now: $($candImmediate.Hash)). Promotion aborted."
        }
    }
    default {
        throw "FAIL-CLOSED ABORT [PRE_SWAP_CAND_UNKNOWN_STATUS]: Pre-swap candidate check returned unknown status [$($candImmediate.Status)]."
    }
}
```

### 5.3 Complete Cryptographic Provenance Ledger

The candidate configuration hash passes through a strictly verified lifecycle:

```
[Candidate Source File: D:\Zentra\...\candidate.conf]
  │
  ├─► Stage 1 (PF-0): Byte & Encoding Validation -> Verified UTF-8, no binary nulls
  │
  ├─► Stage 1 (PF-1B): Pre-Flight Measurement -> Status: HASH_VERIFIED
  │                                           -> Hash: non-null, valid 64-hex regex
  │                                           -> Assigned to: $H_cand_pre (TRUST ROOT)
  │
  ├─► Stage 2 (PF-4A): Pre-Swap Barrier       -> Status: HASH_VERIFIED
  │                                           -> Hash: matches $H_cand_pre exactly
  │
  ├─► Swap Operation: [File]::Replace()       -> Atomic Win32 filesystem swap
  │
  └─► If Swap Fails -> Rollback Triggered     -> Invoke-ControlledRollbackV15
        │
        └─► Rollback Dispatched               -> Dispatch-RollbackResultV30
              │                                  -CandidateHash $H_cand_pre
              │                                  (Transmitted explicitly; NO substitution)
              ▼
        [Stage 0 Caller Validation in Dispatcher]
          - Verifies -not [string]::IsNullOrWhiteSpace($CandidateHash)
          - Verifies $CandidateHash -match '^[A-Fa-f0-9]{64}$'
          - Passes forward to Stage 3 or Enter-ManualRecoveryBoundaryV14
```

---

## 6. Finding AD-4 — Deterministic Test Expectations & Reconciled Arithmetic

### 6.1 Disambiguation of `DSP-132` and `DSP-135`

In Step AO-AC Table 8.1, two test specifications contained ambiguous target states:
1. `DSP-132`: Target state was written as `State 5D/Downstream`.  
   **Ambiguity:** "Downstream" is not an enumerated recovery state. It failed to specify whether the test verified Stage 0 passing or the downstream delivery of the hash.
2. `DSP-135`: Target state was written as `State 4/5D`.  
   **Ambiguity:** Grouped both successful provenance verification (Outcome 4) and candidate mutation detection (State 5D) under a single test identifier.

**Resolution:**
- `DSP-132` is refined to strictly test **Stage 0 Parameter Binding & Format Acceptance** (Target State: In-Function Stage 0 Pass / Progress to Stage 1).
- `DSP-136` is created to strictly test **Candidate Hash Downstream Transmission to Recovery Boundary on Fault** (Target State: State 5C with verified candidate hash in diagnostic bundle).
- `DSP-135` is refined to strictly test **End-to-End Candidate Provenance Verification on Rollback Success** (Target State: State 4 / Outcome 4 Terminal Throw).
- `DSP-137` is created to strictly test **Pre-Flight Candidate Hash Measurement Failure Halts Fail-Closed** (Target State: Pre-Flight Abort before golden backup creation).

### 6.2 New Test Scenarios (`DSP-138` through `DSP-144`)

To address all caller-level fail-closed requirements, seven new test specifications are defined:

1. **`DSP-138` (Caller Exception Suppression Interception Barrier):**  
   Verifies that if an outer wrapper attempts to wrap `Dispatch-RollbackResultV30` in a `try/catch` and swallow `ParameterBindingException`, the orchestration test harness asserts that a terminating failure is raised and the pipeline is marked failed.
2. **`DSP-139` (Caller Catches Outcome 4 for Logging & Propagates Non-Zero Exit Code):**  
   Verifies that when a compliant caller catches the terminal `FAIL-CLOSED ABORT [OUTCOME 4]` exception, it logs forensic evidence, does not retry, sets `$LASTEXITCODE = 104`, and exits the process with a non-zero code.
3. **`DSP-140` (Downstream Continuation Attempt Blocked After Outcome 4):**  
   Verifies that tasks scheduled sequentially after configuration replacement (such as database migrations or application pool start) are unreachable and never executed when Outcome 4 occurs.
4. **`DSP-141` (Pre-Flight Candidate Helper Returns HELPER_EXCEPTION):**  
   Verifies that if `Get-SafeFileHashV4` on the candidate file returns `Status = "HELPER_EXCEPTION"`, `Invoke-SafeConfigReplacementV18` aborts immediately at PF-1B without modifying disk or creating a backup.
5. **`DSP-142` (Pre-Flight Candidate Hash Metadata Missing/Malformed on HASH_VERIFIED):**  
   Verifies that if `Get-SafeFileHashV4` on the candidate returns `Status = "HASH_VERIFIED"` but `.Hash` is null, whitespace, or non-hex, `Invoke-SafeConfigReplacementV18` aborts immediately at PF-1B with `PREFLIGHT_CAND_HASH_METADATA_MALFORMED`.
6. **`DSP-143` (Pre-Swap Candidate Helper Returns Failure Status at PF-4A):**  
   Verifies that if the candidate file becomes unreadable or missing immediately before swap, PF-4A traps the error, aborts fail-closed, and leaves the live file untouched.
7. **`DSP-144` (Pre-Swap Candidate Hash Mutation Trapped at PF-4A):**  
   Verifies that if candidate file bytes are altered between PF-1B and PF-4A, PF-4A detects `$candImmediate.Hash -ne $H_cand_pre`, throws `PRE_SWAP_CANDIDATE_MUTATED`, and halts without executing `[File]::Replace()`.

### 6.3 Reconciled Outer-Dispatch Test Matrix (`DSP-128` through `DSP-144`)

| Test ID | Input Scenario / Failure Injection | Expected Result Flag | Dispatch Path / Trigger | Target State | Mapped Diagnostic State | Expected Control Flow | Physical Disk State Guarantee |
|---|---|---|---|---|---|---|---|
| **DSP-128**| Mandatory parameter omitted at call site | `$true` | Pre-body parameter binder throws `ParameterBindingException` | **N/A** | Pre-Body Engine Error | Halts at Call Site | Function body NOT entered; recovery boundary NOT run. Pre-body engine halt. |
| **DSP-129**| Explicit `$null` or whitespace passed to `-CandidateHash` | `$true` | Parameter binding succeeds; Stage 0 `IsNullOrWhiteSpace` traps | **State 5D** | 5D | Local Throw | Function body entered; recovery boundary runs; local throw executes. State 5D recorded. |
| **DSP-130**| Malformed candidate hash string (non-hex / 63 chars) | `$true` | Parameter binding succeeds; Stage 0 regex check traps | **State 5D** | 5D | Local Throw | Function body entered; recovery boundary runs; local throw executes. State 5D recorded. |
| **DSP-131**| Ambient dynamic scope leakage prevention | `$true` | Caller environment defines `$CandidateHash`, but argument omitted | **N/A** | Pre-Body Engine Error | Halts at Call Site | Binder throws `ParameterBindingException`. Dynamic inheritance strictly blocked. |
| **DSP-132**| Valid candidate hash binding & Stage 0 pass | `$true` | Valid 64-hex passed to `-CandidateHash` | **Stage 0 Pass**| Stage 0 Pass | Progress to Stage 1 | Stage 0 assertions pass cleanly; `$CandidateHash` bound and forwarded to Stage 1. |
| **DSP-133**| Outcome 4 Terminal Fail-Closed Abort Invariant | `$true` | All Stage 3 evidence checks pass | **State 4** | 4 | Terminal Throw | Baseline verified live. Script strictly throws `FAIL-CLOSED ABORT [OUTCOME 4]`. Pipeline halts. |
| **DSP-134**| Outcome 4 vs. Deployment Success Non-Conflation | `$true` | Orchestration runner intercepts Outcome 4 terminal throw | **State 4** | 4 | Pipeline Abort | Deployment runner marks job as FAILED / ABORTED; prevents subsequent schema migrations. |
| **DSP-135**| Candidate Provenance Chain End-to-End Verification | `$true` | Pre-flight candidate measurement `$H_cand_pre` verified pre-swap and post-rollback | **State 4** | 4 | Terminal Throw | Candidate digest originates from verified measurement; clean rollback authorizes Outcome 4 throw. |
| **DSP-136**| Candidate Hash Forwarded to Recovery Diagnostic Boundary | `$false` | Injected Stage 3 failure (e.g. discard missing) after valid candidate binding | **State 5C** | 5C | Local Throw | Recovery boundary captures verified candidate hash in diagnostic bundle for forensic analysis. |
| **DSP-137**| Pre-Flight Candidate Hash Measurement Failure Halts Early | N/A | Pre-flight helper returns `FILE_MISSING` or `HASH_READ_FAILED` | **Pre-Flight Abort** | Pre-Flight Abort | Pre-Flight Throw | Deployment halts before golden backup creation. Live configuration untouched. |
| **DSP-138**| Caller Exception Suppression Interception Barrier | `$true` | Caller wraps dispatch in try/catch; engine raises `ParameterBindingException` | **Caller Fatal** | Engine Binding Error | Non-Zero Exit Code | Caller test harness traps suppression; forces non-zero exit code and fails pipeline. |
| **DSP-139**| Caller Catches Outcome 4 for Logging & Propagates Exit Code | `$true` | Caller catches Outcome 4 throw; logs forensic bundle; sets exit code 104 | **State 4** | 4 | Exit Code 104 | Baseline safe; pipeline runner reports non-zero failure code; automated retries blocked. |
| **DSP-140**| Downstream Continuation Attempt Blocked After Outcome 4 | `$true` | Sequential script schedules migration step after config replacement | **State 4** | 4 | Pipeline Halted | Outcome 4 terminal throw prevents execution of migration step. Baseline database untouched. |
| **DSP-141**| Pre-Flight Candidate Helper Returns HELPER_EXCEPTION | N/A | `Get-SafeFileHashV4` on candidate throws or returns `HELPER_EXCEPTION` | **Pre-Flight Abort** | Pre-Flight Abort | Pre-Flight Throw | Halts at PF-1B. Golden backup NOT created. Target file completely untouched. |
| **DSP-142**| Pre-Flight Candidate Hash Metadata Missing/Malformed | N/A | Helper returns `HASH_VERIFIED` with empty or non-64-hex `.Hash` | **Pre-Flight Abort** | Pre-Flight Abort | Pre-Flight Throw | Halts at PF-1B with `PREFLIGHT_CAND_HASH_METADATA_MALFORMED`. Golden backup NOT created. |
| **DSP-143**| Pre-Swap Candidate Helper Status Failure at PF-4A | N/A | Pre-swap candidate helper returns `HASH_READ_FAILED` or throws | **Pre-Swap Abort** | Pre-Swap Abort | Pre-Swap Throw | Halts at PF-4A. Win32 `[File]::Replace()` NEVER executed. Live file untouched. |
| **DSP-144**| Pre-Swap Candidate Hash Mutation Trapped at PF-4A | N/A | Candidate file modified after PF-1B; digest differs from `$H_cand_pre` | **Pre-Swap Abort** | Pre-Swap Abort | Pre-Swap Throw | Halts at PF-4A with `PRE_SWAP_CANDIDATE_MUTATED`. Replacement aborted fail-closed. |

*Note: All 17 specifications above, and all preceding specifications in the suite (`DSP-01` through `DSP-127`), are strictly **[NOT EXECUTED — UNTESTED]**.*

---

## 7. Authoritative PowerShell Specifications

### 7.1 Hardened Caller Replacement Function: `Invoke-SafeConfigReplacementV18`

```powershell
# [NOT EXECUTED — UNTESTED OPERATIONAL PROCEDURE]

function Invoke-SafeConfigReplacementV18 {
    <#
    .SYNOPSIS
        Safely replaces a PostgreSQL configuration file using the Decoupled Backup Architecture,
        hardened candidate hash provenance validation, pre-swap barriers, and fail-closed dispatching.
    .DESCRIPTION
        Step 2D-2A-AO-AD remediation:
        1. Implements 4-step defensive validation on candidate hash measurement at PF-1B (pre-flight).
        2. Implements 4-step defensive validation on candidate hash re-measurement at PF-4A (pre-swap).
        3. Strictly prohibits synthetic substitution, fallbacks, or hash recycling.
        4. Transmits verified candidate digest $H_cand_pre explicitly to Dispatch-RollbackResultV30.
        5. Enforces fail-closed caller-level containment: never swallows binding or dispatch exceptions.
    #>
    param (
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$LiveConfigPath,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$CandidatePath,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$Description
    )

    Write-Host "=== INITIATING HARDENED CONFIGURATION REPLACEMENT V18: $Description ===" -ForegroundColor Cyan

    # -------------------------------------------------------------------------
    # STAGE 1: PRE-FLIGHT VALIDATION & DECOUPLED ATOMIC BACKUP
    # -------------------------------------------------------------------------
    
    # PF-0: Candidate Byte & Encoding Validation
    try {
        Test-CandidateByteAndEncodingIntegrity -FilePath $CandidatePath
    }
    catch {
        throw "FAIL-CLOSED ABORT [PREFLIGHT_CANDIDATE_INVALID]: Candidate integrity check failed: $($_.Exception.Message)"
    }

    # PF-1: Live Configuration Pre-Change Hash Inspection
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
            if ([string]::IsNullOrWhiteSpace($livePreInfo.Hash) -or ($livePreInfo.Hash -notmatch '^[A-Fa-f0-9]{64}$')) {
                throw "FAIL-CLOSED ABORT [PREFLIGHT_LIVE_HASH_MALFORMED]: Live configuration hash metadata is missing or invalid."
            }
            $H_live_pre = $livePreInfo.Hash
        }
        default {
            throw "FAIL-CLOSED ABORT [PREFLIGHT_LIVE_UNKNOWN_STATUS]: Live pre-hash check returned unknown status [$($livePreInfo.Status)]."
        }
    }

    # PF-1B: Hardened Candidate Pre-Flight Hash Inspection (Finding AD-3)
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
            # Defensive format assertion on candidate hash
            if ([string]::IsNullOrWhiteSpace($candPreInfo.Hash)) {
                throw "FAIL-CLOSED ABORT [PREFLIGHT_CAND_HASH_METADATA_MISSING]: Candidate status is HASH_VERIFIED but Hash property is null or empty."
            }
            if ($candPreInfo.Hash -notmatch '^[A-Fa-f0-9]{64}$') {
                throw "FAIL-CLOSED ABORT [PREFLIGHT_CAND_HASH_METADATA_MALFORMED]: Candidate status is HASH_VERIFIED but Hash [$($candPreInfo.Hash)] is not a valid 64-char SHA-256 hex string."
            }
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

    # PF-3: Golden Backup Hash Verification Barrier
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
            if ($gbInfo.Hash -ine $H_live_pre) {
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

    # -------------------------------------------------------------------------
    # STAGE 2: PRE-SWAP BARRIERS & WIN32 FILE REPLACEMENT
    # -------------------------------------------------------------------------
    
    # PF-4A: Immediate Pre-Swap Candidate Verification Barrier (Finding AD-3)
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
            if ([string]::IsNullOrWhiteSpace($candImmediate.Hash)) {
                throw "FAIL-CLOSED ABORT [PRE_SWAP_CAND_HASH_MISSING]: Pre-swap candidate Hash property is null or empty."
            }
            if ($candImmediate.Hash -notmatch '^[A-Fa-f0-9]{64}$') {
                throw "FAIL-CLOSED ABORT [PRE_SWAP_CAND_HASH_MALFORMED]: Pre-swap candidate Hash [$($candImmediate.Hash)] is not a valid 64-char hex string."
            }
            if ($candImmediate.Hash -ine $H_cand_pre) {
                throw "FAIL-CLOSED ABORT [PRE_SWAP_CANDIDATE_MUTATED]: Candidate modified after pre-flight hash verification. Promotion aborted."
            }
        }
        default {
            throw "FAIL-CLOSED ABORT [PRE_SWAP_CAND_UNKNOWN_STATUS]: Pre-swap candidate check returned unknown status [$($candImmediate.Status)]."
        }
    }

    # PF-4B: Immediate Pre-Swap Live Destination Verification Barrier
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
            if ($liveImmediate.Hash -ine $H_live_pre) {
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

        # Inspect live destination state safely
        $liveCurrInfo = $null
        $hashInspectionError = $null
        try {
            $liveCurrInfo = Get-SafeFileHashV4 -FilePath $LiveConfigPath
        }
        catch {
            $hashInspectionError = $_.Exception
        }

        if ($hashInspectionError -ne $null) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath `
                -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $replaceError `
                -HashInspectionError $hashInspectionError -RollbackResult $null `
                -Detail "Live inspection query threw an unhandled exception."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Live inspection query threw.")
        }

        if ($liveCurrInfo -eq $null -or $liveCurrInfo.Status -eq $null) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath `
                -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $replaceError `
                -HashInspectionError $null -RollbackResult $null `
                -Detail "Live inspection query returned null result object or null status."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Live inspection query returned null.")
        }

        switch ($liveCurrInfo.Status) {
            "HASH_VERIFIED" {
                if ($liveCurrInfo.Hash -ieq $H_live_pre) {
                    # STATE 2A / OUTCOME 1: TARGET UNTOUCHED
                    Write-Host "[OUTCOME 1: TARGET UNTOUCHED] Live file hash matches pre-change hash. Target was never modified." -ForegroundColor Yellow
                    Write-Host "[OUTCOME 1: ARTIFACT STATUS] Candidate file [$CandidatePath] and Golden Backup [$goldenBackupPath] retained on disk." -ForegroundColor Yellow
                    throw "FAIL-CLOSED ABORT [OUTCOME 1]: Replacement failed before touching target file ($($replaceError.Message)). Live file remains intact."
                }
                # Hash differs -> STATE 3: Target demonstrably altered -> Proceed to controlled rollback
            }
            "FILE_MISSING" {
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath `
                    -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $replaceError `
                    -HashInspectionError $null -RollbackResult $null `
                    -Detail "Live destination file is missing after failed replace operation."
                throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Live destination missing post-swap.")
            }
            "HASH_READ_FAILED" {
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath `
                    -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $replaceError `
                    -HashInspectionError $liveCurrInfo.Error -RollbackResult $null `
                    -Detail "Live destination file is locked or unreadable: $($liveCurrInfo.Message)"
                throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Live destination unreadable post-swap.")
            }
            "HELPER_EXCEPTION" {
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath `
                    -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $replaceError `
                    -HashInspectionError $liveCurrInfo.Error -RollbackResult $null `
                    -Detail "Hash helper failed on live destination: $($liveCurrInfo.Message)"
                throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Live destination helper exception post-swap.")
            }
            default {
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath `
                    -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $replaceError `
                    -HashInspectionError $liveCurrInfo.Error -RollbackResult $null `
                    -Detail "Live destination returned unknown state ($($liveCurrInfo.Status)): $($liveCurrInfo.Message)"
                throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Live destination unknown status post-swap.")
            }
        }

        # STATE 3: Execute controlled rollback
        $rollbackResult = Invoke-ControlledRollbackV15 -LiveConfigPath $LiveConfigPath `
            -GoldenBackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre `
            -ExpectedTriggerHash $liveCurrInfo.Hash -InitialError $replaceError

        # DELEGATE TO DISPATCHER V30 WITH UNBROKEN CANDIDATE PROVENANCE ($H_cand_pre)
        Dispatch-RollbackResultV30 `
            -RollbackResult $rollbackResult `
            -LiveConfigPath $LiveConfigPath `
            -GoldenBackupPath $goldenBackupPath `
            -ExpectedBaselineHash $H_live_pre `
            -ExpectedTriggerHash $liveCurrInfo.Hash `
            -CandidateHash $H_cand_pre `
            -TriggerError $replaceError `
            -ContextName "SWAP_FAILURE_RECOVERY"
    }

    # -------------------------------------------------------------------------
    # STAGE 3: POST-REPLACEMENT INTEGRITY VERIFICATION
    # -------------------------------------------------------------------------
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
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath `
            -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre -InitialError $postHashError `
            -HashInspectionError $postHashError -RollbackResult $null `
            -Detail "Post-replacement hash inspection query threw an unhandled exception."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Post-replacement hash query threw.")
    }
    elseif ($livePostInfo -eq $null -or $livePostInfo.Status -eq $null) {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath `
            -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre `
            -InitialError [System.InvalidOperationException]::new("Post-replacement inspection returned null") `
            -HashInspectionError $null -RollbackResult $null `
            -Detail "Post-replacement inspection returned null result object or status."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Post-replacement inspection returned null.")
    }
    elseif ($livePostInfo.Status -eq "FILE_MISSING") {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath `
            -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre `
            -InitialError [System.InvalidOperationException]::new("Post-replacement file missing") `
            -HashInspectionError $null -RollbackResult $null `
            -Detail "Live destination file is missing immediately after reported successful replace."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Post-replacement file missing.")
    }
    elseif ($livePostInfo.Status -eq "HASH_READ_FAILED") {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath `
            -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre `
            -InitialError [System.InvalidOperationException]::new("Post-replacement file unreadable") `
            -HashInspectionError $livePostInfo.Error -RollbackResult $null `
            -Detail "Live destination file is locked or unreadable after replace: $($livePostInfo.Message)"
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Post-replacement file unreadable.")
    }
    elseif ($livePostInfo.Status -eq "HELPER_EXCEPTION") {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath `
            -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre `
            -InitialError [System.InvalidOperationException]::new("Post-replacement helper exception") `
            -HashInspectionError $livePostInfo.Error -RollbackResult $null `
            -Detail "Hash helper failed on live destination after replace: $($livePostInfo.Message)"
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Post-replacement helper exception.")
    }
    elseif ($livePostInfo.Status -eq "HASH_VERIFIED" -and ($livePostInfo.Hash -ieq $H_cand_pre)) {
        try {
            Test-CandidateByteAndEncodingIntegrity -FilePath $LiveConfigPath
            $postValidationPassed = $true
        }
        catch {
            $postValidationError = $_.Exception
        }
    }
    elseif ($livePostInfo.Status -eq "HASH_VERIFIED" -and ($livePostInfo.Hash -ieq $H_live_pre)) {
        # STATE 2B / OUTCOME 1: Live file matches baseline pre-change hash (No-Op)
        Write-Host "[OUTCOME 1: TARGET UNCHANGED NO-OP] Post-replacement hash equals baseline [$H_live_pre]. Replacement had no effect." -ForegroundColor Yellow
        throw "FAIL-CLOSED ABORT [OUTCOME 1]: Replacement reported success, but live file hash is unchanged baseline [$H_live_pre]. No rollback needed. Aborting promotion."
    }
    elseif ($livePostInfo.Status -eq "HASH_VERIFIED" -and ($livePostInfo.Hash -ine $H_cand_pre)) {
        $postValidationError = [System.InvalidOperationException]::new("Promoted hash [$($livePostInfo.Hash)] matches neither candidate [$H_cand_pre] nor baseline [$H_live_pre].")
    }
    else {
        Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $goldenBackupPath `
            -ExpectedBaselineHash $H_live_pre -CandidateHash $H_cand_pre `
            -InitialError [System.InvalidOperationException]::new("Post-replacement inspection returned unknown status") `
            -HashInspectionError $null -RollbackResult $null `
            -Detail "Post-replacement inspection returned unknown status string [$($livePostInfo.Status)]."
        throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Post-replacement unknown status.")
    }

    if ($postValidationPassed) {
        # STATE 1 / OUTCOME 2: PROMOTION SUCCESS VERIFIED
        Write-Host "[OUTCOME 2: PROMOTION SUCCESS] Promoted live configuration verified on disk [SHA256: $($livePostInfo.Hash)]." -ForegroundColor Green
        Write-Host "[OUTCOME 2: ARTIFACT STATUS] Golden Backup [$goldenBackupPath] preserved on disk." -ForegroundColor Green
        return $goldenBackupPath
    }
    else {
        # STATE 3: Post-verification failed -> Trigger controlled rollback
        Write-Error "[STATE 3: POST-VERIFICATION FAILED] $($postValidationError.Message)"
        $rollbackResult = Invoke-ControlledRollbackV15 -LiveConfigPath $LiveConfigPath `
            -GoldenBackupPath $goldenBackupPath -ExpectedBaselineHash $H_live_pre `
            -ExpectedTriggerHash $livePostInfo.Hash -InitialError $postValidationError

        # DELEGATE TO DISPATCHER V30 WITH UNBROKEN CANDIDATE PROVENANCE ($H_cand_pre)
        Dispatch-RollbackResultV30 `
            -RollbackResult $rollbackResult `
            -LiveConfigPath $LiveConfigPath `
            -GoldenBackupPath $goldenBackupPath `
            -ExpectedBaselineHash $H_live_pre `
            -ExpectedTriggerHash $livePostInfo.Hash `
            -CandidateHash $H_cand_pre `
            -TriggerError $postValidationError `
            -ContextName "POST_VERIFY_FAILURE_RECOVERY"
    }
}
```

---

### 7.2 Hardened Rollback Dispatcher: `Dispatch-RollbackResultV30`

```powershell
# [NOT EXECUTED — UNTESTED OPERATIONAL PROCEDURE]

function Dispatch-RollbackResultV30 {
    <#
    .SYNOPSIS
        Evaluates the outcome of a controlled configuration rollback operation with
        exhaustive evidence validation, formal parameter provenance, precise .NET
        exception inheritance handling, and fail-closed terminal execution boundaries.
    .DESCRIPTION
        Step 2D-2A-AO-AD remediation:
        1. Formally enforces pre-body parameter binding barrier: caller wrappers must
           contain ParameterBindingException and never swallow it.
        2. Implements Stage 0 caller validation for CandidateHash (null/whitespace check +
           64-hex regex format validation); forwards verified digest to recovery boundary.
        3. Decouples rollback verification success from deployment continuation:
           Outcome 4 guarantees baseline safety but terminates via mandatory terminal throw.
        4. Preserves 35-class discard artifact taxonomy and 8-way HASH_READ_FAILED ladder.
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
                -Detail "[STATE 5B: $ContextName] DISCARD_ACCESS_DENIED: Access denied querying discard attributes: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard attributes access denied.")
        }
        catch [System.IO.IOException] {
            $hres = $_.Exception.HResult
            if ($hres -in $sharingViolationHResults) {
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                    -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                    -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                    -Detail "[STATE 5B: $ContextName] DISCARD_SHARING_VIOLATION: Verified file sharing lock querying discard attributes: $($_.Exception.Message)"
                throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard attributes sharing violation.")
            }
            else {
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                    -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                    -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                    -Detail "[STATE 5B: $ContextName] DISCARD_STAT_IO_UNDETERMINED: Undetermined I/O failure querying discard attributes [HResult: 0x$($hres.ToString('X8'))]: $($_.Exception.Message)"
                throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard attributes undetermined I/O failure.")
            }
        }
        catch {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5F: $ContextName] DISCARD_ATTR_QUERY_THREW: GetAttributes threw an unexpected exception: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard GetAttributes query threw.")
        }

        # Bitmask validations on attributes
        if (($attr -band [System.IO.FileAttributes]::Directory) -ne 0) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5C: $ContextName] DISCARD_IS_DIRECTORY: Discard backup path [$discardPath] is a directory, not a regular file. Fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard path is a directory.")
        }

        if (($attr -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                -Detail "[STATE 5C: $ContextName] DISCARD_IS_REPARSE_POINT: Discard backup path [$discardPath] is a reparse point (symlink/junction). Quarantine compromised — fail-closed."
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard path is a reparse point.")
        }

        # 3F. Discard Artifact Physical Size Inspection via FileInfo.Length
        $discardLength = -1
        try {
            $discardFi = [System.IO.FileInfo]::new($discardPath)
            $discardLength = $discardFi.Length
        }
        catch [System.IO.FileNotFoundException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5C: $ContextName] DISCARD_FILE_VANISHED: Discard backup vanished between attribute and size check: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard file vanished.")
        }
        catch [System.IO.DirectoryNotFoundException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5C: $ContextName] DISCARD_DIRECTORY_VANISHED: Discard parent directory vanished between attribute and size check: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard directory vanished.")
        }
        catch [System.IO.PathTooLongException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] DISCARD_PATH_INVALID: Discard path exceeds length limit on size query: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard path too long on size query.")
        }
        catch [System.ArgumentException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5D: $ContextName] DISCARD_PATH_INVALID: Discard path argument invalid on size query: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard path argument invalid on size query.")
        }
        catch [System.UnauthorizedAccessException] {
            Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                -Detail "[STATE 5B: $ContextName] DISCARD_ACCESS_DENIED: Access denied querying discard file length: $($_.Exception.Message)"
            throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard length access denied.")
        }
        catch [System.IO.IOException] {
            $hres = $_.Exception.HResult
            if ($hres -in $sharingViolationHResults) {
                Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                    -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                    -InitialError $TriggerError -HashInspectionError $_.Exception -RollbackResult $RollbackResult `
                    -Detail "[STATE 5B: $ContextName] DISCARD_SHARING_VIOLATION: Verified file sharing lock querying discard length: $($_.Exception.Message)"
                throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard length sharing violation.")
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

        # 3G. Independent Discard Cryptographic Hash Calculation
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

                if ($innerEx -eq $null) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                        -Detail "[STATE 5D: $ContextName] DISCARD_HASH_ERROR_METADATA_MISSING: Status is HASH_READ_FAILED, but Error property is null. Indeterminate — fail-closed."
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard hash error metadata missing.")
                }
                elseif ($innerEx -is [System.IO.FileNotFoundException]) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5C: $ContextName] DISCARD_FILE_DELETED_PRE_HASH: Discard file disappeared before stream open: $($innerEx.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard file deleted pre-hash.")
                }
                elseif ($innerEx -is [System.IO.DirectoryNotFoundException]) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5C: $ContextName] DISCARD_DIRECTORY_DELETED_PRE_HASH: Discard parent directory disappeared before stream open: $($innerEx.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard directory deleted pre-hash.")
                }
                elseif ($innerEx -is [System.IO.PathTooLongException]) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5D: $ContextName] DISCARD_HASH_PATH_TOO_LONG: Discard path length overflow during stream open: $($innerEx.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard hash path too long.")
                }
                elseif ($innerEx -is [System.ArgumentException]) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5D: $ContextName] DISCARD_HASH_ARGUMENT_INVALID: Discard path argument invalid during stream open: $($innerEx.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard hash argument invalid.")
                }
                elseif ($innerEx -is [System.UnauthorizedAccessException]) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $innerEx -RollbackResult $RollbackResult `
                        -Detail "[STATE 5B: $ContextName] DISCARD_FILE_ACCESS_DENIED: Access denied opening discard file stream: $($innerEx.Message)"
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard file stream access denied.")
                }
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
                if ([string]::IsNullOrWhiteSpace($discardHashInfo.Hash)) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                        -Detail "[STATE 5D: $ContextName] DISCARD_HASH_METADATA_MISSING: Helper returned HASH_VERIFIED, but Hash property is null or empty. Fail-closed."
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard hash property is missing.")
                }

                if ($discardHashInfo.Hash -notmatch $sha256Regex) {
                    Enter-ManualRecoveryBoundaryV14 -LivePath $LiveConfigPath -BackupPath $GoldenBackupPath `
                        -ExpectedBaselineHash $ExpectedBaselineHash -CandidateHash $CandidateHash `
                        -InitialError $TriggerError -HashInspectionError $null -RollbackResult $RollbackResult `
                        -Detail "[STATE 5D: $ContextName] DISCARD_HASH_METADATA_MALFORMED: Helper returned HASH_VERIFIED, but Hash [$($discardHashInfo.Hash)] is not a valid 64-char SHA-256 hex string. Fail-closed."
                    throw [System.InvalidOperationException]::new("FAIL-CLOSED TERMINAL GUARD: Discard hash property is malformed.")
                }

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
        # ROLLBACK VERIFICATION SUCCEEDED, BUT DEPLOYMENT IS TERMINATED FAIL-CLOSED
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

### 7.3 Reference Caller Deployment Pipeline Wrapper: `Invoke-DeployPostgresConfigV1`

To establish an authoritative implementation pattern for CI/CD runners and deployment orchestrators, the reference wrapper contract is defined below:

```powershell
# [NOT EXECUTED — UNTESTED OPERATIONAL PROCEDURE]

function Invoke-DeployPostgresConfigV1 {
    <#
    .SYNOPSIS
        Orchestrates an end-to-end PostgreSQL configuration deployment, demonstrating
        proper exception handling, forensic evidence recording, and non-zero exit code
        propagation across Outcome 4, manual recovery boundaries, and parameter binding faults.
    #>
    param (
        [Parameter(Mandatory = $true)]
        [string]$LiveConfigPath,

        [Parameter(Mandatory = $true)]
        [string]$CandidatePath,

        [Parameter(Mandatory = $true)]
        [string]$ChangeTicketId
    )

    Write-Host "[DEPLOYMENT PIPELINE: START] Initiating change ticket: $ChangeTicketId" -ForegroundColor Cyan

    $backupPath = $null
    try {
        $backupPath = Invoke-SafeConfigReplacementV18 `
            -LiveConfigPath $LiveConfigPath `
            -CandidatePath $CandidatePath `
            -Description "Change Ticket $ChangeTicketId"
    }
    catch [System.Management.Automation.ParameterBindingException] {
        # FINDING AD-1: Pre-body parameter binding failure intercepted at caller
        Write-Error "[FATAL PIPELINE DEFECT] Parameter binding failed invoking replacement engine: $($_.Exception.Message)"
        Write-Error "[FORENSIC AUDIT] Missing or invalid arguments provided. Halting pipeline fail-closed."
        $global:LASTEXITCODE = 105
        throw "FAIL-CLOSED ABORT: Pipeline halted due to fatal parameter binding defect."
    }
    catch {
        $exMsg = $_.Exception.Message

        if ($exMsg -like "*OUTCOME 4*") {
            # FINDING AD-2: Rollback succeeded, but deployment failed. Live cluster safe.
            Write-Host "`n========================================================" -ForegroundColor Yellow
            Write-Host "   DEPLOYMENT ABORTED — LIVE CLUSTER SAFELY ON BASELINE  " -ForegroundColor Yellow
            Write-Host "========================================================" -ForegroundColor Yellow
            Write-Host "[AUDIT] Configuration rollback succeeded and was verified on disk."
            Write-Host "[AUDIT] Live PostgreSQL service remains safe on pre-change baseline configuration."
            Write-Host "[AUDIT] Automated retries are STRICTLY PROHIBITED."
            Write-Host "[AUDIT] Downstream tasks (migrations, app pool starts) CANCELLED."
            
            # Record exit code 104 (Deployment Aborted / Rollback Verified)
            $global:LASTEXITCODE = 104
            throw "FAIL-CLOSED ABORT [OUTCOME 4]: Deployment aborted. Live service safe on baseline."
        }
        else {
            # UNRECOVERED / MANUAL RECOVERY (States 5A-5F or Pre-Flight Abort)
            Write-Error "`n========================================================"
            Write-Error "   CRITICAL ALERT: DEPLOYMENT FAILED — MANUAL RECOVERY  "
            Write-Error "========================================================"
            Write-Error "[AUDIT] Deployment halted under fatal condition: $exMsg"
            Write-Error "[AUDIT] Human Incident Commander required. Automated operations ceased."
            
            # Record exit code 1 (Fatal Deployment Error)
            $global:LASTEXITCODE = 1
            throw "FAIL-CLOSED ABORT: Deployment failed with unrecovered error: $exMsg"
        }
    }

    # -------------------------------------------------------------------------
    # DOWNSTREAM TASKS (EXECUTED ONLY UPON PROVEN PROMOTION SUCCESS)
    # -------------------------------------------------------------------------
    Write-Host "[DEPLOYMENT PIPELINE: PROCEEDING] Configuration promotion verified on disk." -ForegroundColor Green
    Write-Host "[DEPLOYMENT PIPELINE: TASKS] Executing verified database migrations..." -ForegroundColor Green
    # Subsequent steps execute here...
}
```

---

## 8. Revised 35-Class Discard Taxonomy & Reconciled 4-Dimensional Counts

### 8.1 Complete 35-Class Discard Artifact Taxonomy (`DISC-01` through `DISC-35`)

The 35-class discard artifact taxonomy established in Steps AO-V through AO-AC remains immutable and exhaustive:

| Class ID | Physical Discard Artifact State | Concrete Trigger Condition in Dispatcher V30 | Mapped Failure State | Control Flow Guarantee | Forensic Implication |
|---|---|---|---|---|---|
| **DISC-01** | Discard path is `$null` | `[string]::IsNullOrWhiteSpace($discardPath)` | **State 5D** | Local Terminal Throw | Rollback engine returned incomplete result object. |
| **DISC-02** | Discard path is empty string `""` | `[string]::IsNullOrWhiteSpace($discardPath)` | **State 5D** | Local Terminal Throw | Path variable uninitialized in engine response. |
| **DISC-03** | Discard path is whitespace string `"   "` | `[string]::IsNullOrWhiteSpace($discardPath)` | **State 5D** | Local Terminal Throw | Path variable malformed in engine response. |
| **DISC-04** | Discard file absent on disk | `GetAttributes` throws `FileNotFoundException` | **State 5C** | Local Terminal Throw | Discard quarantine file was not captured. |
| **DISC-05** | Discard parent directory absent | `GetAttributes` throws `DirectoryNotFoundException`| **State 5C** | Local Terminal Throw | Backup directory structure does not exist. |
| **DISC-06** | Discard path exceeds MAX_PATH | `GetAttributes` throws `PathTooLongException` | **State 5D** | Local Terminal Throw | Path buffer overflow; invalid path specification. |
| **DISC-07** | Discard path contains illegal characters | `GetAttributes` throws `ArgumentException` | **State 5D** | Local Terminal Throw | Syntax corruption in discard backup path. |
| **DISC-08** | Discard path access denied | `GetAttributes` throws `UnauthorizedAccessException`| **State 5B** | Local Terminal Throw | ACL/permissions restriction querying attributes. |
| **DISC-09** | Discard attribute query sharing violation | `GetAttributes` throws `IOException` (`0x80070020`/`21`)| **State 5B** | Local Terminal Throw | Antivirus / file-system lock during stat. |
| **DISC-10** | Discard path is a directory container | `($attr -band Directory) -ne 0` | **State 5C** | Local Terminal Throw | Artifact is a directory container, not a leaf file. |
| **DISC-11** | Discard path is a reparse point (symlink/junction)| `($attr -band ReparsePoint) -ne 0` | **State 5C** | Local Terminal Throw | Reparse point aliases external location. |
| **DISC-12** | Discard deleted between attribute and size checks | `FileInfo.Length` throws `FileNotFoundException` | **State 5C** | Local Terminal Throw | Mid-flight deletion race; file vanished post-stat. |
| **DISC-13** | Discard directory deleted between attribute and size checks | `FileInfo.Length` throws `DirectoryNotFoundException`| **State 5C** | Local Terminal Throw | Mid-flight directory removal during size query. |
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

### 8.2 Comprehensive 4-Dimensional Accounting Model

To eliminate any potential accounting ambiguity across AST syntax, runtime control flows, and test suites, the 4-dimensional model is reconciled below:

#### Dimension 1: Syntactic AST Decision Points
- **Pre-Flight Replacement Engine (`Invoke-SafeConfigReplacementV18` PF-0 through PF-4B):** **45 decision points**  
  - PF-0: Candidate byte/encoding try/catch (1)  
  - PF-1: Live pre-hash try/catch (1), error check (1), null object (1), null status (1), switch 5-way with hash metadata regex validation (5) = 9  
  - PF-1B: Candidate pre-hash try/catch (1), error check (1), null object (1), null status (1), switch 5-way with non-null check (1) and 64-hex regex format check (1) = 11 (hardened)  
  - PF-2: Golden backup ReadAllBytes try/catch (1), FileStream try/catch (1), IOException collision check (1), general catch (1) = 4  
  - PF-3: Golden backup verification try/catch (1), error check (1), null object (1), null status (1), switch 5-way with baseline equality check (1) = 9  
  - PF-4A: Pre-swap candidate barrier try/catch (1), error check (1), null object (1), null status (1), switch 5-way with non-null check (1), regex check (1), and baseline equality check (1) = 11 (hardened)  
  - PF-4B: Pre-swap live barrier try/catch (1), error check (1), null object (1), null status (1), switch 5-way with pre-change equality check (1) = 9  
  *(Subtotal PF Engine = $1 + 9 + 11 + 4 + 9 + 11 + 9 = \mathbf{54\text{ decision points}}$)*
- **Replacement Swap & Post-Swap Live Inspection (Stages 2–3 in Replacement Engine):** **17 decision points**
- **Recovery Boundary Non-Mutating Diagnostics (`Enter-ManualRecoveryBoundaryV14`):** **7 decision points**
- **Rollback Dispatcher V30 (`Dispatch-RollbackResultV30`):** **55 decision points**  
  - Stage 0: 6 checks (Baseline null/whitespace, Baseline regex, Trigger null/whitespace, Trigger regex, Candidate null/whitespace, Candidate regex)  
  - Stage 1: 1 check (RollbackResult null)  
  - Stage 2: 2 contradiction traps  
  - Stage 3: 39 evidence checks & try/catch branches (RestoredHash checks: 3; DiscardPath check: 1; GetAttributes: 10; FileInfo.Length: 9; Hash calculation: 16)  
  - Stage 4: 1 check (rbStatus null/empty)  
  - Stage 5: 6 switch branches across 54 failure statuses  
- **Total Syntactic AST Decision Points:** $54 + 17 + 7 + 55 = \mathbf{133\text{ decision points}}$.

#### Dimension 2: Semantic Pipeline Outcome Paths
- Pre-Flight Replacement Outcomes: **50 semantic paths**
- Replacement Swap & Post-Swap Live Barrier Outcomes: **19 semantic paths**
- Rollback Engine Internal Return Paths: **55 return paths**
- Recovery Diagnostic Outcomes: **7 diagnostic paths**
- Outer Dispatcher Discard Validation Outcome Paths: **35 distinct paths** (DISC-01 through DISC-35)
- **Total Semantic Pipeline Outcome Paths:** $50 + 19 + 55 + 7 + 35 = \mathbf{166\text{ paths}}$.

#### Dimension 3: Defined Test Specifications
- **Replacement Pre-Flight & Promotion Suite:** `TEST-01` through `TEST-34` (**34 specifications**)
- **Outer-Dispatch Integrity Suite:** `DSP-01` through `DSP-144` (**144 specifications**, expanded from 135)
- **Recovery Diagnostic Suite:** `REC-01` through `REC-07` (**7 specifications**)
- **Total Test Specifications Defined:** $34 + 144 + 7 = \mathbf{185\text{ test specifications}}$.

#### Dimension 4: Executed Operational Tests
- **Executed Operational Tests:** **ZERO (0).**  
  All 185 test specifications across all three suites are strictly marked **`[NOT EXECUTED — UNTESTED]`**.

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

- **UNVERIFIED: Antivirus / Endpoint Detection and Response (EDR) Interception of Process Termination:**  
  While PowerShell terminating exceptions and `exit 104` commands reliably halt user scripts, certain Windows enterprise security agents (e.g., Falcon, Defender ATP) inject hooks into PowerShell host processes. In rare cases, these hooks capture unhandled exceptions for telemetry without preserving the specific non-zero exit code on process exit. Verification in a production-identical staging environment is required before Gate 6 approval.

---

## 10. Explicit Execution-Status & Safety Confirmation

### 10.1 Precise Execution-Status Accounting

To maintain absolute transparency and compliance:

- **Operational Procedures & Scripts:** **ZERO (0) EXECUTED.**  
  `Dispatch-RollbackResultV30`, `Invoke-SafeConfigReplacementV18`, `Invoke-DeployPostgresConfigV1`, `Invoke-ControlledRollbackV15`, `Enter-ManualRecoveryBoundaryV14`, and all 185 test specifications are strictly **`[NOT EXECUTED — UNTESTED]`**.
- **Read-Only Diagnostic Commands:** **ZERO (0)** operational commands executed in this step.  
- **Host & Database Alterations:** **ZERO (0).** No configuration files (`postgresql.conf`, `pg_hba.conf`), Windows Firewall rules, Windows services, application code, or `.env` files were modified. No databases, schemas, tables, roles, or records were created, altered, or dropped.
- **Cloud Connections:** **ZERO (0).** No connections made to Neon, AWS, Supabase, Render, or any remote infrastructure.
- **Budget Preservation:** Strict ₹0/month budget preserved.
- **Preserved Application Databases:** Catalogs `hisecure_erp`, `hitech_platform`, and `zentra_test` remain completely untouched.

---

```
STOP — STEP 2D-2A-AO-AD COMPLETE — WAITING FOR HUMAN REVIEW
```
