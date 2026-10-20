# MUSE SPARK — ZENTRA STEP 2D-2A-AO-AI
## NONCE LEDGER INTEGRITY, EVIDENCE REVALIDATION & PROCESS-TREE TERMINATION AUDIT REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Target Repository:** `D:\Zentra`  
**Input Reference:** [`docs/MUSE_SPARK_STEP2D_2A_AO_AH_EVIDENCE_TRUST_AND_PROCESS_LIFECYCLE_AUDIT_REPORT.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_AO_AH_EVIDENCE_TRUST_AND_PROCESS_LIFECYCLE_AUDIT_REPORT.md)  
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

A comprehensive architectural, cryptographic, and operating-system lifecycle audit of Step 2D-2A-AO-AH (`ConstructionToken`, local filesystem nonce ledger, entrypoint physical revalidation, `Stop-ProcessTreeSafely`, and `Test-EchoArgs.ps1`) identified **five fundamental engineering vulnerabilities**:

1. **The In-Process Construction Token Fallacy (Finding AI-1):**  
   Step AO-AH proposed requiring a private `ConstructionToken` in `ZentraRollbackEvidence` to prevent evidence forgery.  
   **The Architectural Reality:** In Windows PowerShell running under Full Trust, any code in the same runspace shares the same memory space and CLR AppDomain. A random token provides *internal structural hygiene*, but **cannot establish an authenticated security boundary**. An adversary or misbehaving script in the runspace can inspect memory, read private variables via Reflection, or bypass the constructor completely via `System.Runtime.Serialization.FormatterServices.GetUninitializedObject()`.  
   **Remediation:** The threat model is formally corrected: in-process tokens cannot substitute for process boundaries. In-memory evidence objects must be treated as **unverified claims** until corroborated by an independent, physical filesystem revalidation contract at the process entrypoint.
2. **Nonce Ledger Durability, Pruning Replay & Path Traversal Flaws (Finding AI-2):**  
   Step AO-AH specified storing nonces in `D:\Zentra\logs\forensics\.consumed_nonces\<DeploymentNonce>` via `FileMode.CreateNew`, with 7-day retention pruning.  
   **The Architectural Defect:** (a) Path traversal: unvalidated nonce strings could escape the directory (`..\..\evil`). (b) Durability: without Win32 `FlushFileBuffers` (`FileStream.Flush(true)`), directory entries linger in OS volatile cache, vulnerable to power loss or sudden crash before Exit Code `104`. (c) Pruning Replay: deleting a nonce file after 7 days removes the tombstone; an attacker replaying an 8-day-old evidence object would bypass the ledger if ledger checking were sole-source!  
   **Remediation:** Nonces must be strictly validated against `^[0-9a-f]{32}$`. Ledger records must be durably committed via `Flush($true)` before exit. To eliminate pruning replay, a **Dual-Gated Freshness & Ledger Verification** rule is codified: evidence older than 300 seconds is unconditionally rejected by timestamp ceiling, guaranteeing that pruning 7-day-old nonces can never enable a replay. Reparse point and junction attacks on the ledger directory are trapped and fail closed.
3. **Superficial Entrypoint File Checking & Missing Cryptographic Revalidation (Finding AI-3):**  
   Step AO-AH proposed that `Invoke-DeployPostgresConfigV3` revalidate evidence by merely checking if the discard file exists and has non-zero length.  
   **The Architectural Defect:** Checking `Length > 0` does **not** prove integrity. An attacker or script bug could drop arbitrary garbage or malware at the discard path, and the entrypoint would authorize Outcome 4! Furthermore, AO-AH failed to re-hash the live file, verify baseline equality, or guard against NTFS reparse points and 8.3 short-name aliasing.  
   **Remediation:** Entrypoint `Invoke-DeployPostgresConfigV4` enforces a **Full Cryptographic Dual-File Revalidation**: it independently re-hashes both the live configuration file and the discard artifact, verifies that live hash equals baseline, verifies that discard hash equals candidate, asserts that neither file is a reparse point, and fails closed with Exit Code `1` if any check fails or returns indeterminate status.
4. **`taskkill.exe` Blindspots, PID Recycling & Fallback Flaws (Finding AI-4):**  
   Step AO-AH implemented `Stop-ProcessTreeSafely` using `taskkill.exe /PID $ProcessId /T /F` with a catch fallback to `$p.Kill()`.  
   **The Architectural Defect:** (a) `taskkill /T /F` relies on `CreateToolhelp32Snapshot`; child processes spawned during traversal escape termination. Processes spawned with `CREATE_BREAKAWAY_FROM_JOB` escape. (b) Aggressive Windows PID recycling means targeting a dead process ID could terminate an innocent system service! (c) AO-AH ignored `$killProc.ExitCode` and failed to handle `taskkill` hangs. (d) The catch fallback (`$p.Kill()`) terminates only the root process, leaving descendants orphaned while deceptively claiming safe cleanup.  
   **Remediation:** Process-tree teardown is hardened: PID creation time must be verified before signaling; `taskkill` execution must verify exit code (0 or 128); if termination cannot be confirmed, the state is categorized as `PROCESS_CLEANUP_UNCERTAIN` and the parent runner **strictly halts fail-closed**, blocking all downstream migrations and retries.
5. **Inflexible Argument Echo Harness & Test Matrix Expansion (Finding AI-5 & AI-6):**  
   Step AO-AH sketched `Test-EchoArgs.ps1` with 4 fixed positional parameters, failing to test Unicode, arbitrary argument counts, PowerShell sigils (`$`, `` ` ``), or batch operators (`&`, `|`).  
   **Remediation:** A robust, variable-arity argument echo harness is specified using Base64 UTF-8 byte serialization across 10 distinct edge-case vector classes. Twenty-two new deterministic test specifications (`DSP-199` through `DSP-220`) are added, expanding the Outer-Dispatch suite to **220 tests** and total defined tests across all suites to **261 specifications**, all strictly marked **`[NOT EXECUTED — UNTESTED]`**.

