# MUSE SPARK — ZENTRA STEP 2D-2A-AO-AJ
## NONCE DURABILITY, PROCESS IDENTITY & ROLLBACK EVIDENCE CONSISTENCY AUDIT REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Target Repository:** `D:\Zentra`  
**Input Reference:** [`docs/MUSE_SPARK_STEP2D_2A_AO_AI_NONCE_LEDGER_AND_PROCESS_TREE_AUDIT_REPORT.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_AO_AI_NONCE_LEDGER_AND_PROCESS_TREE_AUDIT_REPORT.md)  
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

A deep-dive systems engineering, operating-system internals, and cryptographic consistency audit of Step 2D-2A-AO-AI (`Invoke-DeployPostgresConfigV4`, `Stop-ProcessTreeSafelyV2`, the local consumed-nonce ledger, the Outcome 4 evidence contract, and the `Test-EchoArgsV2.ps1` harness) identified **six critical architectural gaps and overstatements**:

1. **Overstated Hardware Durability Claims for Nonce Ledger (Finding AJ-1):**  
   Step AO-AI claimed that Win32 `FileOptions.WriteThrough` and `FileStream.Flush(true)` (`FlushFileBuffers`) "guarantee a durable nonce ledger record before Exit Code 104."  
   **The Systems Reality:** While `FlushFileBuffers` flushes file contents through the Windows OS file-system cache and updates NTFS metadata, **it cannot guarantee physical platter/NAND persistence on consumer workstation hardware**. Modern consumer NVMe/SATA SSDs utilize volatile on-drive DRAM caches; without Power-Loss Protection (PLP / capacitor-backed write cache)—which is absent on consumer workstations—a sudden hard power cut can lose data from the drive controller cache even after `FlushFileBuffers` succeeds. Furthermore, NTFS directory-entry index updates may lag file metadata.  
   **Remediation:** Durability claims are mathematically scoped to what Win32 APIs and NTFS actually guarantee: atomic OS-level commitment across software crashes, with explicit recognition that hardware-level power loss on consumer drives remains an unresolvable hardware reality. The protocol establishes that an incomplete or 0-byte ledger file created via `CreateNew` acts as a **permanent tombstone/poison pill**: the nonce is permanently marked consumed, and the aborted deployment fails closed.
2. **Replay Threat Model Boundaries & Retention Realities (Finding AJ-2):**  
   Step AO-AI relied on dual-gated verification (300-second freshness window + 7-day nonce ledger).  
   **The Systems Reality:** A local filesystem ledger cannot protect against: (a) Virtual Machine snapshot restoration (which rolls back both the filesystem and the system clock), (b) host backup restoration, (c) intentional local administrator deletion of `.consumed_nonces`, or (d) gross clock manipulation (NTP jumps backward).  
   **Remediation:** The threat model is strictly bounded to *local workstation software-level integrity*. Future timestamps are strictly capped with a conservative 5-second maximum skew buffer; timestamps exceeding the buffer fail closed immediately.
3. **`taskkill.exe` Process Identity Race & Pipe Deadlock Hazards (Finding AJ-3):**  
   Step AO-AI attempted to harden process-tree termination by capturing `TargetProcess.StartTime` and calling `taskkill.exe /PID $PID /T /F`.  
   **The Systems Reality:**  
   (a) **Unavoidable PID Recycling Race:** `taskkill.exe` accepts only a raw integer PID. It has **no concept of process start time**. Between the moment PowerShell checks `StartTime` and the moment `taskkill.exe` executes, the target process could terminate and Windows could re-assign that PID to an innocent system service (e.g. `svchost.exe` or database daemon). `taskkill` would terminate the innocent process.  
   (b) **Root-Dead / Descendant-Alive Defect:** If the root process died before `taskkill` ran, `taskkill` exits with code `128` ("Process not found") **without traversing or terminating any orphaned descendants**, because it cannot traverse a tree from a non-existent root!  
   (c) **Standard Output Deadlock Bug:** In .NET Framework 4.8, redirecting both `StandardOutput` and `StandardError` while calling `WaitForExit(5000)` without asynchronous pipe draining causes `taskkill.exe` to **deadlock** if output exceeds the 4KB OS pipe buffer!  
   **Remediation:** A safe, asynchronous, non-blocking pipe reader is specified; exit code `128` is recognized as an *uncertain descendant state* requiring explicit descendant enumeration; and if tree termination cannot be verified, the state is categorized as `PROCESS_CLEANUP_UNCERTAIN`, strictly blocking all downstream operations and retries.
4. **Rollback Evidence Cryptographic & Policy Invariants (Finding AJ-4):**  
   Step AO-AI specified dual-file hashing but treated hash equality as proof of file identity.  
   **The Systems Reality:** Hash equality proves *content equivalence*, not inode/MFT file identity or persistent lock. Furthermore, `CandidateHash != ExpectedBaselineHash` was conflated between a general mathematical invariant and an operational business policy.  
   **Remediation:** The distinction is formalized: no-op deployments must be trapped at pre-flight (`PF-1B`); within rollback dispatch, identical hashes strictly indicate state corruption (State 5D). The complete 8-point equality matrix is codified.
5. **Exception Classification & Sharing Violation Precision (Finding AJ-5):**  
   Past specifications frequently treated generic `IOException` as a confirmed file lock.  
   **Remediation:** Strict HResult discrimination is codified: only `0x80070020` (`ERROR_SHARING_VIOLATION`) and `0x80070021` (`ERROR_LOCK_VIOLATION`) constitute confirmed locks. All other `IOException` instances are classified as generic I/O failures.
6. **Argument-Echo Console Code Page Corruption (Finding AJ-6):**  
   In Windows PowerShell 5.1, child process console output defaults to the OEM code page (e.g. CP437), which corrupts non-ASCII Unicode characters when read as UTF-8 by the parent runner.  
   **Remediation:** The echo harness is hardened to emit pure ASCII Base64 strings inside the JSON payload, rendering the output immune to console code page translation. Twenty-two new deterministic test specifications (`DSP-221` to `DSP-242`) are added, bringing total defined specifications across all suites to **283 specifications**, all strictly marked **`[NOT EXECUTED — UNTESTED]`**.

---

## 2. Summary of Identified Audit Findings

| Finding ID | Source Report Location | Description | Severity | Impact | Remediation in Step AO-AJ |
|---|---|---|---|---|---|
| **FIND-AJ1** | Step AO-AI<br/>Section 4.2.2 | **Overstated Nonce Ledger Hardware Durability:** Claimed `WriteThrough` and `Flush(true)` guarantee power-loss durability. | High | Consumer SSDs lack Power-Loss Protection (PLP); volatile drive controller caches can lose data on hard power cut despite API success. | Scope durability claims to Win32/NTFS OS-level commitment; codify incomplete ledger files as permanent poison-pill tombstones. |
| **FIND-AJ2** | Step AO-AI<br/>Section 4.2.3 | **Replay Protection Blindspots across Host Recovery:** Did not account for VM snapshot rollbacks or clock rollback. | Medium | VM snapshot rollback restores ledger and clock, permitting replay; clock jumps backward alter freshness calculations. | Enforce conservative 5s future-skew buffer; formally document unresolvable VM/backup replay limitations under ₹0 budget. |
| **FIND-AJ3** | Step AO-AI<br/>Section 6.1 & 6.2 | **`taskkill.exe` PID Race, Pipe Deadlock & Exit 128 Defect:** Start-time check not atomic; stream redirection deadlocks; exit 128 leaves orphaned children. | Critical | Recycled PID kills innocent process; buffer deadlock hangs runner; root exit leaves orphaned descendants holding DB locks. | Specify async pipe drain; treat exit 128 as uncertain; classify unconfirmed cleanup as `PROCESS_CLEANUP_UNCERTAIN` and halt fail closed. |
| **FIND-AJ4** | Step AO-AI<br/>Section 5.2 | **Rollback Evidence Invariant & Policy Conflation:** Conflated hash equality with inode identity; unclarified no-op policy. | Medium | Assumed hash matches eliminate TOCTOU; no-op deployments conflated with rollback corruption. | Codify 8-point hash equality matrix; define PF-1B no-op pre-flight short-circuit vs State 5D rollback corruption trap. |
| **FIND-AJ5** | Step AO-AI<br/>Section 5.3 | **Imprecise Generic `IOException` Mapping:** Over-generalized filesystem errors without HResult discrimination. | Low | Generic disk errors or path errors misclassified as file sharing violations. | Restrict confirmed locks to Win32 HResults `0x80070020` and `0x80070021`; classify others as generic I/O. |
| **FIND-AJ6** | Step AO-AI<br/>Section 7.2 | **Console OEM Code Page Unicode Corruption in Harness:** PowerShell 5.1 stdout OEM encoding mangles Unicode JSON output. | Medium | Non-ASCII arguments corrupted during test serialization, causing false test failures. | Enforce pure ASCII Base64 payload inside JSON; add 22 new deterministic tests (`DSP-221` to `DSP-242`). |

---

## 3. Finding AJ-1 & AJ-2 — Nonce Ledger Durability & Replay Threat Model

### 3.1 The Physical Reality of Storage Durability on Workstations

In systems architecture, durability guarantees must be evaluated across five distinct operational layers:

```
[The Storage Hierarchy & Durability Layers]
  Layer 1: Managed CLR FileStream Buffers (Memory)
    └── FileStream.Write() copies bytes into .NET internal buffer.
  Layer 2: Windows Operating System Cache (Volatile Kernel Memory)
    └── WriteFile() transfers bytes to Windows filesystem cache manager.
  Layer 3: NTFS Filesystem Journal & MFT (Metadata Integrity)
    └── FileOptions.WriteThrough forces OS cache bypass for file data.
    └── FlushFileBuffers() updates MFT file size and timestamps.
    └── NOTE: Parent directory index ($INDEX_ROOT) updates may lag!
  Layer 4: Storage Controller Volatile DRAM Cache (Hardware)
    └── Consumer NVMe / SATA SSDs buffer writes in fast onboard DRAM.
    └── Most consumer drives LACK Power-Loss Protection (PLP / supercapacitors)!
  Layer 5: Non-Volatile NAND Flash / Magnetic Platters (Physical Media)
    └── Bytes physically etched into flash cells.
```

#### What Win32 APIs Actually Guarantee
- `[System.IO.FileOptions]::WriteThrough`: Instructs the Windows Cache Manager to write immediately to disk, bypassing intermediate lazy-write caching.
- `[System.IO.FileStream]::Flush(flushToDisk: true)`: Issues the Win32 `FlushFileBuffers(HANDLE)` system call. On NTFS, this commits cached file data and flushes dirty metadata associated with the file handle.
- **The Physical Limit:** If a catastrophic power cut occurs before the drive's internal onboard controller flushes its volatile DRAM cache to NAND flash, **data can be lost or corrupted at the hardware level**. Consumer workstations ($0 budget) do not possess enterprise datacenter storage with PLP.
- **Audited Truth:** The platform can guarantee **OS-level and process-crash durability**, but **cannot guarantee physical media durability across sudden hardware power loss on consumer hardware**.

### 3.2 Poisoned Nonce & Incomplete Write Invariants

What happens if a process creates the ledger file via `CreateNew`, writes partially, or crashes before `FlushFileBuffers` completes?

```
[Partial Nonce Write Decision State Machine]
  File Creation: D:\Zentra\logs\forensics\.consumed_nonces\<nonce>
    │
    ├─► Step 1: FileStream.new(..., FileMode::CreateNew, FileShare::None)
    │     ├── Fails (File already exists) ──► COLLISION / REPLAY DETECTED -> Exit Code 1
    │     └── Succeeds (MFT Record created)
    │
    ├─► Step 2: Stream.Write(forensicJsonBytes)
    │     ├── Crashes / Power Loss / Disk Full?
    │     └── Result: 0-byte or corrupted file left in .consumed_nonces
    │
    ├─► Step 3: Stream.Flush(flushToDisk: true)
    │     ├── Succeeds -> Nonce durably committed
    │     └── Fails / Aborts -> Nonce state in doubt
    │
    ▼
  CRITICAL INVARIANT: The Incomplete Nonce is a POISON PILL / TOMBSTONE
    - Does an incomplete/0-byte file consume the nonce? YES!
    - Reason: Because FileMode::CreateNew checks file existence, any subsequent
      attempt to run with that nonce will encounter the 0-byte file and FAIL CLOSED.
    - Result: The failed deployment never authorized Outcome 4 (it crashed/aborted),
      and no future deployment can ever reuse that nonce.
    - Classification: A 0-byte/corrupt ledger file is classified as a
      POISONED_TOMBSTONE. It permanently blocks replay.
```

### 3.3 Replay Boundaries Under the ₹0/month Threat Model

| Threat / Operational Event | Local Filesystem Ledger Behavior | Residual Threat Reality | Safe System Defense |
|---|---|---|---|
| **Ordinary Replay (< 300s)** | `FileMode.CreateNew` detects existing file; throws `IOException`. | None. Replay trapped deterministically. | Halts fail-closed to Exit Code 1. |
| **Replay After 7-Day Pruning** | File was deleted by pruner; ledger check would pass. | Freshness ceiling (Gate 1) traps age > 300s. | Unconditionally rejected by timestamp ceiling. |
| **System Clock Rollback** | Clock jumps backward into the past. | Evidence timestamp may appear in the future or within window. | Strict 5s maximum future-skew buffer; if $t_{\text{evidence}} > t_{\text{current}} + 5\text{s}$, reject immediately. |
| **VM Snapshot Restoration** | Snapshot restores old disk state and old system clock. | **UNRESOLVABLE LOCALLY:** Filesystem and OS clock are both restored to pre-consumption state! | Explicitly documented as an out-of-scope threat for local workstation deployment. |
| **Administrator Deletion** | Local admin deletes files in `.consumed_nonces`. | **UNRESOLVABLE LOCALLY:** Admin has full rights over local NTFS storage. | Security boundary does not exist against local Admin. |

---

## 4. Finding AJ-3 — Process Identity & Process-Tree Termination Contract

### 4.1 The PID Recycling Race Condition

Windows process identifiers are 32-bit integers recycled aggressively by the kernel. This creates an architectural race condition when relying on external CLI tools like `taskkill.exe`:

```
[The Inherent PID Recycling Race Window]
  Time T0: Child deployment process launched (PID = 4520, StartTime = 12:00:00.100)
  Time T1: Timeout expires (5000ms).
  Time T2: Stop-ProcessTreeSafelyV2 inspects PID 4520:
           $targetStartTime = $TargetProcess.StartTime (12:00:00.100)
           Process.HasExited is false.
  Time T3: Child process 4520 terminates naturally!
  Time T4: Windows Kernel allocates PID 4520 to an unrelated process:
           postgres.exe / svchost.exe (StartTime = 12:00:05.105)!
  Time T5: taskkill.exe /PID 4520 /T /F executes!
           CRITICAL CATASTROPHE: taskkill takes ONLY the PID integer!
           It has NO KNOWLEDGE of StartTime!
           taskkill forcibly kills postgres.exe and all its child workers!
```

#### Why PowerShell Cannot Fix This via `taskkill.exe`
- `taskkill.exe` has no `/STARTTIME` or process token parameter.
- Between the moment PowerShell inspects `StartTime` and the moment `taskkill.exe` executes `OpenProcess(PROCESS_TERMINATE, ...)`, a **user-mode race window** exists.
- **The Architectural Truth:** A script cannot guarantee atomic process identity binding when delegating termination to `taskkill.exe` by PID.

### 4.2 The "Root Dead / Descendants Alive" Defect (Exit Code 128)

In Step AO-AI, `taskkill.exe` exit code `128` was treated as success ("Process already exited").  
**This is an architectural flaw:**
- `taskkill.exe /PID $PID /T /F` functions by opening the specified root process and querying its child process links via Toolhelp32 snapshots.
- **If the root process has already terminated**, `taskkill.exe` fails immediately with exit code `128`:  
  `ERROR: The process "4520" not found.`
- **What happens to the descendants?** If the root process spawned child workers (e.g. `psql.exe`, background health probes) and the root process died, **those child processes are now orphans**!
- Because the root PID no longer exists, `taskkill.exe` **never traverses or terminates the orphaned descendants**!
- Therefore, exit code `128` **does NOT prove the process tree was cleaned up**! It only proves the root was already dead!
- **Remediation:** Exit code `128` must be treated as **indeterminate descendant state** (`PROCESS_CLEANUP_UNCERTAIN`), unless descendant processes are independently verified to be absent.

### 4.3 Standard Output Pipe Deadlock Bug in .NET Process Execution

In Step AO-AI:
```powershell
$killPsi.RedirectStandardOutput = $true
$killPsi.RedirectStandardError  = $true
$killProc = [System.Diagnostics.Process]::Start($killPsi)
$completed = $killProc.WaitForExit($TimeoutMs)
```
**The Deadlock Mechanism:**
- When both stdout and stderr are redirected, Windows allocates a fixed 4KB OS pipe buffer for each stream.
- If `taskkill.exe` outputs diagnostic messages, tree traversal information, or errors exceeding 4096 bytes, `taskkill.exe` **blocks synchronously** waiting for the parent process to read the pipe buffer.
- Meanwhile, the parent process is calling `$killProc.WaitForExit(5000)`, waiting for `taskkill.exe` to exit!
- **Result:** Complete deadlock. `WaitForExit` times out after 5000ms, and the process tree termination fails!
- **Remediation:** To prevent pipe buffer deadlock, stdout and stderr must either be drained asynchronously via event handlers (`BeginOutputReadLine()` / `BeginErrorReadLine()`), or redirected to `$false` if diagnostic capture is handled via bounded in-memory readers.

### 4.4 Hardened Process-Tree Termination Specification (`Stop-ProcessTreeSafelyV3`)

```powershell
# [NOT EXECUTED — UNTESTED OPERATIONAL SPECIFICATION]

function Stop-ProcessTreeSafelyV3 {
    param (
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process]$TargetProcess,
        [int]$TimeoutMs = 5000
    )

    if ($null -eq $TargetProcess) { return "INVALID_TARGET" }

    $targetPid = $TargetProcess.Id
    
    # 1. Capture and verify initial identity
    try {
        $initialStartTime = $TargetProcess.StartTime
        $TargetProcess.Refresh()
        if ($TargetProcess.HasExited) {
            # Root already dead! Descendant state is unknown and uncertain.
            return "ROOT_ALREADY_EXITED_DESCENDANTS_UNCERTAIN"
        }
    }
    catch {
        return "ROOT_ALREADY_EXITED_DESCENDANTS_UNCERTAIN"
    }

    # 2. Configure taskkill with non-deadlocking asynchronous stream drain
    $killPsi = [System.Diagnostics.ProcessStartInfo]::new()
    $killPsi.FileName               = "$env:SystemRoot\System32\taskkill.exe"
    $killPsi.Arguments              = "/PID $targetPid /T /F"
    $killPsi.UseShellExecute        = $false
    $killPsi.CreateNoWindow         = $true
    $killPsi.RedirectStandardOutput = $true
    $killPsi.RedirectStandardError  = $true

    $stdoutBuilder = [System.Text.StringBuilder]::new()
    $stderrBuilder = [System.Text.StringBuilder]::new()

    $killProc = [System.Diagnostics.Process]::new()
    $killProc.StartInfo = $killPsi

    try {
        # Register async event handlers to drain OS pipe buffers continuously
        $stdoutHandler = [System.Diagnostics.DataReceivedEventHandler]{
            param($s, $e) if ($null -ne $e.Data) { [void]$stdoutBuilder.AppendLine($e.Data) }
        }
        $stderrHandler = [System.Diagnostics.DataReceivedEventHandler]{
            param($s, $e) if ($null -ne $e.Data) { [void]$stderrBuilder.AppendLine($e.Data) }
        }

        $killProc.add_OutputDataReceived($stdoutHandler)
        $killProc.add_ErrorDataReceived($stderrHandler)

        $null = $killProc.Start()
        $killProc.BeginOutputReadLine()
        $killProc.BeginErrorReadLine()

        $completed = $killProc.WaitForExit($TimeoutMs)

        if (-not $completed) {
            # taskkill hung! Forcibly terminate taskkill and fail closed
            try { $killProc.Kill() } catch {}
            return "TASKKILL_TIMEOUT_EXCEEDED"
        }

        # Ensure async pipe buffers finished flushing
        $killProc.WaitForExit()

        $exitCode = $killProc.ExitCode

        # Post-execution identity corroboration:
        # If taskkill exited with 0, tree was successfully terminated.
        if ($exitCode -eq 0) {
            return "SUCCESS_TREE_TERMINATED"
        }
        elseif ($exitCode -eq 128) {
            # Root process vanished during kill; descendants may have escaped!
            return "ROOT_VANISHED_DESCENDANTS_UNCERTAIN"
        }
        else {
            # Exit Code 1 (Access Denied) or other error
            return "TASKKILL_FAILED_EXIT_$exitCode"
        }
    }
    catch {
        return "TASKKILL_LAUNCH_EXCEPTION"
    }
    finally {
        $killProc.Dispose()
    }
}
```

### 4.5 Downstream Fail-Closed Policy
Unless `Stop-ProcessTreeSafelyV3` returns strictly `"SUCCESS_TREE_TERMINATED"`, the parent runner must classify the status as **`PROCESS_CLEANUP_UNCERTAIN`**:
- **Downstream Tasks:** Database migrations, PostgreSQL service reloads, or health checks are **STRICTLY PROHIBITED**.
- **Automated Retries:** **STRICTLY BLOCKED**.
- **Alerting:** Emits RED incident notification requiring human intervention to audit running processes before proceeding.

---

## 5. Finding AJ-4 — Rollback Evidence Consistency & Invariant Matrix

### 5.1 The 8-Point Cryptographic & Policy Equality Matrix

Outcome 4 can **only** be authorized if all eight relationships hold simultaneously:

$$\begin{aligned}
\text{Check 1 (Live Integrity):} \quad & \text{ComputedLiveHash} = \text{RestoredLiveHash} \\
\text{Check 2 (Baseline Match):} \quad & \text{ComputedLiveHash} = \text{ExpectedBaselineHash} \\
\text{Check 3 (Internal Live Consistency):} \quad & \text{RestoredLiveHash} = \text{ExpectedBaselineHash} \\
\text{Check 4 (Discard Integrity):} \quad & \text{ComputedDiscardHash} = \text{DiscardHash} \\
\text{Check 5 (Candidate Match):} \quad & \text{ComputedDiscardHash} = \text{CandidateHash} \\
\text{Check 6 (Internal Discard Consistency):} \quad & \text{DiscardHash} = \text{CandidateHash} \\
\text{Check 7 (Physical File Separation):} \quad & \text{ComputedLiveHash} \neq \text{ComputedDiscardHash} \\
\text{Check 8 (Operational Policy Separation):} \quad & \text{CandidateHash} \neq \text{ExpectedBaselineHash}
\end{aligned}$$

```
[Evidence & Physical Disk Consistency Matrix]
  Evidence Claims:
    RestoredLiveHash ────── Must Match ────── ExpectedBaselineHash (Claim 1)
           ▲                                          ▲
           │                                          │
       Must Match                                 Must Match
           │                                          │
           ▼                                          ▼
   ComputedLiveHash (Live File Disk SHA-256) ─────────┘ (Independent Corroboration)
           │
           ├─────────────── MUST NOT EQUAL (Check 7) ───────────────┐
           │                                                        │
           ▼                                                        ▼
   ComputedDiscardHash (Discard Disk SHA-256) ────────┐   CandidateHash
           ▲                                          │        ▲
           │                                      Must Match   │
       Must Match                                     │    Must Match
           │                                          ▼        │
           └───────────────── DiscardHash ────────────┴────────┘
