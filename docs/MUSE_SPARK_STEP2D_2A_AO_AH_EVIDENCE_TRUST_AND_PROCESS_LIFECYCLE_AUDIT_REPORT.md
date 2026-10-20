# MUSE SPARK — ZENTRA STEP 2D-2A-AO-AH
## EVIDENCE TRUST BOUNDARY, REPLAY RESISTANCE & PROCESS LIFECYCLE AUDIT REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Target Repository:** `D:\Zentra`  
**Input Reference:** [`docs/MUSE_SPARK_STEP2D_2A_AO_AG_IMMUTABLE_EVIDENCE_AND_PROCESS_ARGUMENT_AUDIT_REPORT.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_AO_AG_IMMUTABLE_EVIDENCE_AND_PROCESS_ARGUMENT_AUDIT_REPORT.md)  
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

A rigorous threat-modeling, replay-resistance, argument-parsing, and process-lifecycle audit of Step 2D-2A-AO-AG (`Zentra.Security.ZentraRollbackEvidence`, `ZentraRollbackVerifiedException`, `Format-Win32Argument`, `Invoke-ParentDeploymentRunnerV2`, and related deployment contracts) identified **five critical architectural vulnerabilities**:

1. **Overstated In-Process Immutability & Missing Construction Trust Boundary (Finding AH-1):**  
   Step AO-AG claimed that declaring `ZentraRollbackEvidence` as a sealed C# class with getter-only properties rendered evidence "tamper-proof" and "physically impossible to mutate."  
   **The Critical Defect:** In .NET Full Trust runspaces (standard in PowerShell), Reflection (`BindingFlags.NonPublic | BindingFlags.Instance`) can still mutate `initonly` backing fields via `FieldInfo.SetValue()`. More critically, the constructor was declared public without authentication: **any unauthorized script or intermediate catch block in the runspace could construct a fraudulent evidence object** with fabricated hashes!  
   **Remediation:** The threat model is formally corrected: in-process CLR immutability prevents accidental or standard property mutation, but does not constitute an operating-system trust boundary. Construction is restricted to an authenticated factory pattern requiring a cryptographically random deployment execution token (nonce). The process entrypoint revalidates evidence against physical disk state before emitting Exit Code `104`.
2. **The Fragility of Timestamp-Only Freshness & Missing Nonce Replay Resistance (Finding AH-2):**  
   Step AO-AG relied on a 300-second UTC timestamp window (`IsEvidenceFresh()`) to prevent replay.  
   **The Critical Defect:** A timestamp window does **not** prevent replay; within the 300-second window, an attacker or malfunctioning loop could replay the exact same evidence object dozens of times. Furthermore, clock skew or manual time adjustments break timestamp validation. Additionally, AO-AG treated `CandidateHash != ExpectedBaselineHash` as an unconditional mathematical invariant without clarifying its operational policy context.  
   **Remediation:** An authoritative **Zero-Cost Ephemeral Nonce Ledger** is implemented. Each deployment run generates a cryptographically random `DeploymentExecutionId` (GUID) bound to the evidence. Once validated, the nonce is recorded in a local filesystem ledger (`D:\Zentra\logs\forensics\.consumed_nonces\<id>`); any subsequent attempt to evaluate an already-consumed nonce fails closed immediately. The candidate-versus-baseline inequality is formally codified as a mandatory Zentra deployment business rule.
3. **PowerShell Engine Command-Line Parsing Discrepancies (Finding AH-3):**  
   Step AO-AG designed `Format-Win32Argument` conforming to Microsoft's Win32 `CommandLineToArgvW` rules.  
   **The Critical Defect:** Win32 `CommandLineToArgvW` governs standard C/C++ runtime argument parsing. However, `powershell.exe -File` has **PowerShell's own secondary argument-parsing engine**. Certain characters (such as double quotes, semicolons, dollar signs, and backticks) undergo secondary interpretation if not passed with explicit literal escaping. Furthermore, AO-AG claimed the algorithm was safe without specifying an automated verification harness.  
   **Remediation:** A dual-layer argument verification harness is designed using a dedicated, harmless argument-echo child script (`Test-EchoArgs.ps1`) to verify round-trip byte-for-byte fidelity across empty strings, spaces, embedded quotes, and trailing backslashes.
4. **Orphaned Process Leakage under .NET Framework `Process.Kill()` (Finding AH-4):**  
   Step AO-AG utilized `Process.Kill()` on deployment timeout.  
   **The Critical Defect:** On Windows PowerShell 5.1 running on .NET Framework 4.8, `Process.Kill()` terminates **only the immediate parent `powershell.exe` process**. It lacks the `.NET Core 3.0+` `entireProcessTree: true` overload. If the child script spawned child sub-processes (e.g. `psql.exe`, background workers), those descendants survive as orphaned background processes holding file locks on PostgreSQL configuration files!  
   **Remediation:** The parent runner lifecycle is hardened: on timeout, `Invoke-ParentDeploymentRunnerV3` issues a tree-kill command using native Windows `taskkill.exe /PID $proc.Id /T /F` followed by process disposal, guaranteeing clean teardown of all descendant processes.
5. **Deterministic Test Matrix Expansion & Arithmetic Reconciliation (Finding AH-5):**  
   Twelve new deterministic test specifications (`DSP-187` through `DSP-198`) are defined covering duplicate nonce replay, reflection tamper attempts, candidate-baseline no-op policy traps, argument-echo child verification, process-tree orphan termination, pipe stream exceptions, and parent runner exit enforcement.  
   The Outer-Dispatch suite expands from 186 to **198 specifications (`DSP-01` through `DSP-198`)**, bringing total defined specifications across all suites to **239 specifications**, all strictly marked **`[NOT EXECUTED — UNTESTED]`**. Structural AST decision points reconcile cleanly to **133 decision points**.

---

## 2. Summary of Identified Audit Findings

| Finding ID | Source Report Location | Description | Impact | Remediation in Step AO-AH |
|---|---|---|---|---|
| **FIND-AH1** | Step AO-AG<br/>Section 3.1 & 3.2 | **Overstated CLR Immutability & Unrestricted Evidence Construction:** Claimed C# getter-only properties are "tamper-proof"; public constructor allowed any script to forge evidence. | Reflection can mutate backing fields in full trust; unauthorized code can instantiate fake `ZentraRollbackEvidence` objects. | Acknowledge reflection limits; bind evidence construction to an internal token; mandate entrypoint re-verification of physical disk state before Exit 104. |
| **FIND-AH2** | Step AO-AG<br/>Section 4.1 & 4.2 | **Replay Vulnerability of Timestamp Window & Unclarified Candidate Invariant:** 300s window allowed multi-replay of identical evidence; candidate-baseline inequality lacked business justification. | Old evidence replayed within 300s; no-op deployments conflated with rollback corruption. | Implement Zero-Cost Ephemeral Nonce Ledger (`.consumed_nonces`); formally codify candidate-baseline inequality as a mandatory Zentra policy rule. |
| **FIND-AH3** | Step AO-AG<br/>Section 5.1 & 5.2 | **PowerShell Secondary Argument-Parsing Gap:** `Format-Win32Argument` conformed to Win32 `CommandLineToArgvW`, but ignored `powershell.exe -File` parser nuances. | Special characters and quotes could be misinterpreted by PowerShell's command-line parser; argument preservation was unverified. | Design an automated argument-echo test harness (`Test-EchoArgs.ps1`) to verify round-trip argument fidelity for all edge cases. |
| **FIND-AH4** | Step AO-AG<br/>Section 6.2 & 8.2 | **Process Tree Orphan Leakage under .NET Framework 4.8:** `Process.Kill()` kills only root process on PowerShell 5.1; leaves descendants running. | Descendant processes (`psql.exe`, CLI tools) become orphaned, holding locks on database files and preventing recovery. | Implement Windows tree-kill via `taskkill.exe /PID $proc.Id /T /F` followed by process disposal in `Invoke-ParentDeploymentRunnerV3`. |
| **FIND-AH5** | Step AO-AG<br/>Section 7 & 8.1 | **Missing Edge-Case Test Specifications:** Lacked tests for nonce reuse, reflection tampering, process-tree orphan cleanup, and argument-echo verification. | Failure modes in replay detection, process cleanup, and argument passing remained unverified in specifications. | Add 12 new deterministic test specifications (`DSP-187` through `DSP-198`); expand Outer-Dispatch suite to **198 tests** (239 total across all suites). |

---

## 3. Finding AH-1 — Evidence Trust Boundary & Immutability Threat Model

### 3.1 The Limits of CLR In-Process Immutability

Step AO-AG correctly established that getter-only auto-properties in C# prevent standard property assignment in PowerShell. However, claiming that this makes evidence "tamper-proof" is an architectural overstatement that violates security threat modeling:

```
[In-Process Threat Reality: PowerShell Full-Trust Runspace]
  ┌───────────────────────────────────────────────────────────┐
  │ Managed CLR Runspace (PowerShell.exe / AppDomain)         │
  │                                                           │
  │  [ZentraRollbackEvidence] (C# Sealed Class)               │
  │    ├── Backing Field: <RestoredLiveHash>k__BackingField  │
  │    └── Backing Field: <DiscardHash>k__BackingField        │
  │                                                           │
  │  VULNERABILITY 1: Full-Trust Reflection                   │
  │    $field = [ZentraRollbackEvidence].GetField(            │
  │        '<RestoredLiveHash>k__BackingField',               │
  │        'NonPublic,Instance')                              │
  │    $field.SetValue($evidence, "forged_hash_value")        │
  │    --> CLR permits mutation in Full Trust!                │
  │                                                           │
  │  VULNERABILITY 2: Public Constructor Forgery              │
  │    $fake = [ZentraRollbackEvidence]::new(                 │
  │        "forged_restored", "forged_baseline", ...)         │
  │    --> Any script in the runspace can forge evidence!     │
  └───────────────────────────────────────────────────────────┘
```

### 3.2 Formal Trust Boundary Invariants

To eliminate these vulnerabilities, the system enforces three architectural rules:

1. **No In-Process Security Boundary:**  
   Security cannot be enforced between functions running in the **same PowerShell runspace** under Full Trust. In-process immutability protects against *accidental modification*, *concurrency races*, and *routine script bugs*, but **not against an active adversary with arbitrary code execution in the same runspace**.
2. **Construction Token Binding:**  
   The constructor of `ZentraRollbackEvidence` requires a cryptographically random, internal `ConstructionToken` known only to the trusted rollback dispatcher. If an unauthorized caller attempts to instantiate `ZentraRollbackEvidence` without the matching token, the constructor throws an `UnauthorizedAccessException`.
3. **Mandatory Physical Disk Revalidation at Entrypoint:**  
   The process entrypoint (`Invoke-DeployPostgresConfigV3`) must **never** blindly trust the in-memory `ZentraRollbackEvidence` object. Before emitting Exit Code `104`, the entrypoint re-checks that the discard file actually exists on physical disk, is a leaf file, and has a non-zero byte length. If the disk state contradicts the evidence object, the entrypoint halts fail-closed with Exit Code `1`.

---

## 4. Finding AH-2 — Replay Resistance & Provenance Contract

### 4.1 The Replay Attack Surface

A 300-second timestamp freshness window (`IsEvidenceFresh()`) is an insufficient replay defense:
- **Replay Within Window:** If an automated deployment script encounters a rollback at second 10, an attacker or malfunctioning retry loop can re-submit the identical evidence payload at second 15, second 30, and second 200. Each submission would pass the freshness check!
- **Clock Skew & Tampering:** Virtualized build agents frequently experience clock drift or NTP synchronization steps, creating false positives or allowing expired evidence to pass.

### 4.2 The Zero-Cost Ephemeral Nonce Ledger

To achieve deterministic replay resistance without external paid services or database dependencies, the platform implements a **Local Filesystem Nonce Ledger**:

```
[Deployment Initialization: Parent Runner]
  │  Generates cryptographically random Nonce: $DeploymentNonce = [Guid]::NewGuid().ToString("N")
  │  Transmits $DeploymentNonce to child deployment process
  ▼
[Child Process: Dispatch-RollbackResultV34]
  │  Rollback verified clean
  │  Binds $DeploymentNonce into ZentraRollbackEvidence
  ▼
[Child Entrypoint: Invoke-DeployPostgresConfigV3]
  │  Intercepts ZentraRollbackVerifiedException
  │  Extracts $evidence.DeploymentNonce
  │
  ├─► Check Ledger: D:\Zentra\logs\forensics\.consumed_nonces\<DeploymentNonce>
  │     ├── Ledger File Exists? ──► REPLAY DETECTED! Haults Fail-Closed (Exit Code 1)
  │     └── Ledger File Absent?
  │           │
  │           ▼
  ├─► Atomically Create Ledger File (FileMode::CreateNew)
  │     ├── Success ──► Nonce CONSUMED and LOCKED
  │     └── Collision (Race condition) ──► REPLAY DETECTED! Haults Fail-Closed (Exit Code 1)
  ▼
[Outcome 4 Authorized: Exit Code 104]
```

#### Nonce Ledger Properties
- **Zero Cost:** Pure Windows NTFS filesystem implementation; ₹0/month expenditure preserved.
- **Atomic Creation:** Uses `[System.IO.FileMode]::CreateNew` with `FileShare.None`. If two processes attempt to consume the same nonce concurrently, one succeeds and the other immediately throws an `IOException` (collision), preventing race replays.
- **Retention Policy:** Ledger files are retained for 7 days in `D:\Zentra\logs\forensics\.consumed_nonces` and pruned by scheduled maintenance.

### 4.3 Operational Justification: Candidate vs. Baseline Hash Inequality

Step AO-AG enforced that `CandidateHash` must strictly differ from `ExpectedBaselineHash`:
```csharp
if (this.CandidateHash.ToLowerInvariant() == this.ExpectedBaselineHash.ToLowerInvariant()) {
    return false; // Contradiction
}
```

#### Operational Policy Context
- **The Question:** Why should deploying a file identical to baseline be rejected as a failure?
- **The Business Invariant:** In the Zentra platform, a configuration change ticket represents an intentional operational mutation. If a candidate configuration file is byte-for-byte identical to the active baseline, **the change ticket is a no-op**.
- **The Rollback Invariant:** If `CandidateHash == ExpectedBaselineHash`, and a rollback occurred, it means the system attempted to replace baseline with baseline, yet somehow detected a corruption or swap error! This represents a severe physical inconsistency or concurrent file modification by an external entity.
- **Policy Rule:** No-op deployments must be identified and aborted at pre-flight (PF-1B) with `PREFLIGHT_CANDIDATE_IDENTICAL_TO_BASELINE`. If an identical candidate reaches rollback dispatch, it is strictly treated as an invariant violation (State 5D), failing closed.

---

## 5. Finding AH-3 — Windows Argument Quoting & Verification Design

### 5.1 Win32 `CommandLineToArgvW` vs. PowerShell `-File` Parsing

A critical distinction exists between Windows kernel process creation and PowerShell host execution:

```
[Layer 1: Windows Kernel / CreateProcessW]
  Command-Line String: powershell.exe -NoProfile -File "D:\Zentra\deploy.ps1" -LiveConfigPath "D:\Zentra\config\"
  Parsed by C runtime using CommandLineToArgvW rules:
  Arg 0: powershell.exe
  Arg 1: -NoProfile
  Arg 2: -File
  Arg 3: D:\Zentra\deploy.ps1
  Arg 4: -LiveConfigPath
  Arg 5: D:\Zentra\config"   <--- TRUNCATION DEFECT IF TRAILING BACKSLASH NOT DOUBLED!
         │
         ▼
[Layer 2: PowerShell Engine Parameter Binder]
  PowerShell inspects its argv array and binds arguments to script parameters.
  If an argument contains raw quotes or unbalanced delimiters, PowerShell's
  internal command-line tokenizer re-splits the tokens, corrupting parameter values!
```

### 5.2 The Trailing Backslash & Internal Quote Invariant

In Microsoft's Win32 command-line specification, the backslash `\` is an escape character **only when it precedes a double quote `"`**:
- `\` followed by a regular character `a` is a literal `\a`.
- `\` followed by `"` escapes the quote, producing a literal `"`.
- Therefore, $2N$ backslashes followed by `"` produce $N$ backslashes followed by an unescaped quote (which ends the argument).
- $2N + 1$ backslashes followed by `"` produce $N$ backslashes followed by an escaped quote.
- **The Rule for Trailing Backslashes:** If a path ends with `\` (e.g. `D:\Zentra\config\`), and is enclosed in quotes, the trailing backslash precedes the closing quote! It **must be doubled** (`D:\Zentra\config\\"`), so `CommandLineToArgvW` sees $2$ backslashes before `"`, producing one literal trailing backslash and an unescaped closing quote.

### 5.3 Automated Argument Verification Harness Design

To verify that `Format-Win32Argument` transmits arguments with 100% fidelity without executing operational deployment code, an independent test harness is specified:

```powershell
# [NOT EXECUTED — UNTESTED SPECIFICATION HARNESS]
# Target Test Script: tests/harness/Test-EchoArgs.ps1
# Contents:
#   param([string]$Arg1, [string]$Arg2, [string]$Arg3, [string]$Arg4)
#   [PSCustomObject]@{
#       Arg1 = $Arg1; Arg2 = $Arg2; Arg3 = $Arg3; Arg4 = $Arg4
#   } | ConvertTo-Json -Compress

# Test Verification Logic in Parent Runner:
#   1. Format complex test arguments containing spaces, quotes, and trailing backslashes.
#   2. Launch powershell.exe -File Test-EchoArgs.ps1 with formatted arguments.
#   3. Deserialize child JSON output.
#   4. Assert that child received strings are byte-for-byte identical to input strings.
```

---

## 6. Finding AH-4 — Process Lifecycle, Timeout & Downstream Control

### 6.1 The Descendant Process Leakage Flaw in .NET Framework 4.8

On Windows Workstations running Windows PowerShell 5.1 (.NET Framework 4.8):
- `System.Diagnostics.Process.Kill()` invokes the Win32 API `TerminateProcess(hProcess, exitCode)`.
- `TerminateProcess` operates strictly on the specific process handle.
- It **does not terminate child processes spawned by that process**.
- If `Deploy-PostgresConfig.ps1` spawned `psql.exe`, background health probes, or helper CLI commands, killing `powershell.exe` leaves all descendant processes running as orphaned background processes!
- These orphaned processes continue holding locks on PostgreSQL configuration files and listening sockets, sabotaging subsequent manual or automated recovery operations!

### 6.2 Hardened Process Tree Teardown via `taskkill.exe`

To guarantee that no orphaned descendant processes survive a timeout or forced cancellation on .NET Framework 4.8, `Invoke-ParentDeploymentRunnerV3` implements native Windows process-tree termination:

```powershell
# [NOT EXECUTED — UNTESTED OPERATIONAL SPECIFICATION]

function Stop-ProcessTreeSafely {
    param (
        [int]$ProcessId
    )

    if ($ProcessId -le 0) { return }

    try {
        # Win32 taskkill with /T (tree kill) and /F (force) terminates process and all children
        $killPsi = [System.Diagnostics.ProcessStartInfo]::new()
        $killPsi.FileName               = "taskkill.exe"
        $killPsi.Arguments              = "/PID $ProcessId /T /F"
        $killPsi.UseShellExecute        = $false
        $killPsi.CreateNoWindow         = $true
        $killPsi.RedirectStandardOutput = $true
        $killPsi.RedirectStandardError  = $true

        $killProc = [System.Diagnostics.Process]::Start($killPsi)
        $killProc.WaitForExit(5000) # Bounded 5-second wait
        $killProc.Dispose()
    }
    catch {
        # Fallback to standard CLR Process.Kill if taskkill is restricted
        try {
            $p = [System.Diagnostics.Process]::GetProcessById($ProcessId)
            $p.Kill()
            $p.Dispose()
        } catch {}
    }
}
```

### 6.3 Downstream CI/CD Pipeline Enforcement Matrix

A parent CI/CD orchestrator must strictly enforce the following execution policies:

| Child Exit Code | Meaning | Downstream Tasks (Migrations / Restarts) | Automated CI/CD Retries | Alerting Level |
|---|---|---|---|---|
| **0** | Promotion Verified | **PERMITTED** (Only after independent pre-check) | N/A (Succeeded) | Info (Normal Green) |
| **104** | Outcome 4 Verified Clean | **STRICTLY CANCELLED** | **STRICTLY LOCKED OUT** | Warning (Yellow / Aborted) |
| **105** | Parameter Binding Defect | **STRICTLY CANCELLED** | **STRICTLY LOCKED OUT** | Error (Red / Pipeline Defect) |
| **1** | Manual Recovery Active | **STRICTLY CANCELLED** | **STRICTLY LOCKED OUT** | Critical (Red / Incident Commander) |
| **Null / Timeout** | Launch Crash / Hang | **STRICTLY CANCELLED** | **STRICTLY LOCKED OUT** | Critical (Red / Tooling Failure) |

---

## 7. Deterministic Test Matrix Expansion (`DSP-187` through `DSP-198`)

Twelve new deterministic test specifications are defined to rigorously validate nonce replay prevention, argument-echo fidelity, process-tree termination, and reflection tamper resistance:

| Test ID | Barrier / Component | Injected Fault / Failure Scenario | Expected Execution Outcome | Expected RollbackResult Object State | Target State | Mapped Diagnostic State | Physical Disk State Guarantee |
|---|---|---|---|---|---|---|---|
| **DSP-187**| Nonce Ledger | Duplicate deployment nonce replayed within 300s freshness window | Ledger detects existing file in `.consumed_nonces`; throws collision error | `Success=$true` | **Replay Trapped** | Nonce Duplicate Rejected | Second evaluation fails closed to Exit Code 1. Disk state untouched. |
| **DSP-188**| Nonce Ledger | Nonce ledger directory access denied / disk full on creation | Ledger `CreateNew` throws `IOException`; entrypoint halts fail-closed | `Success=$true` | **Caller Fatal** | Nonce Write Failed | Ledger write failure treated as fatal; Exit Code 1 emitted. |
| **DSP-189**| Construction Auth | Unauthorized script instantiates `ZentraRollbackEvidence` with invalid token | Constructor throws `UnauthorizedAccessException`; object creation blocked | None | **Auth Fatal** | Construction Denied | Evidence forgery blocked in user-mode code. |
| **DSP-190**| Policy Constraint | Candidate configuration file is identical to baseline pre-change file | Pre-flight PF-1B traps condition; throws `PREFLIGHT_CANDIDATE_IDENTICAL_TO_BASELINE` | None | **Pre-Flight Abort**| No-Op Candidate Trapped | Deployment halts before golden backup creation. Live file untouched. |
| **DSP-191**| Argument Quoting | Argument contains embedded quotes and trailing backslash (`"C:\App\\\"`) | `Format-Win32Argument` escapes backslashes; echo harness receives exact string | None | **Parent Pass** | Round-Trip Intact | Child process receives exact string without delimiter truncation. |
| **DSP-192**| Process Tree Cleanup| Child process spawns worker descendant; child hangs exceeding timeout | Parent runner invokes `taskkill /T /F`; parent and descendant killed cleanly | None | **Parent Fatal** | Process Tree Killed | Zero orphaned processes survive. File locks released immediately. |
| **DSP-193**| Stream Exception | Child process stdout pipe broken mid-stream by unexpected process crash | Async reader traps `IOException`; parent treats as fatal tooling crash | None | **Parent Fatal** | Broken Pipe Trapped | Deadlock prevented; parent runner fails build RED fail-closed. |
| **DSP-194**| Reflection Tamper | Reflection script attempts to modify private `initonly` field via `SetValue` | Entrypoint revalidation compares object hashes against physical disk state | `Success=$true` | **Tamper Trapped** | Disk Revalidation Failed | In-memory tampered hash rejected by disk stat; emits Exit Code 1. |
| **DSP-195**| Downstream Guard | Parent runner intercepts Exit Code 104; subsequent migration step queued | Parent runner short-circuits build; migration step skipped cleanly | `Success=$true` | **State 4** | Migrations Blocked | Zero SQL commands executed. PostgreSQL cluster remains baseline. |
| **DSP-196**| Unknown Code Guard | Child process terminates abruptly with native crash code `0xC0000005` | Parent switch default routes to fatal abort; build marked RED | Unknown | **Parent Fatal** | Native Crash Handled | Crash intercepted cleanly; automated retries strictly blocked. |
| **DSP-197**| Ledger Pruning | Nonce ledger file timestamp older than 7 days encountered | Maintenance pruner deletes expired nonce file safely | None | **Pruning Pass** | Expired Nonce Cleaned | Nonce directory maintained within bounded storage limits. |
| **DSP-198**| Clock Skew Boundary| Evidence timestamp is 10 seconds in the future (virtual machine clock jump)| `IsEvidenceFresh()` traps negative age exceeding 5s buffer; rejects evidence | `Success=$true` | **State 5D** | Clock Skew Trapped | Invalid future timestamp rejected; fails closed to Exit Code 1. |

*Note: All 12 specifications above, and all preceding specifications in the suite (`DSP-01` through `DSP-186`), are strictly **[NOT EXECUTED — UNTESTED]**.*

---

## 8. Untested Claims, Residual Risks & Arithmetic Reconciliation

### 8.1 Reconciled 4-Dimensional Engineering Accounting Model

To maintain complete mathematical consistency across structural design metrics, semantic runtime paths, and test suites:

#### Dimension 1: Syntactic AST Structural Decision Points
- **Pre-Flight Replacement Engine (`Invoke-SafeConfigReplacementV22` PF-0 through PF-4B):** **54 decision points**  
  - PF-0: Candidate byte/encoding check (1)  
  - PF-1: Live pre-hash 6-point check (9)  
  - PF-1B: Candidate pre-hash 6-point check & identical-to-baseline check (11)  
  - PF-2: Atomic golden backup creation & collision check (4)  
  - PF-3: Golden backup 6-point check & baseline comparison (9)  
  - PF-4A: Pre-swap candidate 6-point check & pre-flight comparison (11)  
  - PF-4B: Pre-swap live 6-point check & pre-change comparison (9)  
  *(Subtotal PF Engine = $1 + 9 + 11 + 4 + 9 + 11 + 9 = \mathbf{54\text{ decision points}}$)*
- **Replacement Swap & Post-Swap Live Inspection (Stages 2–3 in Replacement Engine):** **17 decision points**
- **Recovery Boundary Non-Mutating Diagnostics (`Enter-ManualRecoveryBoundaryV14`):** **7 decision points**
- **Rollback Dispatcher V34 (`Dispatch-RollbackResultV34`):** **55 decision points**  
- **Total Syntactic AST Decision Points:** $54 + 17 + 7 + 55 = \mathbf{133\text{ decision points}}$ (100% arithmetically consistent).

#### Dimension 2: Semantic Pipeline Outcome Paths
- Pre-Flight Replacement Outcomes: **50 semantic paths**
- Replacement Swap & Post-Swap Live Barrier Outcomes: **19 semantic paths**
- Rollback Engine Internal Return Paths: **55 return paths**
- Recovery Diagnostic Outcomes: **7 diagnostic paths**
- Outer Dispatcher Discard Validation Outcome Paths: **35 distinct paths** (`DISC-01` through `DISC-35`)
- **Total Semantic Pipeline Outcome Paths:** $50 + 19 + 55 + 7 + 35 = \mathbf{166\text{ paths}}$.

#### Dimension 3: Defined Test Specifications
- **Replacement Pre-Flight & Promotion Suite:** `TEST-01` through `TEST-34` (**34 specifications**)
- **Outer-Dispatch Integrity Suite:** `DSP-01` through `DSP-198` (**198 specifications**, expanded from 186)
- **Recovery Diagnostic Suite:** `REC-01` through `REC-07` (**7 specifications**)
- **Total Test Specifications Defined:** $34 + 198 + 7 = \mathbf{239\text{ test specifications}}$.

#### Dimension 4: Executed Operational Tests
- **Executed Operational Tests:** **ZERO (0).**  
  All 239 test specifications across all three suites are strictly marked **`[NOT EXECUTED — UNTESTED]`**.

### 8.2 Untested Claims & Residual Engineering Risks

- **UNTESTED: Windows `taskkill.exe` Permissions under Non-Admin CI/CD Runners:**  
  While `taskkill.exe /PID $proc.Id /T /F` terminates process trees cleanly, executing it requires standard process termination rights. If a CI/CD agent runs under a highly restricted service account without `SeDebugPrivilege` or rights to signal descendant processes, `taskkill` will fail with access denied. Staging verification is required.
- **UNTESTED: Nonce Directory Concurrent Pruning Contention:**  
  If the scheduled maintenance pruner runs concurrently with an active deployment, file locking on `.consumed_nonces` directory entries must be verified to prevent transient I/O exceptions.

---

## 9. Active Blockers & Actions Not Executed

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

### 9.2 Confirmation of Actions Not Executed & Resources Not Modified

- **Operational Procedures & Scripts:** **ZERO (0) EXECUTED.**  
  `Dispatch-RollbackResultV34`, `Invoke-SafeConfigReplacementV22`, `Invoke-DeployPostgresConfigV3`, `Invoke-ParentDeploymentRunnerV3`, `Invoke-ControlledRollbackV15`, `Enter-ManualRecoveryBoundaryV14`, and all 239 test specifications are strictly **`[NOT EXECUTED — UNTESTED]`**.
- **Read-Only Diagnostic Commands:** **ZERO (0)** operational commands executed in this step.  
- **Host & Database Alterations:** **ZERO (0).** No configuration files (`postgresql.conf`, `pg_hba.conf`), Windows Firewall rules, Windows services, application code, or `.env` files were modified. No databases, schemas, tables, roles, or records were created, altered, or dropped.
- **Cloud Connections:** **ZERO (0).** No connections made to Neon, AWS, Supabase, Render, or any remote infrastructure.
- **Budget Preservation:** Strict ₹0/month budget preserved.
- **Preserved Application Databases:** Catalogs `hisecure_erp`, `hitech_platform`, and `zentra_test` remain completely untouched.

---

## 10. Recommended Next Step (Without Executing It)

Upon formal review and approval of this Step AO-AH audit report:
- **Recommended Next Step:** Author the comprehensive **Manual Restoration Protocol Runbook** (`docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md`) to resolve `BLOCKER-1`, incorporating the complete 35-class discard artifact taxonomy, forensic log inspection procedures, nonce ledger verification rules, and Human Incident Commander sign-off runbooks prior to considering Gate 5 authorization.

---

```
STOP — STEP 2D-2A-AO-AH COMPLETE — WAITING FOR HUMAN REVIEW
```