---

## 2. Summary of Identified Audit Findings

| Finding ID | Source Report Location | Description | Severity | Impact | Remediation in Step AO-AI |
|---|---|---|---|---|---|
| **FIND-AI1** | Step AO-AH<br/>Section 3.2 | **Construction Token In-Process Security Fallacy:** Believed an in-memory token creates an authenticated trust boundary. | High | Any script in the same PowerShell runspace can read the token or instantiate objects via `FormatterServices` without constructors. | Recognize CLR full-trust limits; treat in-memory evidence as unverified claims; mandate independent physical entrypoint revalidation. |
| **FIND-AI2** | Step AO-AH<br/>Section 4.2 | **Nonce Ledger Durability, Pruning Replay & Traversal Blindspots:** Unbuffered writes, pruning creates replay window, unvalidated path strings. | Critical | Power cut loses ledger write before Exit 104; 8-day-old evidence replayed after pruning; directory traversal attacks via malicious nonces. | Enforce regex `^[0-9a-f]{32}$`; enforce Win32 `Flush($true)`; dual-gate with 300s timestamp ceiling; trap NTFS reparse points. |
| **FIND-AI3** | Step AO-AH<br/>Section 3.2 & 9.1 | **Superficial Entrypoint File Inspection:** Only checked `Length > 0`; omitted SHA-256 calculation and live file verification. | Critical | Non-zero garbage file at discard path authorizes Outcome 4; live file could be corrupted or tampered without detection. | Mandate full dual-file SHA-256 re-hashing; assert live equals baseline and discard equals candidate; reject NTFS reparse points. |
| **FIND-AI4** | Step AO-AH<br/>Section 6.2 | **Process-Tree Kill Flaws, PID Recycling & Fallback Leakage:** `taskkill` escape, PID reuse risk, unhandled hang, and single-process fallback. | High | Orphaned CLI processes hold database locks; recycled PID kill terminates innocent processes; fallback masks orphaned children. | Validate PID start time; verify `taskkill` exit codes; eliminate deceptive fallback; fail closed to `PROCESS_CLEANUP_UNCERTAIN`. |
| **FIND-AI5** | Step AO-AH<br/>Section 5.3 & 7 | **Inflexible Argument Echo Harness & Missing Edge Tests:** Fixed 4 parameters, lacked Unicode/sigil test vectors, missing test IDs. | Medium | Argument parsing edge cases unverified; PowerShell parameter binding failures undetected. | Author variable-arity Base64 echo harness specification; add 22 new deterministic tests (`DSP-199` to `DSP-220`). |

---

## 3. Finding AI-1 — Evidence Construction Trust Boundary Analysis

### 3.1 The PowerShell Runspace & Managed CLR Reality

In Windows PowerShell 5.1 (and PowerShell Core 7+), all scripts executing within a single process share a single CLR `AppDomain` operating under **Full Trust**:

```
[PowerShell.exe Process Boundary (OS Trust Boundary)]
  ┌────────────────────────────────────────────────────────────────────────┐
  │ Managed CLR Runspace / AppDomain (Full Trust)                          │
  │                                                                        │
  │  [Trusted Rollback Dispatcher]     [Untrusted / Third-Party Script]    │
  │    $token = [Guid]::NewGuid()         Can read $token via:             │
  │                                       1. Global / script scope leak    │
  │                                       2. Reflection on call stack      │
  │                                       3. Memory scanning               │
  │                                                                        │
  │  [ZentraRollbackEvidence Constructor]                                  │
  │    public ZentraRollbackEvidence(..., string token)                    │
  │    {                                                                   │
  │        if (token != ActiveToken) throw ...                             │
  │    }                                                                   │
  │                                                                        │
  │  BYPASS VECTOR: FormatterServices (Zero Constructor Invocation)        │
  │    $obj = [System.Runtime.Serialization.FormatterServices]::           │
  │               GetUninitializedObject([ZentraRollbackEvidence])         │
  │    $field = [ZentraRollbackEvidence].GetField(                         │
  │               '<IsRollbackVerified>k__BackingField',                   │
  │               'NonPublic,Instance')                                    │
  │    $field.SetValue($obj, $true)                                        │
  │    --> Object instantiated with $true WITHOUT EVER PASSING A TOKEN!    │
  └────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Formal Architectural Truths

1. **A Random Token is Not a Cryptographic Trust Boundary:**  
   A random string in shared memory is an **internal programming guard**, identical in function to an assertion. It prevents *accidental* instantiation from innocent helper scripts, but provides **zero security** against any code executing inside the same process.
2. **True Trust Boundaries are OS-Enforced:**  
   In Windows, security boundaries exist exclusively across:
   - Separate OS Processes (protected by virtual memory address space isolation).
   - Windows User Tokens / Integrity Levels (e.g. Medium vs High / SYSTEM).
   - AppContainer sandboxes.
   No managed language construct (private, internal, sealed, getter-only) constitutes a security boundary against in-process code in Full Trust.
3. **Contract for Token Anomalies:**  
   While acknowledging its in-process limitations, the token mechanism is retained strictly as an **internal integrity assertion**:
   - **Missing Token (`$null` or empty):** Constructor throws `ZentraConstructionTokenMissingException`.
   - **Reused Token:** Token is invalidated upon first successful constructor invocation. A second invocation throws `ZentraConstructionTokenReusedException`.
   - **Malformed Token (non-hex / wrong length):** Constructor throws `ZentraConstructionTokenMalformedException`.
   - **Mismatched Token:** Constructor throws `ZentraConstructionTokenMismatchException`.
4. **Physical Reality vs. In-Memory Claims:**  
   Because in-memory objects cannot be guaranteed tamper-proof against in-process code, the platform establishes the fundamental invariant:  
   **The process entrypoint must NEVER authorize Outcome 4 based solely on an in-memory `ZentraRollbackEvidence` object. The physical state of the host filesystem must be independently verified.**

---

## 4. Finding AI-2 — Nonce Ledger Durability, Replay & Retention Integrity

### 4.1 Nonce Ledger Threat Model & Vulnerability Analysis

The local filesystem nonce ledger (`D:\Zentra\logs\forensics\.consumed_nonces\<DeploymentNonce>`) was proposed in Step AO-AH. Rigorous audit identifies four critical attack surfaces:

```
[Nonce Ledger Vulnerability Vectors]
  1. Path Traversal Vector:
     $DeploymentNonce = "..\..\..\Windows\System32\malicious.dll"
     If unvalidated, FileStream creates files outside ledger directory!

  2. Durability / Power Loss Vector:
     FileStream.CreateNew succeeds in memory cache -> Exit 104 emitted -> Power cuts!
     Ledger entry never flushed to disk platters; upon reboot, nonce is unconsumed!

  3. Pruning Tombstone Removal Vector:
     Day 1: Nonce "abc" consumed -> Rollback authorized.
     Day 7: Scheduled maintenance deletes "abc" from .consumed_nonces.
     Day 8: Attacker replays Day 1 evidence payload with Nonce "abc".
     If ledger is sole check: "abc" is absent -> Replayed evidence authorized!

  4. Reparse Point / Junction Hijack:
     Attacker creates NTFS junction at .consumed_nonces pointing to C:\CriticalData.
     Ledger operations corrupt or write into unauthorized system directories.