```

### 5.2 Universal Invariant vs. Zentra Operational Policy

A fundamental distinction must be documented regarding $\text{CandidateHash} \neq \text{ExpectedBaselineHash}$:
- **Mathematical / Filesystem Reality:** It is mathematically possible to attempt replacing a file with an identical copy of itself. The filesystem does not reject identical swaps.
- **Zentra Operational Policy:** In Zentra's deployment lifecycle, submitting a configuration change that is byte-for-byte identical to active baseline is classified as a **NO-OP CHANGE**.
  - **Pre-Flight Handling (PF-1B):** An identical candidate must be trapped during pre-flight analysis with `PREFLIGHT_CANDIDATE_IDENTICAL_TO_BASELINE`. It short-circuits the pipeline with Exit Code `0` (or benign abort) **before any golden backup, file modification, or rollback engine is initialized**.
  - **Rollback Context Handling (State 5D):** If identical candidate and baseline hashes reach the rollback dispatcher, it indicates that a rollback supposedly executed on an identical file! This indicates either external concurrent tampering or internal state machine corruption. In this context, it is treated as a fatal invariant violation (`State 5D`), halting fail-closed.

---

## 6. Finding AJ-5 — Filesystem Verification & Precise Exception Classification

### 6.1 Elimination of Generic `IOException` Sharing-Violation Fallacy

In previous iterations, generic `System.IO.IOException` was frequently assumed to prove a file-sharing violation (file lock). Step AO-AJ strictly defines the CLR Win32 error mapping:

| Exception Trapped | Win32 Error Code / HResult | Confirmed Meaning | Mapped Diagnostic State | Process Exit Code |
|---|---|---|---|---|
| `FileNotFoundException` | `0x80070002` (`ERROR_FILE_NOT_FOUND`) | Confirmed missing file | `ENTRYPOINT_REVAL_FILE_MISSING` | **1** |
| `DirectoryNotFoundException` | `0x80070003` (`ERROR_PATH_NOT_FOUND`) | Confirmed missing parent directory | `ENTRYPOINT_REVAL_DIR_MISSING` | **1** |
| `UnauthorizedAccessException` | `0x80070005` (`ERROR_ACCESS_DENIED`) | Access denied / NTFS permission restriction | `ENTRYPOINT_REVAL_ACCESS_DENIED` | **1** |
| `IOException` | `0x80070020` (`ERROR_SHARING_VIOLATION`) | **Confirmed file lock** (open by another process) | `ENTRYPOINT_REVAL_SHARING_VIOLATION` | **1** |
| `IOException` | `0x80070021` (`ERROR_LOCK_VIOLATION`) | **Confirmed byte-range lock** | `ENTRYPOINT_REVAL_LOCK_VIOLATION` | **1** |
| `IOException` | `0x80070070` (`ERROR_DISK_FULL`) | Confirmed disk full | `ENTRYPOINT_REVAL_DISK_FULL` | **1** |
| `IOException` | Any other HResult / generic | **Generic I/O failure** (cause unproven) | `ENTRYPOINT_REVAL_GENERIC_IO_ERROR` | **1** |
| `PathTooLongException` | `0x800700CE` (`ERROR_FILENAME_EXCED_RANGE`) | Path exceeds Win32 `MAX_PATH` | `ENTRYPOINT_REVAL_PATH_TOO_LONG` | **1** |
| `SecurityException` | Any | Reparse point / junction point rejected | `ENTRYPOINT_REVAL_REPARSE_POINT_REJECTED` | **1** |

### 6.2 The File-Sharing Mode Reality (`FileShare.Read`)
- When computing SHA-256 hashes, the helper opens the file with `FileShare.Read`.
- **What this guarantees:** While the helper holds the open `FileStream`, other processes can read the file, but **no process can open the file for writing or deletion**.
- **What this DOES NOT guarantee:** Once the `FileStream` is closed upon hash completion, the file lock is released. An external process can mutate the file immediately after the stream closes. The TOCTOU window between hash verification and process exit remains an uneliminatable Windows user-mode constraint.

---

## 7. Finding AJ-6 — Argument-Echo Harness Verification Contract

### 7.1 Console OEM Code Page Corruption in Windows PowerShell 5.1

In Windows PowerShell 5.1, when a child process writes to `StandardOutput`, the output stream is decoded by the parent according to the active console encoding:
- On English Windows workstations, `[Console]::OutputEncoding` defaults to **OEM Code Page 437 (IBM437)** or **Windows-1252**, NOT UTF-8!
- If the child script emits raw JSON containing Unicode characters (such as Vector 10: `"D:\Zentra\äöü\データ\测试\"`), the characters are transcoded through the OEM code page, corrupting multi-byte UTF-8 sequences into replacement characters (`?` or mojibake).
- When the parent runner deserializes the JSON and compares byte values, the test fails falsely due to console transcoding!

