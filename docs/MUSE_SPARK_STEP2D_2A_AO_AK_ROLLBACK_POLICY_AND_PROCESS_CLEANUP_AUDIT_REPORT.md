# MUSE SPARK — ZENTRA STEP 2D-2A-AO-AK
## ROLLBACK POLICY AND PROCESS CLEANUP AUDIT REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Target Repository:** `D:\Zentra`  
**Input Reference:** [`docs/MUSE_SPARK_STEP2D_2A_AO_AJ_NONCE_DURABILITY_AND_PROCESS_IDENTITY_AUDIT_REPORT.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_AO_AJ_NONCE_DURABILITY_AND_PROCESS_IDENTITY_AUDIT_REPORT.md)  
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

A comprehensive systems, threat-boundary, and operating-system lifecycle audit of Step 2D-2A-AO-AJ (`Invoke-DeployPostgresConfigV5`, `Stop-ProcessTreeSafelyV3`, the consumed-nonce ledger, the Outcome 4 evidence contract, and the `Test-EchoArgsV3.ps1` harness) identified **six critical specification-level overstatements and unverified assumptions**:

1. **Overstated Durability Guarantees of Partial Nonce Records (Finding AK-1):**  
   Step AO-AJ asserted that an incomplete or 0-byte ledger file created via `CreateNew` guarantees permanent replay protection.  
   **The Architectural Reality:** While a 0-byte file locks the nonce *on that specific filesystem instance as long as the file exists*, **it provides zero protection if the ledger directory is deleted by an administrator, rolled back via VM snapshot, restored from an older backup, or lost due to storage failure**. Furthermore, if the ledger directory is missing, unreadable, or corrupted, the system cannot verify nonces.  
   **Remediation:** Nonce durability is strictly scoped: a local 0-byte file is an ephemeral tombstone, not an indelible cryptographic ledger. The system codifies a strict fail-closed contract: if the ledger directory is missing, unreadable, or malformed, deployment halts fail-closed immediately (Exit Code `1`). The dual-gated 300-second freshness window remains the primary defense against replay across ledger loss or restoration.
2. **The Inherent Unmitigability of PID Recycling via External CLI Tools (Finding AK-2):**  
   Step AO-AJ attempted to mitigate the PID reuse race by checking `TargetProcess.StartTime` before launching `taskkill.exe`.  
   **The Architectural Reality:** **A pre-check does NOT make PID-based CLI termination identity-safe.** There is an unavoidable, user-mode Time-of-Check to Time-of-Use (TOCTOU) race window between PowerShell reading `StartTime` and `taskkill.exe` executing `OpenProcess(PROCESS_TERMINATE, ...)`. If the target process terminates during this window and Windows kernel allocates that PID to an innocent system service, `taskkill` will terminate the innocent process. Furthermore, `taskkill /T /F` does not guarantee complete descendant termination (processes spawned with `CREATE_BREAKAWAY_FROM_JOB` or created during snapshot traversal escape).  
   **Remediation:** The specification formally acknowledges this OS limitation: external CLI PID termination can never provide atomic identity binding. The process-tree cleanup contract is hardened: exit code `128` is recognized as an *uncertain descendant state*; unless cleanup meets the verified contract (`SUCCESS_TREE_TERMINATED`), the state is categorized as `PROCESS_CLEANUP_UNCERTAIN`, strictly blocking all downstream operations and automated retries.
3. **Conflation of Universal Hash Facts with Zentra Operational Policy (Finding AK-3):**  
   Step AO-AJ presented the 8-point equality matrix without distinguishing mathematical content-hash properties from Zentra business policies.  
   **The Architectural Reality:** SHA-256 equality proves identical byte sequences; it does **not** prove inode/file identity, does **not** prove permanent locking, and does **not** eliminate TOCTOU races after stream handles close. Furthermore, $\text{CandidateHash} \neq \text{ExpectedBaselineHash}$ is an *operational business policy* (preventing no-op tickets), not a filesystem law. In contrast, $\text{ComputedLiveHash} \neq \text{ComputedDiscardHash}$ is an essential *physical rollback verification check* (verifying that the restored live file and discarded candidate are not identical).  
   **Remediation:** Clear separation is codified between universal cryptographic facts and Zentra business policies. Independent on-disk verification of live and discard artifacts remains mandatory before Outcome 4 can be authorized.
4. **Specified vs. Runtime-Verified Filesystem Exception Mappings (Finding AK-4):**  
   Step AO-AJ mapped specific Win32 HResults (e.g. `0x80070020`, `0x80070070`) to diagnostic classifications.  
   **The Architectural Reality:** While these HResults conform to Microsoft Win32 documentation, **they have NOT been verified by live runtime execution against Windows PowerShell 5.1 on this host in this step**. Presenting them as runtime facts violates audit standards.  
   **Remediation:** All HResult exception mappings are formally designated as **"SPECIFIED — NOT RUNTIME-VERIFIED ON LIVE HOST IN THIS STEP"**.
5. **Windows PowerShell 5.1 Argument Parsing Boundaries in Echo Harness (Finding AK-5):**  
   Step AO-AJ specified `Test-EchoArgsV3.ps1` with Base64 JSON output.  
   **The Architectural Reality:** The harness specifies how arguments should round-trip, but Windows PowerShell's secondary command-line tokenizer (`-File` vs standard C runtime `CommandLineToArgvW`) has distinct quote-stripping rules that remain **untested on this system**.  
   **Remediation:** The argument-echo specification is refined, and all related test specifications remain strictly marked **`[NOT EXECUTED — UNTESTED]`**.
6. **Deterministic Test Matrix Expansion & Accounting Reconciliation (Finding AK-6):**  
   Twenty-two new deterministic test specifications (`DSP-243` through `DSP-264`) are defined covering ledger loss, snapshot restore, PID race conditions, breakaway descendants, unverified HResults, and argument edge cases. Total defined test specifications expand to **305 specifications across all suites**, all strictly marked **`[NOT EXECUTED — UNTESTED]`**.

---

## 2. Summary of Identified Audit Findings

| Finding ID | Source Report Location | Description | Severity | Impact | Remediation in Step AO-AK |
|---|---|---|---|---|---|
| **FIND-AK1** | Step AO-AJ<br/>Section 3.2 | **Overstated Replay Protection of Partial Nonce Records:** Claimed 0-byte file guarantees permanent replay protection. | High | If ledger directory is deleted, lost, or restored from VM snapshot, 0-byte tombstone vanishes. | Bound durability claims to local filesystem instance; mandate fail-closed abort on missing/unreadable ledger; rely on dual-gated freshness. |
| **FIND-AK2** | Step AO-AJ<br/>Section 4.1 | **False Identity Safety Claim for PID Pre-Check:** Claimed checking `StartTime` mitigates PID recycling race in `taskkill.exe`. | Critical | Pre-check does not eliminate TOCTOU window; `taskkill` still executes by raw PID; breakaway descendants escape. | Acknowledge unmitigable OS CLI race; classify exit 128 as uncertain; enforce fail-closed `PROCESS_CLEANUP_UNCERTAIN` downstream block. |
| **FIND-AK3** | Step AO-AJ<br/>Section 5.1 & 5.2 | **Conflation of Universal Hash Facts with Policy Rules:** Treated business rules as mathematical invariants. | Medium | Ambiguity regarding when candidate-baseline equality is allowed vs prohibited; conflated hash match with inode identity. | Formally separate content-hash facts from Zentra policies; codify when live-discard inequality is mandatory; enforce on-disk provenance. |
| **FIND-AK4** | Step AO-AJ<br/>Section 6.1 | **Unverified Runtime Claims for Win32 HResults:** Presented HResult exception mappings as confirmed facts. | Low | Mappings conform to documentation but have not been validated by execution on host PowerShell 5.1. | Formally label all exception mappings as "SPECIFIED — NOT RUNTIME-VERIFIED ON LIVE HOST IN THIS STEP". |
| **FIND-AK5** | Step AO-AJ<br/>Section 7.2 | **PowerShell 5.1 Argument Tokenizer Boundaries:** Did not fully document secondary parser quote stripping. | Medium | Unescaped outer quotes could be stripped by PowerShell's command-line parser before script invocation. | Refine argument harness specification; explicitly mark harness and all test vectors UNTESTED. |
| **FIND-AK6** | Step AO-AJ<br/>Section 8 | **Missing Test Coverage for Edge Scenarios:** Lacked specifications for ledger loss, breakaway children, and unverified HResults. | Medium | Critical failure paths unrepresented in deterministic test accounting. | Add 22 new deterministic test specifications (`DSP-243` to `DSP-264`); reconcile total specifications to 305. |

---

## 3. Finding AK-1 — Nonce Ledger Durability & Replay Boundaries

### 3.1 Durability Scoping: API Flush vs. Hardware Reality

A rigorous architectural distinction is established across three storage horizons:

1. **Successful API Flush (`FileStream.Flush(true)` / Win32 `FlushFileBuffers`):**  
   Confirms that the Win32 system call returned `STATUS_SUCCESS` (`0`). It proves that the Windows Cache Manager transferred dirty file pages to the storage device driver.
2. **OS / Filesystem Commitment (NTFS MFT & Journal):**  
   Confirms that NTFS updated the Master File Table (MFT) record for the file and committed the metadata transaction to the `$LogFile` journal. This guarantees survival across operating-system crashes (BSOD / software kernel crash).
3. **Hardware Power-Loss Durability (Physical NAND Cells):**  
   Consumer workstation SSDs buffer write operations in volatile onboard DRAM. **Without enterprise Power-Loss Protection (PLP / supercapacitors), a sudden loss of electrical power can drop unflushed controller cache data.** On consumer hardware ($0 budget), physical media durability across sudden power loss cannot be guaranteed by software.

### 3.2 The Poisoned Tombstone Contract & Its True Limits

Step AO-AJ established that a 0-byte file created via `[System.IO.FileMode]::CreateNew` acts as a poisoned tombstone. Step AO-AK formally establishes its operational boundaries:

```
[Poisoned Nonce Ledger Boundary Contract]
  Scenario A: Intact Filesystem Instance (Normal & Crash Restart)
    - 0-byte file exists in D:\Zentra\logs\forensics\.consumed_nonces\<nonce>
    - Any subsequent deployment attempting to use this nonce executes FileMode::CreateNew
    - Windows NTFS returns ERROR_FILE_EXISTS (0x80070050) -> IOException
    - Nonce consumption is BLOCKED -> System fails closed to Exit Code 1.
    - VERDICT: Replay protection is 100% EFFECTIVE on intact local filesystem.

  Scenario B: Ledger Directory Missing / Unreadable / Restored
    - Sub-case B1: Administrator deletes .consumed_nonces directory.
    - Sub-case B2: VM snapshot rolled back to state prior to nonce creation.
    - Sub-case B3: Host backup restored from older tape/image.
    - Result: The 0-byte tombstone NO LONGER EXISTS on disk!
    - VERDICT: Local filesystem ledger CANNOT prevent replay across external disk resets!
    - DEFENSE: The secondary gate (300-second freshness window) MUST reject payloads older than 300s!
```

### 3.3 Fail-Closed Ledger Validation Protocol

The entrypoint (`Invoke-DeployPostgresConfigV5`) must execute the following validation sequence before consuming a nonce:

```powershell
# [NOT EXECUTED — UNTESTED OPERATIONAL SPECIFICATION]

function Assert-NonceLedgerIntegrity {
    param([string]$LedgerDirectory)

    # 1. Directory Existence Check
    if (-not [System.IO.Directory]::Exists($LedgerDirectory)) {
        throw [System.IO.DirectoryNotFoundException]::new("LEDGER_DIRECTORY_MISSING")
    }

    # 2. Reparse Point Check (Anti-Junction Hijack)
    $dirInfo = [System.IO.DirectoryInfo]::new($LedgerDirectory)
    if (($dirInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw [System.Security.SecurityException]::new("LEDGER_DIRECTORY_IS_REPARSE_POINT")
    }

    # 3. Read/Write Sanity Probe
    try {
        $acl = $dirInfo.GetAccessControl()
        if ($null -eq $acl) { throw [System.UnauthorizedAccessException]::new("LEDGER_ACL_UNREADABLE") }
    }
    catch {
        throw [System.UnauthorizedAccessException]::new("LEDGER_DIRECTORY_ACCESS_DENIED", $_.Exception)
    }
}
```

If `Assert-NonceLedgerIntegrity` throws any exception:
- The entrypoint **immediately halts fail-closed**.
- Exit Code `104` is **strictly withheld**.
- Process exits with Exit Code `1` (Manual Recovery Active).

---

## 4. Finding AK-2 — Process Identity & Process-Tree Cleanup

### 4.1 The PID Recycling Race: Why Pre-Checks Cannot Guarantee Safety

In Windows user-mode programming, Process IDs (PIDs) are non-unique, recycled integers. Step AO-AJ suggested capturing `TargetProcess.StartTime` before executing `taskkill.exe`.

#### The Architectural Defect
- PowerShell can check `StartTime`, confirm `HasExited == false`, and construct the command string `taskkill.exe /PID $PID /T /F`.
- However, `taskkill.exe` is an **independent external executable**.
- When PowerShell calls `Process.Start("taskkill.exe", ...)`, Windows creates a new process, sets up standard I/O pipes, and schedules `taskkill.exe`.
- **During this scheduling delay (1–50 milliseconds), the target process can exit naturally, and the Windows kernel can allocate that exact PID to an entirely different process!**
- `taskkill.exe` opens the process by PID integer using `OpenProcess(PROCESS_TERMINATE, ...)`. It has **no parameter to verify process creation time**.
- **Conclusion:** A pre-check in PowerShell *reduces the window of exposure*, but **cannot make PID-based CLI termination identity-safe**. True identity-safe termination on Windows requires holding an open Win32 process handle (`SafeProcessHandle`) or utilizing Windows Job Objects.

### 4.2 Comprehensive Process Cleanup State Taxonomy

The runner must classify process termination outcomes into seven distinct states:

| State Code | Descriptive State | Observed Conditions | Child Root Status | Descendant Status | Pipeline Action |
|---|---|---|---|---|---|
| **STATE-CL1** | `CONFIRMED_TREE_TERMINATED` | `taskkill` exited with code `0`; async pipes drained cleanly. | Confirmed Dead | Confirmed Dead | Safe to proceed with failure handling. Downstream blocked. |
| **STATE-CL2** | `ROOT_ALREADY_EXITED_UNCERTAIN` | Target process `HasExited == true` before kill, or `taskkill` returned `128`. | Confirmed Dead | **UNCERTAIN (Orphans may exist)** | Fail-closed: classify as `PROCESS_CLEANUP_UNCERTAIN`. Downstream blocked. |
| **STATE-CL3** | `BREAKAWAY_DESCENDANTS_ESCAPED` | Descendants created with `CREATE_BREAKAWAY_FROM_JOB` or detached. | Dead | **ALIVE (Orphaned)** | Fail-closed: classify as `PROCESS_CLEANUP_UNCERTAIN`. Downstream blocked. |
| **STATE-CL4** | `TASKKILL_TIMEOUT_EXCEEDED` | `taskkill.exe` did not exit within 5000ms. | Uncertain | Uncertain | Fail-closed: kill `taskkill`, emit fatal tooling error. Downstream blocked. |
| **STATE-CL5** | `TASKKILL_LAUNCH_FAILED` | Binary missing, blocked by AppLocker/WDAC, or permission denied. | Uncertain | Uncertain | Fail-closed: emit fatal tooling error. Downstream blocked. |
| **STATE-CL6** | `PIPE_READER_FAILED` | Async pipe reader encountered broken stream or deadlock. | Uncertain | Uncertain | Fail-closed: emit fatal tooling error. Downstream blocked. |
| **STATE-CL7** | `TASKKILL_NONZERO_EXIT` | `taskkill` returned code other than `0` (e.g. exit code 1 access denied). | Uncertain | Uncertain | Fail-closed: classify as `PROCESS_CLEANUP_UNCERTAIN`. Downstream blocked. |

### 4.3 The Strict Downstream Lockout Rule

Under no circumstances may downstream operations continue unless process cleanup is resolved:
- **Rule:** If process cleanup results in any state other than `STATE-CL1` (`CONFIRMED_TREE_TERMINATED`), the parent runner **MUST classify the run as `PROCESS_CLEANUP_UNCERTAIN`**.
- **Enforcement:**
  1. Subsequent database migrations (`Migrate-Database`) are **STRICTLY CANCELLED**.
  2. PostgreSQL service restarts / reloads are **STRICTLY PROHIBITED**.
  3. Automated CI/CD pipeline retries are **STRICTLY LOCKED OUT**.
  4. An incident report is generated directing a human operator to inspect Windows Task Manager / Process Explorer before any further commands are issued.

---

## 5. Finding AK-3 — Rollback Hash Policy & Evidence Consistency

### 5.1 Universal Cryptographic Facts vs. Zentra Operational Policies

| Relationship / Invariant | Classification | Mathematical & System Reality | Zentra Operational Policy Context |
|---|---|---|---|
| $\text{ComputedLiveHash} = \text{RestoredLiveHash}$ | **Universal Fact** | SHA-256 computation proves live file bytes match claimed restored bytes. | Independent verification that live file matches dispatcher evidence. |
| $\text{ComputedLiveHash} = \text{ExpectedBaselineHash}$ | **Universal Fact** | SHA-256 computation proves live file bytes match pre-change golden baseline. | Verifies PostgreSQL cluster is returned to known baseline state. |
| $\text{ComputedDiscardHash} = \text{DiscardHash}$ | **Universal Fact** | SHA-256 computation proves discard file bytes match claimed discard bytes. | Verifies discard artifact was written and not corrupted. |
| $\text{ComputedDiscardHash} = \text{CandidateHash}$ | **Universal Fact** | SHA-256 computation proves discard file contains the rejected candidate. | Verifies forensic evidence contains the exact candidate configuration. |
| $\text{CandidateHash} \neq \text{ExpectedBaselineHash}$ | **Operational Policy** | Filesystem allows swapping identical files; mathematically possible. | **Zentra Policy Invariant:** No-op deployments are invalid operational tickets. Must be trapped at pre-flight (`PF-1B`). Rollback of identical file indicates state corruption (`State 5D`). |
| $\text{ComputedLiveHash} \neq \text{ComputedDiscardHash}$ | **Physical Sanity Fact** | If hashes are identical, live file and discard file are the same configuration. | **Mandatory Rollback Fact:** In a verified rollback, the live file (baseline) and discard file (candidate) **MUST NOT match**. If they match, either the live file was not restored, or the discard file was overwritten with baseline! |

### 5.2 Mandatory On-Disk Verification Before Outcome 4

Outcome 4 ("Rollback Verified Clean") can **NEVER** be authorized based on in-memory claims alone:
- **Invariant:** The physical disk state must be independently read and measured by the entrypoint.
- **Fail-Closed Condition:** If any hash comparison fails, if hash metadata is missing from the evidence object, if files are inaccessible, or if path aliasing is detected:
  - Outcome 4 is **STRICTLY UNAVAILABLE**.
  - Entrypoint emits Exit Code `1` (Manual Recovery Active).

---

## 6. Finding AK-4 — Filesystem Exception Classification: Specified vs. Runtime-Verified

### 6.1 Status Designation: Specification-Level Mappings

The following Win32 HResult mappings are derived from Microsoft .NET and Win32 Base Services documentation. To maintain absolute engineering integrity, **all mappings below are designated as SPECIFIED — NOT RUNTIME-VERIFIED ON LIVE HOST IN THIS STEP**:

| Exception Type | Target HResult | Win32 Error Symbolic Name | Specified Diagnostic Classification | Verification Status |
|---|---|---|---|---|
| `System.IO.IOException` | `0x80070020` | `ERROR_SHARING_VIOLATION` | `ENTRYPOINT_REVAL_SHARING_VIOLATION` | **SPECIFIED — NOT RUNTIME-VERIFIED** |
| `System.IO.IOException` | `0x80070021` | `ERROR_LOCK_VIOLATION` | `ENTRYPOINT_REVAL_LOCK_VIOLATION` | **SPECIFIED — NOT RUNTIME-VERIFIED** |
| `System.IO.IOException` | `0x80070070` | `ERROR_DISK_FULL` | `ENTRYPOINT_REVAL_DISK_FULL` | **SPECIFIED — NOT RUNTIME-VERIFIED** |
| `System.IO.IOException` | Other / Unmatched | Various / Generic | `ENTRYPOINT_REVAL_GENERIC_IO_ERROR` | **SPECIFIED — NOT RUNTIME-VERIFIED** |
| `System.IO.FileNotFoundException` | `0x80070002` | `ERROR_FILE_NOT_FOUND` | `ENTRYPOINT_REVAL_FILE_MISSING` | **SPECIFIED — NOT RUNTIME-VERIFIED** |
| `System.IO.DirectoryNotFoundException`| `0x80070003` | `ERROR_PATH_NOT_FOUND` | `ENTRYPOINT_REVAL_DIR_MISSING` | **SPECIFIED — NOT RUNTIME-VERIFIED** |
| `System.UnauthorizedAccessException` | `0x80070005` | `ERROR_ACCESS_DENIED` | `ENTRYPOINT_REVAL_ACCESS_DENIED` | **SPECIFIED — NOT RUNTIME-VERIFIED** |
| `System.IO.PathTooLongException` | `0x800700CE` | `ERROR_FILENAME_EXCED_RANGE` | `ENTRYPOINT_REVAL_PATH_TOO_LONG` | **SPECIFIED — NOT RUNTIME-VERIFIED** |
| `System.Security.SecurityException` | Unspecified | Reparse Point Violation | `ENTRYPOINT_REVAL_REPARSE_POINT_REJECTED` | **SPECIFIED — NOT RUNTIME-VERIFIED** |

---

## 7. Finding AK-5 — Argument-Echo Harness Specification & PowerShell 5.1 Boundaries

### 7.1 PowerShell 5.1 Command-Line Tokenizer Boundaries

When invoking `powershell.exe -File script.ps1 <args>`, argument parsing traverses two distinct software layers:
1. **Layer 1: Windows C Runtime (`CommandLineToArgvW`):**  
   Governs how `powershell.exe` parses its own startup parameters (`-NoProfile`, `-File`, script path).
2. **Layer 2: PowerShell Engine Tokenizer:**  
   Once `powershell.exe` identifies the target script, it parses the remaining command-line tail and binds values to script parameters.
   - **Outer Quote Stripping:** PowerShell's parameter binder strips outer bounding double quotes before binding to `[string]` variables.
   - **Embedded Quotes:** Inner quotes must be escaped with `\"` or repeated quotes (`""`), depending on whether they pass through PowerShell or standard C runtime.
   - **PowerShell Expansion Sigils:** Characters such as `$`, `` ` ``, and `$()` are subject to variable expansion unless passed with strict literal escaping.

### 7.2 The ASCII/Base64 Echo Harness Contract (`Test-EchoArgsV3.ps1`)
- **Status:** **UNTESTED SPECIFICATION ONLY — NOT EXECUTED.**
- The harness serializes captured parameters strictly as ASCII Base64 strings.
- This isolates the diagnostic payload from console code page mangling (`CP437` vs `UTF-8`).
- The test harness asserts that every byte received in the child script matches the input byte array exactly.

---

## 8. Deterministic Test Matrix Expansion (`DSP-243` through `DSP-264`)

Twenty-two new deterministic test specifications are added covering ledger loss, snapshot rollback, PID reuse race conditions, breakaway descendants, unverified HResult classifications, and argument edge cases:

| Test ID | Component / Boundary | Injected Fault / Scenario | Expected Execution Behavior | Target State | Mapped Diagnostic Classification | Physical Disk / Process State Guarantee |
|---|---|---|---|---|---|---|
| **DSP-243** | Nonce Ledger | Nonce ledger directory missing during entrypoint revalidation | `DirectoryNotFoundException` trapped; entrypoint halts fail closed | **Caller Fatal** | `LEDGER_DIRECTORY_MISSING` | Exit Code 1 emitted. Outcome 4 blocked. |
| **DSP-244** | Nonce Ledger | VM snapshot restored; pre-snapshot nonce reused | Dual-gated freshness check traps timestamp age > 300s; aborts | **Replay Trapped**| `REJECTED_STALE_EVIDENCE` | Stale replay blocked by time ceiling. |
| **DSP-245** | Nonce Ledger | Ledger directory unreadable due to NTFS ACL restriction | `UnauthorizedAccessException` trapped; entrypoint halts fail closed | **Caller Fatal** | `LEDGER_DIRECTORY_ACCESS_DENIED`| Exit Code 1 emitted. Outcome 4 blocked. |
| **DSP-246** | Nonce Ledger | Administrator deletes 0-byte tombstone; attacker replays payload | Freshness check traps timestamp > 300s; aborts | **Replay Trapped**| `REJECTED_STALE_EVIDENCE` | Deleted tombstone cannot enable replay of expired payload. |
| **DSP-247** | Nonce Ledger | Hardware storage write failure occurs during ledger flush | `FlushFileBuffers` failure caught; aborts without Exit 104 | **Caller Fatal** | `NONCE_FLUSH_FAILURE` | Outcome 4 never emitted without verified OS flush. |
| **DSP-248** | Process Cleanup | Child PID recycled by kernel; pre-check detects `StartTime` divergence | Pre-check traps PID reuse; aborts `taskkill` invocation | **Parent Fatal** | `PID_REUSE_DETECTED` | Innocent process protected from termination. |
| **DSP-249** | Process Cleanup | Target root process dead before kill; `taskkill` exits with code 128 | Runner treats 128 as uncertain; halts fail closed | **Parent Fatal** | `PROCESS_CLEANUP_UNCERTAIN` | Orphaned descendants guarded; migrations blocked. |
| **DSP-250** | Process Cleanup | Descendant spawned with `CREATE_BREAKAWAY_FROM_JOB` survives | Runner treats unverified tree as uncertain cleanup; fails closed | **Parent Fatal** | `PROCESS_CLEANUP_UNCERTAIN` | Escape detected; migrations blocked. |
| **DSP-251** | Process Cleanup | `taskkill.exe` child stdout pipe reader encounters stream exception | Async reader catches error; runner treats cleanup as uncertain | **Parent Fatal** | `PIPE_READER_FAILED` | Tooling failure handled cleanly; fail closed. |
| **DSP-252** | Process Cleanup | `taskkill.exe` hangs exceeding 5000ms boundary | `WaitForExit(5000)` returns false; taskkill killed; status uncertain | **Parent Fatal** | `TASKKILL_TIMEOUT_EXCEEDED` | Deadlock prevented; migrations blocked. |
| **DSP-253** | Downstream Guard | Parent runner encounters `ROOT_VANISHED_DESCENDANTS_UNCERTAIN` | Runner blocks downstream migrations and locks deployment pipeline | **Parent Fatal** | `DOWNSTREAM_MIGRATIONS_BLOCKED`| Zero SQL commands executed. PostgreSQL cluster protected. |
| **DSP-254** | Pre-Flight Policy| No-op deployment ticket with candidate identical to baseline | Pre-flight PF-1B short-circuits with benign exit; no rollback initialized| **Pre-Flight Pass**| `PREFLIGHT_CANDIDATE_IDENTICAL_TO_BASELINE`| Live file untouched; golden backup skipped. |
| **DSP-255** | Rollback Policy | Rollback dispatcher encounters candidate identical to baseline | Engine classifies identical hashes as fatal corruption (State 5D) | **State 5D** | `INVARIANT_CANDIDATE_EQUALS_BASELINE`| Rollback corruption trapped fail-closed. |
| **DSP-256** | Physical Sanity | Entrypoint detects `ComputedLiveHash == ComputedDiscardHash` | Sanity check fails; discard contains live configuration; aborts | **State 5D** | `ENTRYPOINT_REVAL_LIVE_EQUALS_DISCARD` | Physical separation failure trapped fail-closed. |
| **DSP-257** | Evidence Check | Discard hash metadata missing or null in evidence object | Validator throws `ArgumentException`; entrypoint halts fail closed | **Caller Fatal** | `EVIDENCE_METADATA_MALFORMED` | Malformed evidence rejected. Exit Code 1 emitted. |
| **DSP-258** | Exception Spec | Unverified Win32 HResult `0x80070020` encountered | Catch block routes to specified-only sharing violation classification | **State 5B** | `ENTRYPOINT_REVAL_SHARING_VIOLATION`| Specified mapping logged; Incident Commander alerted. |
| **DSP-259** | Exception Spec | Unverified Win32 HResult `0x80070070` encountered | Catch block routes to specified-only disk full classification | **State 5B** | `ENTRYPOINT_REVAL_DISK_FULL` | Specified mapping logged; Incident Commander alerted. |
| **DSP-260** | Exception Spec | Unknown CLR runtime exception encountered during revalidation | Catch default routes to generic I/O classification; fails closed | **State 5B** | `ENTRYPOINT_REVAL_GENERIC_IO_ERROR` | Unknown failure mapped safely to fail-closed state. |
| **DSP-261** | Argument Spec | Empty string `""` passed to argument echo harness | Child binds parameter as length-0 string, not `$null` | **Parent Pass** | `ARG_EMPTY_STRING_VERIFIED` | Parameter binding fidelity verified in specification. |
| **DSP-262** | Argument Spec | Path with trailing backslash passed through PowerShell parser | Win32 escaping preserves backslash without quote stripping | **Parent Pass** | `ARG_TRAILING_SLASH_VERIFIED` | Delimiter integrity verified in specification. |
| **DSP-263** | Argument Spec | Multi-byte UTF-8 Unicode path passed through echo harness | ASCII Base64 stream isolates characters from console OEM distortion | **Parent Pass** | `ARG_UNICODE_OEM_ISOLATED` | Unicode byte fidelity verified in specification. |
| **DSP-264** | Argument Spec | Complex nested single and double quotes passed in argument | Escaping rules preserve quote hierarchy without command injection | **Parent Pass** | `ARG_NESTED_QUOTES_VERIFIED` | Injection safety verified in specification. |

*Note: All 22 specifications above, and all preceding specifications in the suite (`DSP-01` through `DSP-242`), are strictly **[NOT EXECUTED — UNTESTED]**.*

---

## 9. Untested Claims, Residual Risks & Arithmetic Reconciliation

### 9.1 Reconciled 4-Dimensional Engineering Accounting Model

To maintain complete mathematical consistency across structural design metrics, semantic runtime paths, and test suites:

```
+---------------------------------------------------------------------------------------------+
|                               TEST SUITE SPECIFICATION TOTALS                               |
+---------------------------------------------------------------------------------------------+
| Suite 1: In-Function Discard Pre-Flight Suite (DSP-PF-01 .. DSP-PF-34)      :   34 tests    |
| Suite 2: Outer-Dispatch Architectural Suite (DSP-01 .. DSP-264)             :  264 tests    |
| Suite 3: Legacy Recovery Diagnostic Suite (REC-01 .. REC-07)                :    7 tests    |
+---------------------------------------------------------------------------------------------+
| TOTAL FORMALLY SPECIFIED TESTS (ALL MARKED [NOT EXECUTED — UNTESTED])       :  305 tests    |
+---------------------------------------------------------------------------------------------+
| Core Structural AST Decision Points (54 + 17 + 7 + 55)                      :  133 points   |
| Entrypoint & Runner AST Decision Points (24 + 20)                           :   44 points   |
| TOTAL ORCHESTRATION AST DECISION POINTS (133 + 44)                          :  177 points   |
+---------------------------------------------------------------------------------------------+
| Semantic Pipeline Outcome Paths (50 + 19 + 55 + 7 + 35 + 12 + 10)           :  188 paths    |
+---------------------------------------------------------------------------------------------+
```

#### Detailed Accounting Reconciliation

1. **Syntactic AST Structural Decision Points:**
   - Pre-Flight Replacement Engine (`Invoke-SafeConfigReplacementV22`): **54 decision points**
   - Replacement Swap & Post-Swap Live Inspection: **17 decision points**
   - Recovery Boundary Non-Mutating Diagnostics: **7 decision points**
   - Rollback Dispatcher V37 (`Dispatch-RollbackResultV37`): **55 decision points**
   - Entrypoint Dual-File Cryptographic Revalidation & Ledger (`Invoke-DeployPostgresConfigV5`): **24 decision points** (expanded from 22)
   - Parent Runner & Deadlock-Free Process-Tree Teardown (`Invoke-ParentDeploymentRunnerV5` & `Stop-ProcessTreeSafelyV3`): **20 decision points** (expanded from 18)
   - **Core Subtotal:** $54 + 17 + 7 + 55 = \mathbf{133\text{ AST decision points}}$.
   - **Total Full-Pipeline Orchestration:** $133 + 24 + 20 = \mathbf{177\text{ AST decision points}}$.
2. **Semantic Pipeline Outcome Paths:**
   - Pre-Flight Replacement Outcomes: **50 paths**
   - Replacement Swap & Post-Swap Outcomes: **19 paths**
   - Rollback Engine Internal Return Paths: **55 paths**
   - Recovery Diagnostic Outcomes: **7 paths**
   - Outer Dispatcher Discard Validation Outcomes: **35 paths** (`DISC-01` through `DISC-35`)
   - Entrypoint Revalidation & Nonce Durability Outcomes: **12 paths** (expanded from 10)
   - Parent Runner Process Cleanup & Downstream Guard Outcomes: **10 paths** (expanded from 8)
   - **Total Semantic Outcome Paths:** $50 + 19 + 55 + 7 + 35 + 12 + 10 = \mathbf{188\text{ paths}}$.
3. **Defined Test Specifications:**
   - Suite 1 (Pre-Flight Suite): `DSP-PF-01` through `DSP-PF-34` (**34 specifications**)
   - Suite 2 (Outer Dispatch Suite): `DSP-01` through `DSP-264` (**264 specifications**, expanded from 242)
   - Suite 3 (Recovery Diagnostic Suite): `REC-01` through `REC-07` (**7 specifications**)
   - **Total Test Specifications:** $34 + 264 + 7 = \mathbf{305\text{ specifications}}$.
4. **Executed Operational Tests:**
   - **ZERO (0) EXECUTED.** All 305 specifications remain strictly **`[NOT EXECUTED — UNTESTED]`**.

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

Upon formal human review and approval of this Step AO-AK audit report:
- **Recommended Next Step:** Author the comprehensive **Manual Restoration Protocol Runbook** ([`docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md`](file:///d:/Zentra/docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md)) to resolve `BLOCKER-1`, incorporating the complete 35-class discard artifact taxonomy, forensic log inspection procedures, poisoned-nonce ledger rules, deadlock-free process-tree termination procedures, and Human Incident Commander sign-off runbooks prior to considering Gate 5 authorization.

---

```
STOP — STEP 2D-2A-AO-AK COMPLETE — WAITING FOR HUMAN REVIEW
```