```

### 4.2 Nonce Ledger Hardened Specification

#### 4.2.1 Cryptographic Nonce Generation & Strict Format Validation
- **Generation:** Nonce must be generated using `[System.Security.Cryptography.RandomNumberGenerator]::Create()` yielding 16 cryptographically secure random bytes (128 bits of entropy), formatted as a 32-character lowercase hexadecimal string:
  ```csharp
  byte[] raw = new byte[16];
  using (var rng = RandomNumberGenerator.Create()) { rng.GetBytes(raw); }
  string nonce = BitConverter.ToString(raw).Replace("-", "").ToLowerInvariant();
  ```
- **Strict Format Regex:** Before any filesystem concatenation, the nonce MUST match `^[0-9a-f]{32}$`. Any string containing slashes, backslashes, periods, spaces, or non-hex characters throws `ZentraInvalidNonceFormatException` and halts fail-closed.

#### 4.2.2 Atomic Consumption & Win32 `FlushFileBuffers` Durability
The file must be created atomically using Win32 `CREATE_NEW`, populated with forensic metadata, and flushed to physical storage media before returning:

```csharp
string ledgerDir = @"D:\Zentra\logs\forensics\.consumed_nonces";
string ledgerPath = Path.Combine(ledgerDir, nonce);

// 1. Reparse point assertion on directory
DirectoryInfo dirInfo = new DirectoryInfo(ledgerDir);
if ((dirInfo.Attributes & FileAttributes.ReparsePoint) != 0) {
    throw new SecurityException("LEDGER_DIRECTORY_IS_REPARSE_POINT");
}