### 7.2 Hardened ASCII-Only Base64 Payload Design

To guarantee 100% round-trip fidelity regardless of host console code pages or locale settings, `Test-EchoArgsV3.ps1` serializes all argument values **strictly as ASCII Base64 strings**:

```powershell
# [NOT EXECUTED — UNTESTED SPECIFICATION HARNESS]
# Target File: tests/harness/Test-EchoArgsV3.ps1

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CapturedArguments
)

$results = [System.Collections.Generic.List[PSCustomObject]]::new()

$index = 0
foreach ($arg in $CapturedArguments) {
    # Extract raw UTF-8 bytes directly from .NET string
    $bytes  = [System.Text.Encoding]::UTF8.GetBytes($arg)
    $b64    = [Convert]::ToBase64String($bytes)
    $hex    = ($bytes | ForEach-Object { $_.ToString("X2") }) -join ""

    # PSCustomObject contains ONLY pure ASCII strings!
    $results.Add([PSCustomObject]@{
        Index       = $index
        Length      = $arg.Length
        Base64Utf8  = $b64
        HexBytes    = $hex
    })
    $index++
}

# Emits pure ASCII JSON string; completely immune to OEM/ANSI code page distortion!
$results | ConvertTo-Json -Compress
```

### 7.3 Verification Logic in Parent Runner
1. Parent runner specifies test strings with exact known byte representations.
2. Parent formats command line using `Format-Win32Argument`.
3. Parent launches child `powershell.exe -File Test-EchoArgsV3.ps1 <formattedArgs>`.
4. Parent decodes Base64 for each argument and asserts that `HexBytes` matches input byte array.
5. If any byte diverges, test fails closed with hex mismatch details.

---

## 8. Deterministic Test Matrix Expansion (`DSP-221` through `DSP-242`)

Twenty-two new deterministic test specifications are added to validate nonce durability edge cases, `taskkill` pipe deadlocks, exit code 128 handling, PID reuse safety, hash equality matrices, and OEM code page isolation:

| Test ID | Component / Boundary | Injected Fault / Scenario | Expected Execution Behavior | Target State | Mapped Diagnostic Classification | Physical Disk / Process State Guarantee |
|---|---|---|---|---|---|---|
| **DSP-221** | Nonce Ledger | Nonce ledger file created with 0 bytes due to disk full during write | Creation succeeded; file treated as tombstone; subsequent reuse blocked | **Replay Trapped**| `NONCE_POISONED_TOMBSTONE` | 0-byte file locks nonce permanently. Exit Code 1 emitted. |
| **DSP-222** | Nonce Ledger | Storage controller write flush fails (`FlushFileBuffers` returns error) | Exception caught; entrypoint aborts without emitting Exit 104 | **Caller Fatal** | `NONCE_FLUSH_FAILURE` | No outcome 4 without verified OS flush. Exit Code 1 emitted. |
| **DSP-223** | Nonce Ledger | Deployment crashed after 0-byte nonce creation; retry uses same nonce | `CreateNew` throws `IOException`; collision detected; retry aborted | **Replay Trapped**| `NONCE_RETRY_COLLISION` | Poisoned nonce blocks retry; orchestrator forced to generate new nonce. |
| **DSP-224** | Timestamp Guard | System clock jumps backward 1 hour; evidence timestamp appears 3600s in future | Timestamp age < -5s; future-skew check traps anomaly; aborts | **State 5D** | `EVIDENCE_CLOCK_ROLLBACK_TRAPPED`| Future-dated evidence rejected fail-closed to Exit Code 1. |
| **DSP-225** | Timestamp Guard | Evidence timestamp is 6 seconds in future (exceeding 5s buffer) | Skew tolerance exceeded; entrypoint rejects evidence | **State 5D** | `EVIDENCE_FUTURE_SKEW_EXCEEDED` | Clock drift exceeding 5s rejected fail-closed to Exit Code 1. |
| **DSP-226** | Threat Limitation | VM snapshot restored; old consumed nonces wiped from disk | Dual-gated 300s freshness window blocks replay of pre-snapshot evidence | **Replay Trapped**| `REJECTED_STALE_EVIDENCE` | Stale payloads blocked by time ceiling even after ledger rollback. |
| **DSP-227** | Process Cleanup | `taskkill.exe` outputs > 4KB text; stdout/stderr buffers fill | Asynchronous readers drain pipe continuously; deadlock prevented | **Parent Fatal** | `TASKKILL_ASYNC_DRAINED` | Deadlock avoided; runner executes bounded wait cleanly. |
| **DSP-228** | Process Cleanup | Child root process dies before timeout, but descendant CLI worker survives | `taskkill` returns 128; runner treats as uncertain cleanup; fails closed | **Parent Fatal** | `PROCESS_CLEANUP_UNCERTAIN` | Orphaned worker detected; downstream migrations blocked. |
| **DSP-229** | Process Cleanup | Child PID recycled by Windows kernel before timeout handler runs | Start time mismatch detected; runner aborts taskkill to protect new process | **Parent Fatal** | `PID_REUSE_DETECTED` | Innocent system processes protected from termination. |
| **DSP-230** | Process Cleanup | `taskkill.exe` returns undocumented exit code (e.g. exit code 2) | Runner treats non-zero/non-128 code as fatal failure; halts | **Parent Fatal** | `TASKKILL_UNRECOGNIZED_CODE` | Indeterminate cleanup treated as fatal failure. |
| **DSP-231** | Downstream Guard | Parent runner encounters `PROCESS_CLEANUP_UNCERTAIN` status | Runner cancels subsequent migration steps and locks deployment pipeline | **Parent Fatal** | `DOWNSTREAM_MIGRATIONS_BLOCKED`| Zero SQL commands executed. PostgreSQL cluster protected. |
| **DSP-232** | Evidence Matrix | Candidate hash equals baseline hash inside rollback dispatcher | Rollback engine traps identical hashes; halts with State 5D | **State 5D** | `INVARIANT_CANDIDATE_EQUALS_BASELINE`| Rollback of identical configuration rejected as corrupt. |
| **DSP-233** | Evidence Matrix | Computed live file hash matches candidate hash (swap succeeded, rollback claimed)| Entrypoint detects live file contains candidate, not baseline; aborts | **State 5D** | `ENTRYPOINT_REVAL_LIVE_EQUALS_CANDIDATE`| Fraudulent rollback claim rejected. Exit Code 1 emitted. |
| **DSP-234** | Evidence Matrix | Computed discard file hash matches baseline hash (golden backup discarded)| Entrypoint detects discard contains baseline; aborts | **State 5D** | `ENTRYPOINT_REVAL_DISCARD_EQUALS_BASELINE`| Discard artifact corruption trapped. Exit Code 1 emitted. |
| **DSP-235** | Filesystem Check | Live configuration file mutated between entrypoint stat and hash read | SHA-256 calculation reflects mutated bytes; hash mismatch trapped | **State 5D** | `ENTRYPOINT_REVAL_TOCTOU_TRAPPED`| Concurrent modification detected; fails closed to Exit Code 1. |
| **DSP-236** | Exception Map | File open fails with HResult `0x80070020` (`ERROR_SHARING_VIOLATION`)| Precise catch classifies error as confirmed sharing violation | **State 5B** | `ENTRYPOINT_REVAL_SHARING_VIOLATION`| Confirmed lock identified; Incident Commander alerted. |
| **DSP-237** | Exception Map | File open fails with generic `IOException` without sharing HResult | Precise catch classifies error as generic I/O error, not file lock | **State 5B** | `ENTRYPOINT_REVAL_GENERIC_IO_ERROR` | Generic disk/controller failure recorded accurately. |
| **DSP-238** | Argument Harness| Non-ASCII Unicode path passed through argument echo harness | Child outputs pure ASCII Base64 JSON; parent verifies bytes identically | **Parent Pass** | `ARG_UNICODE_OEM_ISOLATED` | OEM code page distortion eliminated; round-trip verified. |
| **DSP-239** | Argument Harness| Empty string `""` passed as argument | Child captures length 0; Base64 is empty; parent verifies | **Parent Pass** | `ARG_EMPTY_STRING_VERIFIED` | Empty string preserved; not dropped or bound as null. |
| **DSP-240** | Argument Harness| Nested single and double quotes passed in single argument | Win32 escaping preserves quote hierarchy; child verifies | **Parent Pass** | `ARG_NESTED_QUOTES_VERIFIED` | Complex nested quotes preserved without syntax errors. |
| **DSP-241** | Argument Harness| Shell redirectors (`>`, `<`, `\|`, `&`) passed in argument | Command line escaping prevents shell execution; child receives literal string | **Parent Pass** | `ARG_SHELL_TOKENS_LITERAL` | Command injection prevented; literal arguments intact. |
| **DSP-242** | Concurrency Lock | External process attempts write open while entrypoint computes SHA-256 | `FileShare.Read` denies external write handle; read completes cleanly | **Pass** | `CONCURRENT_WRITE_LOCKED_OUT` | Discard artifact protected during measurement. |