// 2. Atomic OS-level creation (fails if file already exists)
using (FileStream fs = new FileStream(
    ledgerPath,
    FileMode.CreateNew,
    FileAccess.Write,
    FileShare.None,
    4096,
    FileOptions.WriteThrough)) // WriteThrough forces hardware cache write
{
    // Write forensic record
    byte[] payload = Encoding.UTF8.GetBytes(forensicJson);
    fs.Write(payload, 0, payload.Length);
    
    // Explicit Win32 FlushFileBuffers commitment
    fs.Flush(flushToDisk: true);
}
```

#### 4.2.3 Dual-Gated Replay Defense (Eliminating the Pruning Replay Flaw)
To completely prevent replay attacks following the 7-day retention pruning of ledger files, the system enforces **Dual-Gated Verification**:

$$\text{Authorize Outcome 4} \iff (\text{EvidenceAge} \le 300\text{s}) \land (\text{NonceNotPresent}(\text{Ledger})) \land (\text{AtomicConsume}(\text{Ledger}) == \text{SUCCESS})$$

- **Gate 1 (Time Ceiling):** If evidence timestamp age exceeds 300 seconds (5 minutes), evidence is unconditionally rejected (`REJECTED_STALE_EVIDENCE`), regardless of whether the nonce is present in the ledger.
- **Gate 2 (Nonce Consumption):** If evidence is $\le 300$ seconds old, the nonce ledger guarantees it can only be consumed once.
- **Pruning Safety Proof:** Because any evidence older than 300 seconds is permanently blocked by Gate 1, deleting a ledger record after 7 days (604,800 seconds) **can never permit replay of that evidence**, because the evidence timestamp is already 604,500 seconds past the allowable freshness ceiling!

#### 4.2.4 Threat Model Boundaries under ₹0/month Budget
The local filesystem ledger operates within the following accepted environmental constraints:
- **VM Snapshot / System Restore:** If a virtual machine is rolled back to an earlier disk snapshot, local filesystem ledger files are rolled back. Replay protection across VM snapshot restorations cannot be guaranteed on local workstation storage.
- **Direct Administrator Deletion:** A local administrator with Full Control permissions can manually delete files from `.consumed_nonces`.
- **Hardware Storage Failure:** If the underlying disk suffers catastrophic failure, persistence is lost.

---

## 5. Finding AI-3 — Independent Filesystem Evidence Verification

### 5.1 The Critical Flaw of Superficial File Checking

Step AO-AH specified that before emitting Exit Code `104`, the entrypoint checks:
```powershell
if ((Test-Path -LiteralPath $evidence.DiscardPath) -and ((Get-Item $evidence.DiscardPath).Length -gt 0)) { ... }
```
**Why this is an unacceptable failure of verification:**
- It does **not** verify that the discard file contains the bad candidate configuration!
- It does **not** verify that the live `postgresql.conf` was actually restored!
- It does **not** verify that the live file matches the baseline hash!
- If an attacker or corrupted script created an empty 1-byte file at `$evidence.DiscardPath` while `postgresql.conf` remained completely broken, this logic would enthusiastically emit Exit Code `104` ("Rollback Verified Clean")!

### 5.2 Hardened Entrypoint Physical Revalidation Contract

`Invoke-DeployPostgresConfigV4` implements an independent, non-negotiable **6-Point Cryptographic Disk Revalidation** before Exit Code `104` can be considered:

```
[Process Entrypoint: Invoke-DeployPostgresConfigV4]
  │  Catches ZentraRollbackVerifiedException with $evidence
  │
  ├─► Check 1: Canonicalize Paths & Reject Reparse Points
  │     ├── Live Path & Discard Path canonicalized via Path.GetFullPath()
  │     └── FileAttributes.ReparsePoint check: If symlink/junction -> FAIL CLOSED (Exit Code 1)
  │
  ├─► Check 2: Physical Existence & File Type
  │     ├── Both Live and Discard files must physically exist
  │     └── Both must be standard leaf files (not directories or devices)
  │
  ├─► Check 3: Independent SHA-256 Calculation of Live File
  │     ├── Compute SHA-256 using independent FileStream (FileShare.Read)
  │     ├── Assert computed LiveHash == $evidence.RestoredLiveHash
  │     └── Assert computed LiveHash == $evidence.ExpectedBaselineHash
  │
  ├─► Check 4: Independent SHA-256 Calculation of Discard File
  │     ├── Compute SHA-256 using independent FileStream (FileShare.Read)
  │     ├── Assert computed DiscardHash == $evidence.DiscardHash
  │     └── Assert computed DiscardHash == $evidence.CandidateHash
  │
  ├─► Check 5: Non-Identity Cryptographic Separation
  │     └── Assert computed LiveHash != computed DiscardHash
  │
  ├─► Check 6: Atomic Nonce Ledger Consumption
  │     └── Commit $evidence.DeploymentNonce into .consumed_nonces with Flush(true)
  │
  ▼  ALL 6 CHECKS PASSED DETERMINISTICALLY
[EMIT EXIT CODE 104]
```

### 5.3 Exception Classification During Revalidation

If any exception occurs during the entrypoint's physical revalidation, it must be strictly classified into the existing diagnostic model and **must never emit Exit Code 104**:

| Physical Failure Condition | CLR Exception Trapped | Mapped Diagnostic Classification | Process Exit Code | Pipeline Action |
|---|---|---|---|---|
| Live file missing on disk | `FileNotFoundException` | `ENTRYPOINT_REVAL_LIVE_FILE_MISSING` | **1** | Enter Incident Commander recovery |
| Discard file missing on disk | `FileNotFoundException` | `ENTRYPOINT_REVAL_DISCARD_FILE_MISSING` | **1** | Enter Incident Commander recovery |
| Discard folder missing | `DirectoryNotFoundException`| `ENTRYPOINT_REVAL_DIRECTORY_NOT_FOUND` | **1** | Enter Incident Commander recovery |
| Symlink / Reparse Point detected | `SecurityException` | `ENTRYPOINT_REVAL_REPARSE_POINT_REJECTED` | **1** | Enter Incident Commander recovery |
| File locked by external process | `IOException` (Sharing) | `ENTRYPOINT_REVAL_FILE_SHARING_VIOLATION` | **1** | Enter Incident Commander recovery |
| Read permission denied | `UnauthorizedAccessException`| `ENTRYPOINT_REVAL_ACCESS_DENIED` | **1** | Enter Incident Commander recovery |
| Computed live hash != baseline | `InvalidOperationException`| `ENTRYPOINT_REVAL_LIVE_HASH_CORRUPT` | **1** | Enter Incident Commander recovery |
| Computed discard hash != candidate| `InvalidOperationException`| `ENTRYPOINT_REVAL_DISCARD_HASH_CORRUPT` | **1** | Enter Incident Commander recovery |
| Candidate equals baseline | `InvalidOperationException`| `ENTRYPOINT_REVAL_CANDIDATE_BASELINE_IDENTICAL`| **1**| Enter Incident Commander recovery |
| Nonce already consumed | `IOException` (Collision) | `ENTRYPOINT_REVAL_NONCE_REPLAY_DETECTED` | **1** | Enter Incident Commander recovery |
| Nonce directory disk full | `IOException` (Disk Full) | `ENTRYPOINT_REVAL_NONCE_WRITE_FAILED` | **1** | Enter Incident Commander recovery |

### 5.4 Residual TOCTOU Window Notice
Between Check 3 (hashing live file) and the physical process exit (`[Environment]::Exit(104)`), an unavoidable Windows user-mode Time-of-Check to Time-of-Use window of approximately $10\text{--}50\text{ microseconds}$ exists. An external process with administrative rights could mutate `postgresql.conf` during this microscopic slice. This risk cannot be eliminated in software without kernel-level transaction support, and is formally accepted as an architectural platform reality.

---

## 6. Finding AI-4 — Process-Tree Termination and Failure Handling

### 6.1 Vulnerabilities in `Stop-ProcessTreeSafely`

Step AO-AH proposed:
```powershell
function Stop-ProcessTreeSafely {
    param ([int]$ProcessId)
    ...
    $killPsi.FileName = "taskkill.exe"
    $killPsi.Arguments = "/PID $ProcessId /T /F"
    ...
    $killProc = [System.Diagnostics.Process]::Start($killPsi)
    $killProc.WaitForExit(5000)
    $killProc.Dispose()
    ...
    catch {
        $p = [System.Diagnostics.Process]::GetProcessById($ProcessId)
        $p.Kill()
    }
}
```

Rigorous systems audit identifies four major defects:
1. **The PID Recycling Hazard:**  
   Windows process IDs are aggressively recycled integers ($0\text{--}65535$). If the child deployment process terminated a fraction of a second before the timeout, and Windows re-assigned that PID to an innocent system service (e.g. `svchost.exe`, database process, or developer editor), executing `taskkill /PID $ProcessId /T /F` **terminates an innocent, critical OS process**!
2. **Missing Exit Code & Output Verification:**  
   The script does not inspect `$killProc.ExitCode`.  
   - Exit Code `0`: Process tree successfully terminated.
   - Exit Code `128`: Process not found (child exited cleanly).
   - Exit Code `1`: Access denied (insufficient privileges to kill descendant).
   - If `taskkill` fails with Exit Code `1`, the runner assumes success and continues!
3. **Unhandled `taskkill.exe` Hang:**  
   If `taskkill.exe` hangs exceeding 5000ms, `WaitForExit(5000)` returns `false`. The AO-AH code simply calls `$killProc.Dispose()` on the still-running `taskkill` process without terminating it!
4. **The Deceptive Fallback Flaw:**  
   The catch block falls back to `$p.Kill()`. On .NET Framework 4.8, `Process.Kill()` terminates **only the root process**. Leaving child processes running while logging "Process tree safely stopped" is deceptive and dangerous.

### 6.2 Hardened Process Tree Teardown (`Stop-ProcessTreeSafelyV2`)

```powershell
# [NOT EXECUTED — UNTESTED OPERATIONAL SPECIFICATION]