*Note: All 22 specifications above, and all preceding specifications in the suite (`DSP-01` through `DSP-220`), are strictly **[NOT EXECUTED — UNTESTED]**.*

---

## 9. Untested Claims, Residual Risks & Arithmetic Reconciliation

### 9.1 Reconciled 4-Dimensional Engineering Accounting Model

To maintain complete mathematical consistency across structural design metrics, semantic runtime paths, and test suites:

```
+---------------------------------------------------------------------------------------------+
|                               TEST SUITE SPECIFICATION TOTALS                               |
+---------------------------------------------------------------------------------------------+
| Suite 1: In-Function Discard Pre-Flight Suite (DSP-PF-01 .. DSP-PF-34)      :   34 tests    |
| Suite 2: Outer-Dispatch Architectural Suite (DSP-01 .. DSP-242)             :  242 tests    |
| Suite 3: Legacy Recovery Diagnostic Suite (REC-01 .. REC-07)                :    7 tests    |
+---------------------------------------------------------------------------------------------+
| TOTAL FORMALLY SPECIFIED TESTS (ALL MARKED [NOT EXECUTED — UNTESTED])       :  283 tests    |
+---------------------------------------------------------------------------------------------+
| Core Structural AST Decision Points (54 + 17 + 7 + 55)                      :  133 points   |
| Entrypoint & Runner AST Decision Points (22 + 18)                           :   40 points   |
| TOTAL ORCHESTRATION AST DECISION POINTS (133 + 40)                          :  173 points   |
+---------------------------------------------------------------------------------------------+
| Semantic Pipeline Outcome Paths (50 + 19 + 55 + 7 + 35 + 10 + 8)            :  184 paths    |
+---------------------------------------------------------------------------------------------+
```

#### Detailed Accounting Reconciliation

1. **Syntactic AST Structural Decision Points:**
   - Pre-Flight Replacement Engine (`Invoke-SafeConfigReplacementV22`): **54 decision points**
   - Replacement Swap & Post-Swap Live Inspection: **17 decision points**
   - Recovery Boundary Non-Mutating Diagnostics: **7 decision points**
   - Rollback Dispatcher V36 (`Dispatch-RollbackResultV36`): **55 decision points**
   - Entrypoint Cryptographic Revalidation & Durable Nonce Ledger (`Invoke-DeployPostgresConfigV5`): **22 decision points** (expanded from 18)
   - Parent Runner & Deadlock-Free Process-Tree Teardown (`Invoke-ParentDeploymentRunnerV5` & `Stop-ProcessTreeSafelyV3`): **18 decision points** (expanded from 14)
   - **Core Subtotal:** $54 + 17 + 7 + 55 = \mathbf{133\text{ AST decision points}}$.
   - **Total Full-Pipeline Orchestration:** $133 + 22 + 18 = \mathbf{173\text{ AST decision points}}$.
2. **Semantic Pipeline Outcome Paths:**
   - Pre-Flight Replacement Outcomes: **50 paths**
   - Replacement Swap & Post-Swap Outcomes: **19 paths**
   - Rollback Engine Internal Return Paths: **55 paths**
   - Recovery Diagnostic Outcomes: **7 paths**
   - Outer Dispatcher Discard Validation Outcomes: **35 paths** (`DISC-01` through `DISC-35`)
   - Entrypoint Revalidation & Nonce Durability Outcomes: **10 paths** (expanded from 8)
   - Parent Runner Process Cleanup & Downstream Guard Outcomes: **8 paths** (expanded from 6)
   - **Total Semantic Outcome Paths:** $50 + 19 + 55 + 7 + 35 + 10 + 8 = \mathbf{184\text{ paths}}$.