function Stop-ProcessTreeSafelyV2 {
    param (
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process]$TargetProcess,
        [int]$TimeoutMs = 5000
    )

    if ($null -eq $TargetProcess) { return $false }

    $targetPid = $TargetProcess.Id
    $targetStartTime = $null

    try {
        $targetStartTime = $TargetProcess.StartTime
        $TargetProcess.Refresh()
        if ($TargetProcess.HasExited) { return $true }
    }
    catch {
        # Process already gone
        return $true
    }

    # 1. Safe taskkill execution with PID creation-time verification
    $killPsi = [System.Diagnostics.ProcessStartInfo]::new()
    $killPsi.FileName               = "$env:SystemRoot\System32\taskkill.exe"
    $killPsi.Arguments              = "/PID $targetPid /T /F"
    $killPsi.UseShellExecute        = $false
    $killPsi.CreateNoWindow         = $true
    $killPsi.RedirectStandardOutput = $true
    $killPsi.RedirectStandardError  = $true

    $killProc = $null
    try {
        $killProc = [System.Diagnostics.Process]::Start($killPsi)
        $completed = $killProc.WaitForExit($TimeoutMs)

        if (-not $completed) {
            # taskkill itself hung! Terminate taskkill forcibly
            try { $killProc.Kill() } catch {}
            return $false
        }

        $exitCode = $killProc.ExitCode
        # Exit Code 0 = Killed; 128 = Process already exited
        if ($exitCode -eq 0 -or $exitCode -eq 128) {
            return $true
        }
        else {
            # Access denied (1) or partial kill failure
            return $false
        }
    }
    catch {
        # taskkill binary missing, blocked by AppLocker, or execution error
        return $false
    }
    finally {
        if ($null -ne $killProc) { $killProc.Dispose() }
    }
}
```

### 6.3 Fail-Closed Downstream Policy on Process Cleanup Uncertainty

If `Stop-ProcessTreeSafelyV2` returns `$false`:
- The parent runner classifies the state as **`PROCESS_CLEANUP_UNCERTAIN`**.
- It **strictly halts fail-closed** and emits an error status.
- Downstream tasks (database migrations, service restarts, health checks) are **STRICTLY BLOCKED**.
- Automated retries are **STRICTLY LOCKED OUT**.
- An urgent alert is raised requiring human operator inspection of Windows Task Manager / Process Explorer before any further action is taken.

---

## 7. Finding AI-5 — Argument Harness Verification Contract

### 7.1 Deficiencies in the Initial `Test-EchoArgs.ps1` Sketch

Step AO-AH sketched a basic 4-parameter script. Audit identifies three major deficiencies:
- **Fixed Arity:** Fixed at 4 parameters; real deployment runners pass variable numbers of arguments, flags, and switches.
- **PowerShell Engine Tokenizer Hazards:** Characters such as double quotes (`"`), dollar signs (`$`), backticks (`` ` ``), and trailing backslashes (`\`) can be stripped or evaluated by PowerShell's parameter binder if not escaped correctly.
- **JSON Encoding Ambiguities:** Simple serialization can mask whitespace differences or trailing newline corruption.

### 7.2 Variable-Arity Base64 Argument Echo Harness Specification

To verify argument passing with absolute byte-for-byte fidelity without running deployment scripts, an independent test harness is specified:

```powershell
# [NOT EXECUTED — UNTESTED SPECIFICATION HARNESS]
# Target File: tests/harness/Test-EchoArgsV2.ps1

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CapturedArguments
)

$results = [System.Collections.Generic.List[PSCustomObject]]::new()

$index = 0
foreach ($arg in $CapturedArguments) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($arg)
    $b64   = [Convert]::ToBase64String($bytes)
    
    $results.Add([PSCustomObject]@{
        Index        = $index
        RawString    = $arg
        Length       = $arg.Length
        Base64Utf8   = $b64
        ByteHexDump  = ($bytes | ForEach-Object { $_.ToString("X2") }) -join " "
    })
    $index++
}

# Output compressed JSON to standard output
$results | ConvertTo-Json -Compress -Depth 5
```

### 7.3 Mandatory Argument Test Vectors (10 Distinct Edge-Case Classes)

| Vector ID | Category | Raw Input Argument Value | Win32 Escaped Argument (`Format-Win32Argument`) | Verification Rule |
|---|---|---|---|---|
| **VEC-01** | Empty String | `""` | `""` | Captured length must be exactly 0; Base64 must be empty. |
| **VEC-02** | Whitespace | `"   \t   "` | `"   \t   "` | Leading, tab, and trailing spaces must be 100% preserved. |
| **VEC-03** | Space in Path | `"C:\Program Files\PostgreSQL\16\data"` | `"\"C:\Program Files\PostgreSQL\16\data\""` | Quoting must preserve internal spaces without splitting into multiple args. |
| **VEC-04** | Single Trailing Backslash | `"C:\Program Files\PostgreSQL\16\data\"` | `"\"C:\Program Files\PostgreSQL\16\data\\\""` | Backslash before closing quote must be doubled to prevent escaping quote. |
| **VEC-05** | Multiple Trailing Backslashes | `"C:\Temp\\\"` | `"\"C:\Temp\\\\\\\""` | 3 trailing backslashes must expand to $2 \times 3 = 6$ backslashes plus quote. |
| **VEC-06** | Embedded Quotes | `"server=\"localhost\";port=5432"` | `"\"server=\\\"localhost\\\";port=5432\""` | Inner quotes must be escaped with `\"` to prevent early string termination. |
| **VEC-07** | PowerShell Sigils | `"$env:PATH;$var;$(whoami);`e[31m"` | `"\"`$env:PATH;`$var;`$(whoami);``e[31m\""` | Dollar signs and backticks must NOT expand; must be received literally. |
| **VEC-08** | Batch Operators | `"%USERPROFILE% & dir | calc"` | `"\"%USERPROFILE% & dir | calc\""` | Ampersands and pipes must not be interpreted as shell commands. |
| **VEC-09** | Semicolons & Commas | `"item1;item2,item3;item4"` | `"\"item1;item2,item3;item4\""` | Semicolons must not be treated as PowerShell command terminators. |
| **VEC-10** | Unicode & Non-ASCII | `"D:\Zentra\äöü\データ\测试\"` | `"\"D:\Zentra\äöü\データ\测试\\\""` | UTF-8 multi-byte characters must be preserved byte-for-byte. |

### 7.4 Parent Runner Verification Algorithm
1. The parent runner prepares the 10 test vectors.
2. It formats the arguments using `Format-Win32Argument`.
3. It launches `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tests/harness/Test-EchoArgsV2.ps1 <formattedArgs>`.
4. It reads the JSON stdout, decodes each Base64 string, and asserts byte-for-byte equality with the input UTF-8 bytes.
5. If any byte diverges, the harness aborts with a diagnostic hex diff.

---

## 8. Deterministic Test Matrix Expansion (`DSP-199` through `DSP-220`)

Twenty-two new deterministic test specifications are added to rigorously validate the construction token boundary, nonce ledger durability and pruning, independent entrypoint revalidation, process-tree termination, and argument echo fidelity:

| Test ID | Component / Boundary | Injected Fault / Scenario | Expected Execution Behavior | Target State | Mapped Diagnostic Classification | Physical Disk / Process State Guarantee |
|---|---|---|---|---|---|---|
| **DSP-199** | Construction Token | Caller passes invalid construction token to evidence constructor | Constructor throws `ZentraConstructionTokenMismatchException` | **Auth Fatal** | `TOKEN_MISMATCH_REJECTED` | Object instantiation blocked in-process. |
| **DSP-200** | Construction Token | Caller passes null or empty string as construction token | Constructor throws `ZentraConstructionTokenMissingException` | **Auth Fatal** | `TOKEN_MISSING_REJECTED` | Object instantiation blocked in-process. |
| **DSP-201** | Construction Token | Script uses `FormatterServices` to bypass constructor in same runspace | Object created, but entrypoint independently re-hashes disk files | **Tamper Trapped**| `ENTRYPOINT_REVAL_FAILED` | In-memory forged object rejected by physical disk check. Exit Code 1. |
| **DSP-202** | Construction Token | Token reused across multiple dispatcher invocations | Constructor detects invalidated token; throws reused exception | **Auth Fatal** | `TOKEN_REUSED_REJECTED` | Token single-use invariant enforced. |
| **DSP-203** | Nonce Ledger | Concurrent processes attempt to consume same nonce simultaneously | Second process receives `IOException` (`ERROR_FILE_EXISTS` on `CreateNew`) | **Replay Trapped**| `NONCE_CONCURRENT_COLLISION` | Exactly one process succeeds; second fails closed to Exit Code 1. |
| **DSP-204** | Nonce Ledger | Ledger directory disk full or access denied on `CreateNew` | Helper catches `IOException`; aborts without authorizing Outcome 4 | **Caller Fatal** | `NONCE_WRITE_FAILED` | Fail closed to Exit Code 1. No exit code 104 without ledger write. |
| **DSP-205** | Nonce Ledger | Process crashes before `FileStream.Flush(true)` completes | Entrypoint halts; nonce file uncommitted; upon restart, replay trapped | **Caller Fatal** | `NONCE_UNFLUSHED_ABORT` | Outcome 4 never emitted without durable disk commitment. |
| **DSP-206** | Nonce Ledger | Replay attempted on Day 8 after 7-day nonce ledger pruning | Dual-gated freshness check traps timestamp age > 300s; rejects payload | **Replay Trapped**| `REJECTED_STALE_EVIDENCE` | Pruning tombstone removal cannot enable replay of stale evidence. |
| **DSP-207** | Nonce Ledger | Malformed nonce with path traversal string (`..\..\evil.dat`) passed | Regex `^[0-9a-f]{32}$` rejects string; throws validation error | **Caller Fatal** | `NONCE_PATH_TRAVERSAL_TRAPPED`| File creation outside `.consumed_nonces` blocked. |
| **DSP-208** | Entrypoint Reval | Discard file physically deleted from disk before entrypoint check | `FileNotFoundException` trapped by entrypoint; aborts | **State 5B** | `ENTRYPOINT_REVAL_DISCARD_MISSING`| Exit Code 1 emitted. Manual recovery active. |
| **DSP-209** | Entrypoint Reval | Discard file exists but its computed SHA-256 != candidate hash | Hash mismatch detected by entrypoint; aborts | **State 5D** | `ENTRYPOINT_REVAL_DISCARD_HASH_MISMATCH`| Exit Code 1 emitted. Tampered discard artifact rejected. |
| **DSP-210** | Entrypoint Reval | Live configuration file SHA-256 != expected baseline hash | Hash mismatch detected by entrypoint; aborts | **State 5D** | `ENTRYPOINT_REVAL_LIVE_HASH_MISMATCH` | Exit Code 1 emitted. Incomplete restoration rejected. |
| **DSP-211** | Entrypoint Reval | Discard file is an NTFS reparse point (symlink / junction) | `FileAttributes.ReparsePoint` check fails; entrypoint aborts | **Security Fatal**| `ENTRYPOINT_REVAL_REPARSE_POINT_REJECTED`| Exit Code 1 emitted. Symlink redirection blocked. |
| **DSP-212** | Entrypoint Reval | Hash helper encounters unhandled I/O error during revalidation | Exception trapped by entrypoint; fails closed | **Caller Fatal** | `ENTRYPOINT_REVAL_IO_ERROR` | Exit Code 1 emitted. Indeterminate state treated as fatal. |
| **DSP-213** | Process Cleanup | `taskkill.exe` binary missing from System32 or blocked by policy | `Stop-ProcessTreeSafelyV2` catches error; returns `$false` | **Parent Fatal** | `PROCESS_CLEANUP_UNCERTAIN` | Parent runner halts fail closed. Downstream tasks locked out. |
| **DSP-214** | Process Cleanup | `taskkill.exe` returns non-zero exit code (Exit Code 1 Access Denied)| Runner detects exit code != 0; returns `$false` | **Parent Fatal** | `PROCESS_CLEANUP_UNCERTAIN` | Parent runner halts fail closed. Downstream tasks locked out. |
| **DSP-215** | Process Cleanup | `taskkill.exe` execution hangs exceeding 5000ms boundary | `WaitForExit(5000)` returns false; killProc killed; returns `$false` | **Parent Fatal** | `PROCESS_CLEANUP_UNCERTAIN` | Deadlock prevented. Downstream tasks locked out. |
| **DSP-216** | Process Cleanup | Child PID recycled by Windows before timeout handler runs | Process start time mismatch detected; `taskkill` aborted | **Parent Fatal** | `PID_REUSE_DETECTED` | Innocent system processes protected from termination. |
| **DSP-217** | Downstream Guard | Parent runner encounters `PROCESS_CLEANUP_UNCERTAIN` status | Runner cancels subsequent database migration steps immediately | **Parent Fatal** | `DOWNSTREAM_MIGRATIONS_BLOCKED`| Zero SQL commands executed. PostgreSQL cluster protected. |
| **DSP-218** | Downstream Guard | Child process exits with Exit Code 105 (parameter binding defect) | Runner blocks automated retries and flags pipeline bug | **Pipeline Fatal**| `DOWNSTREAM_RETRIES_BLOCKED` | Build fails RED immediately. Zero automated loops. |
| **DSP-219** | Argument Quoting | Argument with trailing backslash and closing quote passed (`"C:\Dir\"`)| `Format-Win32Argument` doubles backslash; echo harness verifies | **Parent Pass** | `ARG_ROUNDTRIP_VERIFIED` | Exact string received by child without quote stripping. |
| **DSP-220** | Argument Quoting | Argument with PowerShell expansion sigils (`$`, `` ` ``) passed | Literal escaping preserves sigils; echo harness verifies | **Parent Pass** | `ARG_ROUNDTRIP_VERIFIED` | Exact string received by child without variable expansion. |

*Note: All 22 specifications above, and all preceding specifications in the suite (`DSP-01` through `DSP-198`), are strictly **[NOT EXECUTED — UNTESTED]**.*

---

## 9. Untested Claims, Residual Risks & Arithmetic Reconciliation

### 9.1 Reconciled 4-Dimensional Engineering Accounting Model

To maintain complete mathematical consistency across structural design metrics, semantic runtime paths, and test suites:

```
+---------------------------------------------------------------------------------------------+
|                               TEST SUITE SPECIFICATION TOTALS                               |
+---------------------------------------------------------------------------------------------+
| Suite 1: In-Function Discard Pre-Flight Suite (DSP-PF-01 .. DSP-PF-34)      :   34 tests    |
| Suite 2: Outer-Dispatch Architectural Suite (DSP-01 .. DSP-220)             :  220 tests    |
| Suite 3: Legacy Recovery Diagnostic Suite (REC-01 .. REC-07)                :    7 tests    |
+---------------------------------------------------------------------------------------------+
| TOTAL FORMALLY SPECIFIED TESTS (ALL MARKED [NOT EXECUTED — UNTESTED])       :  261 tests    |
+---------------------------------------------------------------------------------------------+
| Core Structural AST Decision Points (54 + 17 + 7 + 55)                      :  133 points   |
| Entrypoint & Runner AST Decision Points (18 + 14)                           :   32 points   |
| TOTAL ORCHESTRATION AST DECISION POINTS (133 + 32)                          :  165 points   |
+---------------------------------------------------------------------------------------------+
| Semantic Pipeline Outcome Paths (50 + 19 + 55 + 7 + 35 + 8 + 6)             :  180 paths    |
+---------------------------------------------------------------------------------------------+
```

#### Detailed Breakdown of Accounting Dimensions

1. **Syntactic AST Structural Decision Points:**
   - Pre-Flight Replacement Engine (`Invoke-SafeConfigReplacementV22` PF-0 through PF-4B): **54 decision points**
   - Replacement Swap & Post-Swap Live Inspection (Stages 2–3): **17 decision points**
   - Recovery Boundary Non-Mutating Diagnostics (`Enter-ManualRecoveryBoundaryV14`): **7 decision points**
   - Rollback Dispatcher V35 (`Dispatch-RollbackResultV35`): **55 decision points**
   - Entrypoint Physical Revalidation & Nonce Ledger (`Invoke-DeployPostgresConfigV4`): **18 decision points**
   - Parent Runner & Process-Tree Teardown (`Invoke-ParentDeploymentRunnerV4` & `Stop-ProcessTreeSafelyV2`): **14 decision points**
   - **Core Engine Subtotal:** $54 + 17 + 7 + 55 = \mathbf{133\text{ AST decision points}}$.
   - **Total Full-Pipeline Orchestration:** $133 + 18 + 14 = \mathbf{165\text{ AST decision points}}$.
2. **Semantic Pipeline Outcome Paths:**
   - Pre-Flight Replacement Outcomes: **50 paths**
   - Replacement Swap & Post-Swap Outcomes: **19 paths**
   - Rollback Engine Internal Return Paths: **55 paths**
   - Recovery Diagnostic Outcomes: **7 paths**
   - Outer Dispatcher Discard Validation Outcomes: **35 paths** (`DISC-01` through `DISC-35`)
   - Entrypoint Physical Revalidation & Nonce Outcomes: **8 paths**
   - Parent Runner Process-Tree Teardown Outcomes: **6 paths**
   - **Total Semantic Outcome Paths:** $50 + 19 + 55 + 7 + 35 + 8 + 6 = \mathbf{180\text{ paths}}$.
3. **Defined Test Specifications:**
   - Suite 1 (Pre-Flight Suite): `DSP-PF-01` through `DSP-PF-34` (**34 specifications**)
   - Suite 2 (Outer Dispatch Suite): `DSP-01` through `DSP-220` (**220 specifications**, expanded from 198)
   - Suite 3 (Recovery Diagnostic Suite): `REC-01` through `REC-07` (**7 specifications**)
   - **Total Test Specifications:** $34 + 220 + 7 = \mathbf{261\text{ specifications}}$.
4. **Executed Operational Tests:**
   - **ZERO (0) EXECUTED.** All 261 specifications remain strictly **`[NOT EXECUTED — UNTESTED]`**.

### 9.2 Active Blockers & Safety Commitments

1. **`BLOCKER-1`: Missing Manual Restoration Protocol Runbook (`docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md`):**  
   - **Status:** ACTIVE OPEN BLOCKER.
   - **Policy:** Step AP must NOT be initiated, and live restoration must NOT be authorized in this step. File creation is held until explicitly directed.
2. **`BLOCKER-2`: Operational Implementation Authorization Pending:**  
   - Zero operational execution is permitted until human approval is formally recorded.
3. **`BLOCKER-3`: Inherent Windows User-Mode TOCTOU Windows:**  
   - Four distinct Windows user-mode filesystem race windows (Windows A, B, C, D) plus the entrypoint revalidation window cannot be eliminated in software.
   - All are mitigated to fail-closed aborts; zero windows can be claimed as eliminated.
4. **`BLOCKER-4`: Standalone Migration Runner Absence:**  
   - CLI migration runner with pre-flight database assertions has not yet been authored.
5. **`BLOCKER-5`: Role Creation Interactive Credential Policy:**  
   - Interactive console `\password zentra_dev` prompt required to preserve zero-plaintext credential standard.
6. **Host & Database Alterations:** **ZERO (0).**  
   - No configuration files (`postgresql.conf`, `pg_hba.conf`), Windows Firewall rules, Windows services, application code, or `.env` files were modified.  
   - Catalogs `hisecure_erp`, `hitech_platform`, and `zentra_test` remain completely untouched.
7. **Budget & Network Preservation:**  
   - Strict ₹0/month budget preserved. Zero remote network connections made.

---

## 10. Recommended Next Step (Without Executing It)

Upon formal human review and approval of this Step AO-AI audit report:
- **Recommended Next Step:** Author the comprehensive **Manual Restoration Protocol Runbook** ([`docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md)) to resolve `BLOCKER-1`, incorporating the complete 35-class discard artifact taxonomy, forensic log inspection procedures, nonce ledger verification rules, entrypoint physical revalidation checks, and Human Incident Commander sign-off runbooks prior to considering Gate 5 authorization.

---

```
STOP — STEP 2D-2A-AO-AI COMPLETE — WAITING FOR HUMAN REVIEW
```