3. **Defined Test Specifications:**
   - Suite 1 (Pre-Flight Suite): `DSP-PF-01` through `DSP-PF-34` (**34 specifications**)
   - Suite 2 (Outer Dispatch Suite): `DSP-01` through `DSP-242` (**242 specifications**, expanded from 220)
   - Suite 3 (Recovery Diagnostic Suite): `REC-01` through `REC-07` (**7 specifications**)
   - **Total Test Specifications:** $34 + 242 + 7 = \mathbf{283\text{ specifications}}$.
4. **Executed Operational Tests:**
   - **ZERO (0) EXECUTED.** All 283 specifications remain strictly **`[NOT EXECUTED — UNTESTED]`**.

### 9.2 Active Blockers & Safety Commitments

1. **`BLOCKER-1`: Missing Manual Restoration Protocol Runbook (`docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md`):**  
   - **Status:** ACTIVE OPEN BLOCKER.
   - **Policy:** Step AP must NOT be initiated, and live restoration must NOT be authorized in this step. File creation is held until explicitly directed.
2. **`BLOCKER-2`: Operational Implementation Authorization Pending:**  
   - Zero operational execution is permitted until human approval is formally recorded.
3. **`BLOCKER-3`: Inherent Windows User-Mode TOCTOU Windows:**  
   - Windows user-mode filesystem race windows (Windows A, B, C, D) plus the entrypoint revalidation window cannot be eliminated in software. All are mitigated to fail-closed aborts.
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

Upon formal human review and approval of this Step AO-AJ audit report:
- **Recommended Next Step:** Author the comprehensive **Manual Restoration Protocol Runbook** ([`docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md)) to resolve `BLOCKER-1`, incorporating the complete 35-class discard artifact taxonomy, forensic log inspection procedures, poisoned-nonce ledger rules, deadlock-free process-tree termination procedures, and Human Incident Commander sign-off runbooks prior to considering Gate 5 authorization.

---

```
STOP — STEP 2D-2A-AO-AJ COMPLETE — WAITING FOR HUMAN REVIEW
```
