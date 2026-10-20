# MUSE SPARK — ZENTRA STEP 2D-2A
## MANUAL RESTORATION AND RECOVERY PROTOCOL RUNBOOK

**Document ID:** `MUSE_SPARK_STEP2D_2A_RUNBOOK`  
**Revision Identifier:** `MUSE_SPARK_STEP2D_2A_RUNBOOK_REV_AP_AH`  
**Target Repository:** `D:\Zentra`  
**Target Component:** Local PostgreSQL Configuration & Security Preparation Workflow  
**Primary Target Files:** `postgresql.conf`, `pg_hba.conf`  
**Target Environment:** Local Windows Workstation (`127.0.0.1:5432`)  
**Status:** RECONCILED SPECIFICATION (STEP AP-AH) — STRICTLY UNTESTED  
**Operational Approval:** NOT GRANTED — THIS DOCUMENT DOES NOT AUTHORIZE EXECUTION  
**Budget Constraint:** Strict ₹0/month (Zero cost, no credit cards, no paid services)  

---

## 1. Purpose & Safety Boundary

### 1.1 Purpose
This runbook establishes a deterministic, fail-closed, human-in-the-loop manual restoration and incident recovery protocol for the ZENTRA local PostgreSQL database environment. It defines the authoritative operational procedures for human Incident Commanders and system administrators when automated deployment, replacement, or rollback mechanisms encounter indeterminate states, hardware faults, process timeouts, or cryptographic mismatches.

### 1.2 Absolute Safety Boundary & Non-Authorization Notice
> [!CAUTION]
> **THIS DOCUMENT DOES NOT AUTHORIZE OPERATIONAL EXECUTION.**  
> The presence, review, or approval of this documentation does **not** grant authorization to execute live PowerShell scripts, run database migrations, alter host firewall rules, reconfigure PostgreSQL, or initiate service restarts. Operational execution requires explicit, separate Human Incident Commander authorization at each designated gate.

### 1.3 Preserved Infrastructure & Application Catalogs
Under all circumstances, the following application databases running on the local PostgreSQL cluster (`127.0.0.1:5432`) must remain strictly untouched and preserved:
- `hisecure_erp`
- `hitech_platform`
- `zentra_test`

Any action that modifies, restarts, or impacts these catalogs without explicit isolated maintenance approval is strictly prohibited.

---

## 2. Prerequisites & Approval Gates

Operational execution of any restoration or maintenance procedure is governed by six strict human approval gates. No gate may be skipped, automated, or inferred:

```
[MUSE SPARK Human Approval Gate Progression]
  Gate 1: Pre-Flight Integrity Sign-Off
    └── Human operator inspects baseline hashes and active cluster status.
  Gate 2: Candidate Validation & Staging Sign-Off
    └── Human operator validates candidate configuration syntax and diffs.
  Gate 3: Pre-Swap Golden Backup Verification
    └── Human operator validates byte-for-byte golden backup on physical disk.
  Gate 4: Post-Swap Operational Assertion
    └── Human operator evaluates live deployment or rollback trigger.
  Gate 5: Incident Boundary & Discard Validation
    └── Human operator validates rollback evidence and discard artifact.
  Gate 6: Final Cluster Restoration Verification
    └── Human operator certifies clean baseline restoration before pipeline unlocks.
```

### 2.1 Gate Criteria Table

| Gate ID | Gate Name | Required Human Action | Mandatory Verification Artifact | Failure Action |
|---|---|---|---|---|
| **GATE-1** | Pre-Flight Integrity | Inspect running PostgreSQL service and verify read access to live configuration. | SHA-256 hash of live `postgresql.conf` recorded in forensic log. Live file probed under Tier 1 physical classification contract (zero access denied, sharing violations, lock violations, reparse points, or I/O faults). | Abort immediately; no files created or touched. |
| **GATE-2** | Candidate Validation | Verify candidate file format, UTF-8 encoding without BOM, and diff against baseline. | Validated candidate file hash; assert $\text{CandidateHash} \neq \text{BaselineHash}$. Candidate staging path verified under Tier 1 physical contract. | Abort; reject no-op or corrupt candidate tickets. |
| **GATE-3** | Golden Backup Verify | Confirm golden backup created with verified leaf file attributes and matching hash. | Golden backup file exists; hash equals baseline hash exactly. Golden backup leaf and path probed under Tier 1 physical filesystem classification contract: zero access denied (`0x80070005`), sharing violations (`0x80070020`), lock violations (`0x80070021`), reparse points (`ReparsePoint != 0`), missing parent directories, or generic I/O. Physical filesystem faults fail closed to dedicated Tier 1 states (`REC-STATE-06`, `13`, `14`, `07`, `08`, `09`, `12`), NOT missing backup or `REC-STATE-05`. | Abort before swap; discard candidate staging. |
| **GATE-4** | Execution Trigger | Monitor proposed configuration replacement or rollback trigger event. | Exit code and process return state intercepted by parent runner. | Enter Manual Recovery Boundary if state is indeterminate. |
| **GATE-5** | Discard Artifact Audit | Inspect discard artifact taxonomy (`DISC-01` through `DISC-35`) and consumed-nonce ledger record (`.consumed_nonces\<Nonce>`). | Discard file verified on disk (hash equals candidate; probed under Tier 1 physical filesystem classification contract); consumed-nonce record verified on disk (valid 9-field JSON schema, monotonic `history` array with valid sequence/status/timestamp, matching `operationId` and `targetConfigFile`, matching candidate/baseline hashes; initial consumption timestamp $t_1$ fresh within $|T_{\text{obs}} - t_1| \le 300\text{s}$ with future skew $\le 5\text{s}$ for active in-flight triage, noting 900s lifecycle duration strictly does NOT extend or override 300s active triage; or terminal transition timestamp $t_2$ fresh within $|T_{\text{obs}} - t_2| \le 300\text{s}$ with total lifecycle duration $0 \le t_2 - t_1 \le 900\text{s}$ for terminal assertion; valid lifecycle status compatible with live disk condition, non-reparse leaf); golden backup verified (hash equals baseline); baseline metadata valid. All four supporting artifacts probed under Tier 1 physical filesystem classification contract. | Halt fail-closed to Exit Code 1; lock deployment. Missing, malformed, unbound, stale ($>300\text{s}$ in-flight or $>900\text{s}$ lifecycle), or contradictory discard artifact or nonce ledger record strictly forbids automatic restoration and locks pipeline. Multi-Tier Failure Precedence: Tier 1 physical filesystem faults on ANY artifact probe — golden backup, nonce ledger, baseline metadata file, or discard artifact (`0x80070005` $\to$ `REC-STATE-06`, reparse point $\to$ `REC-STATE-07`, missing parent directory $\to$ `REC-STATE-08`, invalid path $\to$ `REC-STATE-09`, generic I/O $\to$ `REC-STATE-12`, `0x80070020` $\to$ `REC-STATE-13`, `0x80070021` $\to$ `REC-STATE-14`, or contradictory/indeterminate probe $\to$ `REC-STATE-05`) take absolute precedence over Tier 2 logical checks and Tier 3 missing-evidence checks, and must NEVER be inferred as file absence or routed to `REC-STATE-03`/`04`. Tier 2 nonce ledger, history, timestamp, and golden backup/metadata logical defects take strict precedence over Tier 3 missing discard artifacts. If any Tier 2 defect exists (missing/stale/unbound/contradictory nonce, corrupt backup, malformed metadata), execution halts strictly to `REC-STATE-05` (or `10`). If and only if Tier 1 and Tier 2 pass with zero defects across all artifacts, a corroborated missing discard file (`FileNotFoundException` with verified genuine non-reparse parent directory) routes to `REC-STATE-03` (`Live == Baseline`) or `REC-STATE-04` (`Live != Baseline`), while a readable discard file with corrupt hash/content halts to `REC-STATE-05`. If live target matches baseline and status is `CONSUMED` with discard verified, halts to `REC-STATE-16`. If target file is confirmed absent and discard evidence or any supporting evidence is missing, halts fail-closed to `REC-STATE-05`. |
| **GATE-6** | Cluster Sign-Off | Confirm live configuration restored and cluster operational. | All four mandatory supporting evidence items 100% verified with valid operation binding, active freshness ($|T_{\text{obs}} - t_1| \le 300\text{s}$) or terminal freshness ($|T_{\text{obs}} - t_2| \le 300\text{s}$ and $t_2 - t_1 \le 900\text{s}$), monotonic `history` array, and compatible status; all four supporting artifacts probed under Tier 1 physical classification contract (zero physical faults); live SHA-256 equals baseline; zero orphaned processes; sockets healthy. (Multi-Tier Failure Precedence: Tier 1 physical filesystem faults on ANY artifact take highest precedence. Any Tier 2 nonce ledger, golden backup, or baseline metadata defect halts strictly to `REC-STATE-05` or `10`, superseding any missing discard route. Clean baseline cluster sign-off strictly requires terminal status `ROLLED_BACK` or `DISCARDED` with valid 2-event history; if live target matches baseline and status is `CONSUMED` with discard verified, halts fail-closed to `REC-STATE-16` as an unfinalized in-flight ticket; if discard file is corroborated missing when live matches baseline and nonce is 100% valid/fresh, halts to `REC-STATE-03`; if discard file is corroborated missing on existing live candidate/divergent file and nonce is 100% valid/fresh, halts to `REC-STATE-04`; if readable discard file has corrupt hash/content, halts to `REC-STATE-05`; if target is confirmed absent with all evidence verified and status strictly `CONSUMED`, proposed recreation evaluates under `REC-STATE-01`; if target is confirmed absent with discard or any evidence missing, halts fail-closed to `REC-STATE-05`). | Escalate to Manual Restoration Protocol (Section 4). |

---

## 3. Pre-Change Evidence, Path Validation & Backup Requirements

### 3.1 Pre-Change Evidence Requirements
Before initiating any configuration replacement, the orchestrator and human operator must establish verified pre-change evidence:
1. **Live Configuration Baseline Hash (`ExpectedBaselineHash`):**  
   Computed via independent SHA-256 measurement of `postgresql.conf` before any operations begin. Must be validated format (64-character lowercase hex string).
2. **PostgreSQL Service State & Service Discovery Requirement:**  
   The active PostgreSQL Windows service must be confirmed in `Running` state.  
   > [!IMPORTANT]
   > **Service Identity Ambiguity Notice:** Historical project audit reports noted references to both `postgresql-x64-16` and `postgresql-x64-18`. Operators must **never assume either service name is universally correct**. A separately approved, read-only discovery command (`Get-Service -Name "postgresql*"`) and human confirmation are mandatory prior to any operational work. No service queries or modifications are performed in this documentation phase.
3. **Database Connectivity Assertion:**  
   Verify local socket connectivity on `127.0.0.1:5432` without modifying database state.
4. **Filesystem Path & Reparse Point Probes:**  
   The target directories (`D:\Zentra\database\config`, `.consumed_nonces`) and target files must be validated against the path integrity contract:
   - Must be canonicalized via `[System.IO.Path]::GetFullPath()`.
   - Must verify that `([System.IO.File]::GetAttributes($path) -band [System.IO.FileAttributes]::ReparsePoint) -eq 0`.
   - Must verify parent directory exists and is a genuine directory, not a junction.

### 3.2 Golden Backup Protocol
- **Destination:** `D:\Zentra\database\config\postgresql.conf.golden.<Timestamp>.<Nonce>`
- **Creation Mode:** Created using `[System.IO.FileMode]::CreateNew` with `FileShare.None`.
- **Verification Rule:** The golden backup must be re-read and hashed immediately after creation. If computed hash $\neq \text{ExpectedBaselineHash}$, the backup is invalid. Deployment aborts immediately.
- **Integrity Rule:** The existence of a file or a non-zero byte length (`Length > 0`) does **not** prove backup integrity. Complete SHA-256 verification against `ExpectedBaselineHash` is required.

### 3.3 Discard Artifact Taxonomy
When a rollback occurs, the candidate configuration must be discarded safely to a forensic archive:
- **Path Pattern:** `D:\Zentra\database\config\discarded\postgresql.conf.discard.<Timestamp>.<Nonce>`
- **Taxonomy:** The discard artifact must conform to the 35 distinct architectural outcome classes (`DISC-01` through `DISC-35`).

---

## 4. Manual Restoration Decision Tree

When automated deployment or rollback halts with Exit Code `1` (Manual Recovery Active), Exit Code `105` (Parameter Defect), or timeout, the human Incident Commander must execute this deterministic decision tree.

```
[Incident Commander Manual Restoration Decision Tree]
  Step 1: Inspect Child Exit Code & Error Stream
    ├── Exit Code 104 (Outcome 4 Claimed)? ──► PROCEED TO SECTION 7 (Entrypoint Revalidation)
    ├── Exit Code 105 (Binding Failure)?   ──► HALT: Parameter contract defect; check arguments.
    ├── Exit Code 1 (Manual Recovery)?     ──► PROCEED TO STEP 2 (Disk & Hash Triage)
    └── Null / Hang / Process Timeout?     ──► PROCEED TO STEP 4 (Process Tree Triage)
  
  Step 2: Physical Disk State & Hash Triage (Live Target Configuration File)
    ├── Corroborated Target Absence (FileNotFoundException) ──► Escalate: Target absent; verify parent folder & proceed to Step 3 for evidence triage
    ├── Missing Parent Directory (DirectoryNotFoundException) ─► HALT: Missing parent folder (REC-STATE-08)
    ├── Access Denied (UnauthorizedAccessException / 0x80070005) ► HALT: Permissions failure; do not overwrite (REC-STATE-06)
    ├── File Sharing Violation (IOException / 0x80070020) ────► HALT: Conflicting file handle open; triage (REC-STATE-13)
    ├── Byte-Range Lock Violation (IOException / 0x80070021) ──► HALT: Conflicting byte-range lock; triage (REC-STATE-14)
    ├── Reparse Point / Junction Infiltration ───────────────► SECURITY FAULT: Reparse point rejected (REC-STATE-07)
    ├── Invalid / Malformed Path Syntax ──────────────────────► HALT: Path string invalid (REC-STATE-09)
    ├── Verified Hash Match (Live == Baseline) ───────────────► Live matches baseline; DO NOT OVERWRITE; proceed to Step 3
    ├── Verified Candidate Match (Live == Candidate) ─────────► Live matches candidate (uncertified); DO NOT OVERWRITE; proceed to Step 3
    ├── Verified Hash Divergence (Live != Baseline & != Cand) ► Live diverges from both; DO NOT OVERWRITE; proceed to Step 3
    ├── Malformed Hash Metadata ──────────────────────────────► HALT: Corrupt forensic metadata (REC-STATE-10)
    ├── Hash Helper Failure ──────────────────────────────────► HALT: Helper crash; do not overwrite (REC-STATE-11)
    ├── Undetermined I/O Failure ─────────────────────────────► HALT: Unknown I/O error; do not overwrite (REC-STATE-12)
    └── Indeterminate / Contradictory Evidence ───────────────► CRITICAL FORENSIC HALT: Ambiguous evidence; escalate (REC-STATE-05)

  Step 3: Mandatory Supporting Evidence Triage (Authoritative Multi-Tier Precedence Hierarchy)
    ├── [TIER 1 SUPPORTING] All Supporting Artifacts Physical Filesystem Triage (EVALUATED FIRST ACROSS ALL ARTIFACTS):
    │     ├── Access Denied on Golden Backup, Nonce Ledger, Baseline File, or Discard (0x80070005) ► HALT: Access denied; do NOT infer absence (REC-STATE-06)
    │     ├── File Sharing Violation on Golden Backup, Nonce Ledger, Baseline File, or Discard (0x80070020) ► HALT: Open handle conflict (REC-STATE-13)
    │     ├── Byte-Range Lock Violation on Golden Backup, Nonce Ledger, Baseline File, or Discard (0x80070021) ► HALT: Range lock conflict (REC-STATE-14)
    │     ├── Reparse Point / Junction Violation on Any Supporting Artifact or Parent Folder ► SECURITY FAULT: Reparse point rejected (REC-STATE-07)
    │     ├── Missing Parent Directory on config\, .consumed_nonces\, or discarded\ (DirectoryNotFoundException) ► HALT: Parent directory missing (REC-STATE-08)
    │     ├── Invalid / Malformed Path Syntax on Any Supporting Artifact Path ───────────────► HALT: Path string invalid (REC-STATE-09)
    │     ├── Undetermined Generic I/O Failure on Any Supporting Artifact Probe ─────────────► HALT: Unknown I/O error; do not infer absence (REC-STATE-12)
    │     └── Indeterminate / Contradictory Physical Probe on Any Supporting Artifact ──────► CRITICAL FORENSIC HALT: Ambiguous probe (REC-STATE-05)
    ├── [TIER 2] Nonce Ledger, Timestamp, History & Golden Backup / Metadata Logical Defects (EVALUATED ONLY IF TIER 1 PASSES):
    │     ├── Golden Backup Corroborated Absent (FileNotFoundException) or SHA-256 Mismatch ─► HALT: Golden backup corrupt/missing; LOCK PIPELINE (REC-STATE-05)
    │     ├── Baseline Metadata Missing, Unparseable, or Malformed JSON Payload ─────────────► HALT: Corrupt baseline metadata; LOCK PIPELINE (REC-STATE-10)
    │     ├── Nonce Record Corroborated Absent, Unparseable, or Schema Invalid ──────────────► HALT: Nonce ledger missing/malformed; LOCK PIPELINE (REC-STATE-05)
    │     ├── Nonce Record Unbound (operationId, targetConfigFile, or hash mismatch) ────────► HALT: Unbound nonce record; LOCK PIPELINE (REC-STATE-05)
    │     ├── Timestamp Defect (Future skew > 5s, Stale in-flight > 300s, Malformed syntax) ─► HALT: Stale/skewed timestamp; LOCK PIPELINE (REC-STATE-05)
    │     ├── History Invariant Violation (Non-monotonic, Clock rollback t2 < t1, Duration > 900s, Seq 1 not CONSUMED, Length > 2) ► HALT: Corrupt history; LOCK PIPELINE (REC-STATE-05)
    │     ├── Contradictory Status vs Disk (DISCARDED or ROLLED_BACK on Candidate, Divergent, or Absent Target) ► HALT: Contradictory status; LOCK PIPELINE (REC-STATE-05)
    │     └── Target Absent with ANY Tier 2 Defect ──────────────────────────────────────────► CRITICAL FORENSIC HALT: Target absent + corrupt ledger/backup; strictly forbid recreation; LOCK PIPELINE (REC-STATE-05)
    ├── [TIER 3] Corroborated Missing Discard Artifact or Content Inversion (EVALUATED ONLY IF TIERS 1 & 2 PASS FOR ALL ARTIFACTS):
    │     ├── Target Confirmed Absent + Discard Corroborated Absent ─────────────────────────► CRITICAL FORENSIC HALT: Target absent + missing discard; strictly forbid recreation; LOCK PIPELINE (REC-STATE-05)
    │     ├── Live == Baseline + Discard Corroborated Absent (Nonce 100% Valid & Fresh) ─────► HALT: Discard absent; preserve live; LOCK PIPELINE (REC-STATE-03)
    │     ├── Live != Baseline (Candidate/Divergent) + Discard Corroborated Absent (Nonce 100% Valid & Fresh) ► HALT: Discard absent; preserve live; LOCK PIPELINE (REC-STATE-04)
    │     ├── Readable Discard File with Hash Mismatch (SHA-256 != CandidateHash) ───────────► HALT: Corrupt discard content; LOCK PIPELINE (REC-STATE-05)
    │     └── Readable Discard File with Inversion (SHA-256 == ExpectedBaselineHash) ────────► INVERSION DETECTED: Audit golden backup source; LOCK PIPELINE (REC-STATE-05)
    │     (Precedence Guarantee: Tier 1 physical faults on any artifact route strictly to Tier 1 states; Tier 2 logical defects halt to REC-STATE-05/10; Tier 3 missing discard NEVER masks Tier 1 or Tier 2 defects)
    └── [TIER 4] ALL 4 Supporting Artifacts 100% Verified with Valid Binding, Freshness, History & Status (EVALUATED ONLY IF TIERS 1-3 PASS):
          ├── Live == Baseline & Status in {ROLLED_BACK, DISCARDED} (history seq 1 & 2) ► Clean operational baseline verified; proceed to Gate 6 sign-off (Section 7)
          ├── Live == Baseline & Status == CONSUMED (history seq 1) ──► HALT: Unfinalized in-flight ticket active on baseline live file; preserve live; LOCK PIPELINE (REC-STATE-16)
          ├── Live == Candidate & Status == CONSUMED (history seq 1) ──► Proposed Human Restoration (Unpromoted Candidate Active) under Gate 6 & Sec 4.3 (REC-STATE-15; Status MUST be CONSUMED; DISCARDED or ROLLED_BACK routes to REC-STATE-05)
          ├── Live != Baseline & Live != Candidate & Status == CONSUMED ─► Proposed Human Restoration (Divergent State) under Gate 6 & Sec 4.3 (REC-STATE-02; Status MUST be CONSUMED; DISCARDED or ROLLED_BACK routes to REC-STATE-05)
          └── Target Confirmed Absent & Status == CONSUMED ───► Proposed Human Recreation under Gate 6 & Sec 4.3 (REC-STATE-01; Status MUST be CONSUMED; DISCARDED or ROLLED_BACK routes to REC-STATE-05)

  Step 4: Orphaned Process & File Lock Triage
    ├── Execute Process Explorer / Task Manager audit.
    ├── Search for processes holding open handles (0x80070020) or byte-range locks (0x80070021).
    └── Terminate confirmed orphaned descendant workers only after verified PID and StartTime match (Section 6.4).
```

### 4.1 Fail-Closed Physical Filesystem Classification Contract & State Matrix

#### Physical Filesystem Classification Contract
Operators and automated harnesses must never infer physical file absence from `[System.IO.File]::Exists($path) -eq $false` alone. .NET's `File.Exists()` suppresses underlying Win32 errors (including `ERROR_ACCESS_DENIED`, `ERROR_PATH_NOT_FOUND`, and `ERROR_SHARING_VIOLATION`), returning `false` for permissions failures, long paths, and low-level I/O faults. 

Physical filesystem triage applies uniformly to all critical files in the restoration protocol — the live configuration target (`postgresql.conf`, `pg_hba.conf`), the golden backup file (`postgresql.conf.golden.<Timestamp>.<Nonce>`), the consumed-nonce ledger record (`.consumed_nonces\<Nonce>`), the baseline metadata file, and the discard artifact (`postgresql.conf.discard.<Timestamp>.<Nonce>`). Triage must map deterministically to one of ten distinct outcomes, establishing precisely what the observed error proves and what remains uncertain:

1. **Confirmed Missing Target (`CONFIRMED_MISSING_FILE`):**
   - *Observed Evidence:* `FileNotFoundException` / Win32 `ERROR_FILE_NOT_FOUND` (2) returned upon direct file open, combined with confirmed positive read access to the parent directory and non-reparse point directory attributes.
   - *Establishes:* Target file was absent from the verified parent directory at the moment of inspection.
   - *Does NOT Establish:* Permanent absence across future handle calls (user-mode TOCTOU Window C/D); does not establish parent directory permanence across handle closures.
   - *Uncertainties Remaining:* Concurrency state between inspection and subsequent operations remains subject to user-mode race conditions.
   - *Required Action:* **MANDATORY HUMAN ESCALATION (Section 12 Trigger #2; `REC-STATE-01`).** Recreation is strictly a *proposed, separately approved human recovery decision* under Gate 6 and Section 4.2 / 4.3 if and only if all four supporting artifacts from the authoritative list (golden backup, discard artifact, baseline metadata, and consumed-nonce ledger record) are independently verified. Automatic restoration is strictly prohibited.
2. **Confirmed Missing Parent Directory (`CONFIRMED_MISSING_DIRECTORY`):**
   - *Observed Evidence:* `DirectoryNotFoundException` / Win32 `ERROR_PATH_NOT_FOUND` (3).
   - *Establishes:* One or more parent directory segments in the path do not exist at read time.
   - *Does NOT Establish:* Root volume damage or failure; does not establish whether the directory was deleted, renamed, or never provisioned.
   - *Uncertainties Remaining:* Directory creation history, volume mount state, and caller path provenance remain unknown.
   - *Required Action:* **HALT fail-closed (`REC-STATE-08`).** Blind creation of parent folders or configuration files is strictly forbidden.
3. **Access Denied (`ACCESS_DENIED`):**
   - *Observed Evidence:* `UnauthorizedAccessException` / Win32 `ERROR_ACCESS_DENIED` (`0x80070005`, error 5).
   - *Establishes:* Caller's execution token lacks required NTFS DACL permissions (or path targets a directory, or file is marked read-only).
   - *Does NOT Establish:* File existence or absence! If traverse or read permissions are denied, `File.Exists()` returns `false`, but the file may exist on disk. Does not establish who configured the ACL or if an intrusion occurred.
   - *Uncertainties Remaining:* File existence, file content, author provenance, and whether restriction is intentional or misconfigured remain unknown.
   - *Required Action:* **HALT fail-closed (`REC-STATE-06`).** Do NOT overwrite. Do NOT infer file absence. Inspect NTFS ACLs and elevation token.
4. **Invalid or Malformed Path (`INVALID_OR_MALFORMED_PATH`):**
   - *Observed Evidence:* `ArgumentException`, `NotSupportedException`, or `PathTooLongException`.
   - *Establishes:* Path string is syntactically invalid, contains illegal characters, or exceeds Windows length boundaries.
   - *Does NOT Establish:* Physical filesystem state, volume state, or file existence.
   - *Uncertainties Remaining:* Physical storage state remains unprobed.
   - *Required Action:* **HALT fail-closed (`REC-STATE-09`).** Caller tooling defect; fix argument contract.
5. **Reparse Point / Junction Violation (`REPARSE_POINT_VIOLATION`):**
   - *Observed Evidence:* `([System.IO.File]::GetAttributes($path) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0`.
   - *Establishes:* Target file or parent directory contains an NTFS reparse tag (junction, symlink, mount point).
   - *Does NOT Establish:* Real target identity, author provenance, or safety of target volume.
   - *Uncertainties Remaining:* Real destination path and security posture remain untrusted.
   - *Required Action:* **SECURITY FAULT (`REC-STATE-07`).** Strict halt; audit ACLs and remove junction.
6. **File Sharing Violation (`SHARING_VIOLATION`):**
   - *Observed Evidence:* `IOException` with Win32 HResult `0x80070020` (`ERROR_SHARING_VIOLATION` / error 32).
   - *Establishes:* An existing open handle to the target file currently specifies sharing flags (`FileShare`) incompatible with the requested open/access mode. Proves file exists on disk at the moment of handle conflict.
   - *Does NOT Establish:*
     - Does NOT establish the identity of the process holding the conflicting handle.
     - Does NOT establish that a "competing deployment worker" or child process is responsible (may be Windows Defender / Antivirus, Windows Search Indexer, backup agent, or another thread within the current process).
     - Does NOT establish lock duration (may be transient).
     - Does NOT establish file content hash or integrity.
   - *Uncertainties Remaining:* Holding process ID, thread identity, handle purpose, lock duration, and file hash remain unknown.
   - *Required Action:* **HALT fail-closed (`REC-STATE-13`).** Do NOT attempt blind overwrite. Do NOT claim competing process without independent evidence. Triage handle holders via Step 4 / Process Explorer / `handle.exe`. If handle cannot be safely identified or released, halt and escalate.
7. **Byte-Range Lock Violation (`LOCK_VIOLATION`):**
   - *Observed Evidence:* `IOException` with Win32 HResult `0x80070021` (`ERROR_LOCK_VIOLATION` / error 33).
   - *Establishes:* File handle was opened, but an attempt to read, write, or lock a *specific byte range* conflicted with an existing byte-range lock (`LockFile` / `LockFileEx`).
   - *Does NOT Establish:*
     - Does NOT establish a whole-file sharing violation (`0x80070020`).
     - Does NOT establish the identity of the process or thread holding the range lock.
     - Does NOT establish that the whole file is locked.
     - Does NOT establish that a competing deployment worker is active.
   - *Uncertainties Remaining:* Process identity, locking thread, byte-range boundaries, and file hash remain unknown.
   - *Required Action:* **HALT fail-closed (`REC-STATE-14`).** Do NOT attempt byte-range writes. Triage byte-range locking processes via Step 4. If cause cannot be determined, classify as INDETERMINATE (`REC-STATE-05`) and halt.
8. **Generic or Unknown I/O Failure (`IO_FAILURE_CAUSE_UNDETERMINED`):**
   - *Observed Evidence:* `IOException` with unclassified HResult (not `0x80070020`, not `0x80070021`).
   - *Establishes:* Low-level I/O failure occurred during filesystem communication.
   - *Does NOT Establish:* File presence, absence, permission, lock state, or cause.
   - *Uncertainties Remaining:* File state, disk controller state, and hardware durability are all unknown.
   - *Required Action:* **HALT fail-closed (`REC-STATE-12`).** Do NOT overwrite or assume absence.
9. **Hash-Helper or Metadata Failure (`HASH_HELPER_FAILURE` / `MALFORMED_HASH_METADATA`):**
   - *Observed Evidence:* Hash computation exception, non-64 hex digest, or missing baseline metadata in config.
   - *Establishes:* Cryptographic digest computation failed or reference metadata is corrupt.
   - *Does NOT Establish:* File physical existence or corruption.
   - *Uncertainties Remaining:* Integrity of live file and baseline cannot be mathematically verified.
   - *Required Action:* **HALT fail-closed (`REC-STATE-10` / `REC-STATE-11`).** Refuse restoration without baseline.
10. **Contradictory or Indeterminate Evidence (`CONTRADICTORY_OR_INDETERMINATE`):**
    - *Observed Evidence:* Observations are mutually contradictory, or API cannot reliably distinguish absence from an error (e.g., `File.Exists() == false` while open throws access denied or I/O error; directory enumeration contradicts handle open; hash comparison returns incoherent state).
    - *Establishes:* Evidence is insufficient, ambiguous, or contradictory. Halts restoration and downstream execution immediately.
    - *Does NOT Establish:*
      - Does NOT establish physical filesystem corruption or root volume failure.
      - Does NOT establish database catalog damage or corruption (`PGDATA`, `hisecure_erp`, `hitech_platform`, and `zentra_test` state remains unverified by filesystem metadata alone).
      - Does NOT establish caller or external process identity.
    - *Uncertainties Remaining:* True underlying filesystem state, live file presence/content, and database catalog integrity remain completely unverified.
    - *Required Action:* **CRITICAL FORENSIC HALT fail-closed (`REC-STATE-05`).** Halts restoration and downstream execution immediately; locks retries and migrations. Escalate to Human Incident Commander. Zero automatic restoration. Any recovery action (such as database catalog verification or administrative backup recovery) requires an independent, separately evaluated and approved human decision.

| State Identifier | Live Disk Condition | Golden Backup Condition | Discard Artifact Condition | Consumed-Nonce Ledger Condition | Incident Commander Remediation Procedure |
|---|---|---|---|---|---|
| **REC-STATE-01** | `CONFIRMED_MISSING_FILE` (Corroborated absence via `FileNotFoundException`; `File.Exists() == false` alone rejected; parent directory confirmed existing genuine non-reparse point) | Verified leaf file, hash matches baseline | Verified leaf file, hash matches candidate | Verified leaf file in `.consumed_nonces\` (valid 9-field JSON schema, monotonic `history` array with sequence 1, matching `operationId` & `targetConfigFile`, matching candidate/baseline hashes, valid freshness timestamp within $\pm 300\text{s}$, status strictly `CONSUMED`, non-reparse leaf. Status `ROLLED_BACK` or `DISCARDED` triggers `REC-STATE-05` contradictory status anomaly) | **MANDATORY HUMAN ESCALATION (Section 12):** Live target is corroborated absent. If absence cannot be reliably distinguished from an error, the state MUST be classified as INDETERMINATE (`REC-STATE-05`) and halt fail-closed. If and only if absence is corroborated, the consumed-nonce status is strictly `CONSUMED` with monotonic `history` sequence 1 (status `ROLLED_BACK` or `DISCARDED` triggers `REC-STATE-05`), and every required supporting artifact from the authoritative four-item supporting-evidence list (1. Golden backup matching baseline, 2. Discard artifact matching candidate, 3. Baseline metadata `ExpectedBaselineHash`, 4. Consumed-nonce ledger record) is independently verified, recreating the live target from golden backup is a *proposed, separately approved human recovery decision* under Gate 6 and Section 4.3. If the discard artifact or any supporting evidence is missing, unreadable, or malformed, recreation is strictly forbidden and execution halts fail-closed to `REC-STATE-05`. Automatic restoration is strictly prohibited; unverified and untested on this host. |
| **REC-STATE-02** | `VERIFIED_HASH_MISMATCH` (Live file exists, computed hash differs from both baseline and candidate) | Verified leaf file, hash matches baseline | Verified leaf file, hash matches candidate | Verified leaf file in `.consumed_nonces\` (valid 9-field JSON schema, monotonic `history` array with sequence 1, matching `operationId` & `targetConfigFile`, matching candidate/baseline hashes, valid freshness timestamp within $\pm 300\text{s}$, status strictly `CONSUMED`, non-reparse leaf. Status `ROLLED_BACK` or `DISCARDED` triggers `REC-STATE-05` contradictory status anomaly) | **PROPOSED HUMAN RESTORATION DECISION (DIVERGENT CONFIGURATION):** Live file exists and differs from *both* baseline and candidate (unexpected divergent state). Consumed-nonce status must be strictly `CONSUMED` with monotonic `history` sequence 1 (status `ROLLED_BACK` or `DISCARDED` triggers `REC-STATE-05`). All four required supporting artifacts verified (1. Golden backup matching baseline, 2. Discard artifact matching candidate, 3. Baseline metadata `ExpectedBaselineHash`, 4. Consumed-nonce ledger record with valid binding, freshness, history, and status). Safe restoration protocol is a *proposed, separately approved human recovery decision* under explicit human sign-off (Gate 6 and Section 4.3). Automatic restoration or blind overwrite is strictly prohibited; untested on this host. |
| **REC-STATE-15** | `VERIFIED_CANDIDATE_ACTIVE` (Live file exists, computed hash equals candidate hash; unpromoted candidate active after aborted/failed swap) | Verified leaf file, hash matches baseline | Verified leaf file, hash matches candidate | Verified leaf file in `.consumed_nonces\` (valid 9-field JSON schema, monotonic `history` array with sequence 1, matching `operationId` & `targetConfigFile`, matching candidate/baseline hashes, valid freshness timestamp within $\pm 300\text{s}$, status strictly `CONSUMED`, non-reparse leaf. Status `ROLLED_BACK` or `DISCARDED` triggers `REC-STATE-05` contradictory status anomaly) | **PROPOSED HUMAN RESTORATION DECISION (UNPROMOTED CANDIDATE ACTIVE):** Live file matches candidate following an aborted, interrupted, or failed deployment swap. Live configuration matching candidate is **NOT** a certified or permitted promotion state. Consumed-nonce status must be strictly `CONSUMED` with monotonic `history` sequence 1 (status `ROLLED_BACK` or `DISCARDED` triggers `REC-STATE-05`). If and only if all four required supporting artifacts from the authoritative list (1. Golden backup matching baseline, 2. Discard artifact matching candidate, 3. Baseline metadata `ExpectedBaselineHash`, 4. Consumed-nonce ledger record with valid binding, freshness, history, and status) are independently verified, safe restoration of baseline from golden backup is a *proposed, separately approved human recovery decision* under explicit human sign-off (Gate 6 and Section 4.3). Automatic restoration or blind overwrite is strictly prohibited; unverified and untested on this host. |
| **REC-STATE-16** | `VERIFIED_HASH_MATCH` (Live hash equals baseline hash) | Verified leaf file, hash matches baseline | Verified leaf file, hash matches candidate | Verified leaf file in `.consumed_nonces\` (valid 9-field JSON schema, monotonic `history` array with sequence 1, matching `operationId` & `targetConfigFile`, matching candidate/baseline hashes, valid freshness timestamp within $\pm 300\text{s}$, status strictly `CONSUMED`, non-reparse leaf) | **HALT fail-closed (UNFINALIZED IN-FLIGHT TRANSACTION TICKET ACTIVE ON BASELINE):** Live configuration matches baseline on physical disk and discard artifact is verified, but consumed-nonce ledger record remains in unfinalized in-flight status `CONSUMED` (sequence 1). The worker crashed, aborted, or was interrupted pre-swap before advancing lifecycle status to `DISCARDED`. This is NOT a complete or certified terminal state; treating `CONSUMED` as clean baseline creates an unmonitored ticket defect. Do NOT overwrite live file; preserve current live baseline configuration; incident remains UNRESOLVED; downstream retries and migrations remain STRICTLY LOCKED OUT until Human Incident Commander forensic review retires or reconciles the ticket under explicit human authorization. Automatic promotion or silent transition to `DISCARDED` is strictly prohibited. |
| **REC-STATE-03** | `VERIFIED_HASH_MATCH` (Live hash equals baseline hash) | Verified leaf file, hash matches baseline | Discard artifact corroborated absent on disk (`FileNotFoundException` / Win32 2 upon direct open with verified genuine non-reparse `discarded\` parent directory read access; `File.Exists() == false` alone strictly rejected; physical filesystem errors `0x80070005`, `0x80070020`, `0x80070021`, reparse points, or missing `discarded\` folder strictly excluded and routed to Tier 1 states) | Verified leaf file in `.consumed_nonces\` (valid 9-field JSON schema, monotonic `history` array, matching operation binding, valid freshness within $\pm 300\text{s}$, status `CONSUMED`, `ROLLED_BACK`, or `DISCARDED`, non-reparse leaf; strictly NO Tier 1 physical faults or Tier 2 defects). If any Tier 2 nonce defect (stale $>300\text{s}$, corrupt history, unbound, schema invalid) or backup defect coexists, Tier 2 precedence halts strictly to `REC-STATE-05` | Live matches baseline. Discard artifact is corroborated absent on disk, but Tier 1 physical checks pass and Tier 2 nonce ledger and golden backup are 100% verified and fresh. Do NOT overwrite live file. Incident remains UNRESOLVED due to corroborated missing discard evidence; downstream retries and migrations remain STRICTLY LOCKED OUT. Human forensic audit required. (Precedence Rule: Physical faults on the discard probe route to Tier 1 states; if any Tier 2 nonce ledger or golden backup defect coexists, execution halts strictly to `REC-STATE-05`; corroborated missing discard NEVER masks Tier 1 or Tier 2 defects). |
| **REC-STATE-04** | `UNVERIFIED_CANDIDATE_OR_DIVERGENT` (Live file exists on disk and matches candidate or differs from baseline) | Verified leaf file, hash matches baseline | Discard artifact corroborated absent on disk (`FileNotFoundException` / Win32 2 upon direct open with verified genuine non-reparse `discarded\` parent directory read access; `File.Exists() == false` alone strictly rejected; physical filesystem errors `0x80070005`, `0x80070020`, `0x80070021`, reparse points, or missing `discarded\` folder strictly excluded and routed to Tier 1 states) | Verified leaf file in `.consumed_nonces\` (valid 9-field JSON schema, monotonic `history` sequence 1, matching operation binding, valid freshness within $\pm 300\text{s}$, status strictly `CONSUMED`, non-reparse leaf; strictly NO Tier 1 physical faults or Tier 2 defects). If any Tier 2 nonce defect (stale $>300\text{s}$, corrupt history, unbound, schema invalid, or contradictory status `DISCARDED` / `ROLLED_BACK`) or backup defect coexists, Tier 2 precedence halts strictly to `REC-STATE-05` | **HALT (CORROBORATED MISSING DISCARD EVIDENCE ON EXISTING LIVE FILE):** Live file exists on disk and matches candidate (or differs from baseline), but required discard artifact is corroborated absent on disk, while Tier 1 physical checks pass and Tier 2 nonce ledger (status `CONSUMED`, fresh) and golden backup are verified! Do NOT infer restoration is safe merely because golden backup appears valid. Do NOT automatically overwrite live file. Preserve current live file; incident remains UNRESOLVED; downstream retries and migrations remain STRICTLY LOCKED OUT. (Target absence with missing discard artifact is strictly excluded from `REC-STATE-04` and routes to `REC-STATE-05`. Precedence Rule: Physical faults on the discard probe route to Tier 1 states; if any Tier 2 nonce ledger defect, contradictory status, or backup defect coexists, execution halts strictly to `REC-STATE-05`; corroborated missing discard NEVER masks Tier 1 or Tier 2 defects). Requires human forensic review and separately approved restoration procedure. |
| **REC-STATE-05** | `CONTRADICTORY_OR_INDETERMINATE` (or Target Absent with Incomplete Supporting Evidence) | Incoherent, missing, or corrupt (or any condition when discard/nonce/evidence is missing for absent target) | Missing, unreadable, or malformed when target is absent; readable discard file with corrupt hash (SHA-256 != candidate); discard inversion anomaly (SHA-256 == baseline); or indeterminate/contradictory discard probe | Incoherent, missing, unbound, stale ($>300\text{s}$), duplicate, missing/non-monotonic history, clock regression ($t_2 < t_1$), timeout ($>900\text{s}$), malformed ISO 8601, or contradictory status (including DISCARDED or ROLLED_BACK coexisting with candidate active, target absent, or divergent state; or coexisting with missing discard) | **CRITICAL FORENSIC HALT (INDETERMINATE / CONTRADICTORY / INCOMPLETE EVIDENCE):** Evidence is ambiguous, contradictory, incomplete, or uncorroborated (including target confirmed absent with missing, unreadable, or malformed discard artifact or missing/corrupt nonce ledger; or readable discard file with hash mismatch or baseline inversion; or indeterminate probe on any artifact; or nonce status inconsistent with live disk condition, such as `DISCARDED` or `ROLLED_BACK` while target is absent, candidate is active, or live diverges; or broken/missing history array; or illegal transitions; or timestamp syntax/skew/regression anomalies; or ANY Tier 2 nonce/backup defect coexisting with a missing discard artifact). Multi-Tier Failure Precedence: Tier 1 physical filesystem errors and Tier 2 defects take absolute precedence over Tier 3 missing discard artifacts; missing discard NEVER masks a Tier 1 or Tier 2 defect. Recreating an absent target or overwriting live file is strictly forbidden. Halts restoration and all downstream execution immediately; locks retries and migrations. Escalate to Human Incident Commander. Does NOT establish database catalog damage; catalog integrity remains unverified. Zero automatic restoration. Any administrative recovery or database catalog intervention requires an independent, separately evaluated and approved human decision. |
| **REC-STATE-06** | `ACCESS_DENIED` (`0x80070005`) on live target, golden backup, consumed-nonce ledger record, baseline metadata file, or discard artifact | Any | Any | Any | **HALT:** Do NOT overwrite or assume absence. Inspect NTFS permissions and user token elevation. Tier 1 precedence enforced across all artifacts; do NOT route access denied to `REC-STATE-03`, `REC-STATE-04`, `REC-STATE-05`, or `REC-STATE-10`. |
| **REC-STATE-07** | `REPARSE_POINT_VIOLATION` on live target, golden backup, consumed-nonce ledger record, baseline metadata file, or discard artifact (or their parent directories: `config\`, `discarded\`, `.consumed_nonces\`) | Any | Any | Any | **SECURITY FAULT:** Halt immediately; remove unauthorized NTFS junction; audit ACLs. Tier 1 precedence enforced across all artifacts; do NOT route reparse point to `REC-STATE-03`, `REC-STATE-04`, or `REC-STATE-05`. |
| **REC-STATE-08** | `CONFIRMED_MISSING_DIRECTORY` (Corroborated absence of parent directory via `DirectoryNotFoundException` / Win32 `ERROR_PATH_NOT_FOUND` / 3 on `D:\Zentra\database\config`, `D:\Zentra\database\config\discarded\`, or `D:\Zentra\database\config\.consumed_nonces\`) | Any | Any | Any | **HALT:** Parent directory `config\`, `discarded\`, or `.consumed_nonces\` missing. Do NOT create blind files or directories. Investigate volume integrity. Tier 1 precedence enforced across all artifacts; do NOT route missing directory to `REC-STATE-03`, `REC-STATE-04`, or `REC-STATE-05`. |
| **REC-STATE-09** | `INVALID_OR_MALFORMED_PATH` on live target, golden backup, consumed-nonce ledger record, baseline metadata file, or discard artifact path | Any | Any | Any | **HALT:** Path syntax error or illegal characters. Audit caller path configuration. Tier 1 precedence enforced across all artifacts; do NOT route path defect to `REC-STATE-03`, `REC-STATE-04`, or `REC-STATE-05`. |
| **REC-STATE-10** | `MALFORMED_HASH_METADATA` | Corrupt hash string | Any | Any | **HALT:** Expected baseline hash missing, unparseable, or malformed in readable metadata store. Refuse restoration without baseline. Distinguished from physical filesystem access errors on metadata file (which route to `REC-STATE-06`, `13`, `14`, etc.). |
| **REC-STATE-11** | `HASH_HELPER_FAILURE` | Any | Any | Any | **HALT:** Helper exception during calculation. Do NOT overwrite live file with unknown state. |
| **REC-STATE-12** | `IO_FAILURE_CAUSE_UNDETERMINED` on live target, golden backup, consumed-nonce ledger record, baseline metadata file, or discard artifact | Any | Any | Any | **HALT:** Generic I/O error without confirmed sharing HResult. Inspect disk and controller logs. Tier 1 precedence enforced across all artifacts; do NOT infer file absence or route to `REC-STATE-03`, `REC-STATE-04`, or `REC-STATE-05`. |
| **REC-STATE-13** | `SHARING_VIOLATION` (`0x80070020`) on live target, golden backup, consumed-nonce ledger record, baseline metadata file, or discard artifact | Any | Any | Any | **HALT:** File handle open conflict. Does NOT identify holding process; do NOT claim competing worker without independent evidence. Proves file exists on disk; do NOT route sharing conflict to `REC-STATE-03`, `REC-STATE-04`, or `REC-STATE-05`. Triage handle holders via Step 4. |
| **REC-STATE-14** | `LOCK_VIOLATION` (`0x80070021`) on live target, golden backup, consumed-nonce ledger record, baseline metadata file, or discard artifact | Any | Any | Any | **HALT:** Byte-range lock conflict on file region. Distinct from whole-file sharing violation. Does NOT identify holding process/thread. Proves file exists on disk; do NOT route lock conflict to `REC-STATE-03`, `REC-STATE-04`, or `REC-STATE-05`. Do NOT attempt byte overwrites. Triage via Step 4. |

### 4.2 Authoritative Mandatory Supporting-Evidence Contract (The Four Invariants)

Restoration of any configuration file (`REC-STATE-01`, `REC-STATE-02`, or `REC-STATE-15`) is strictly prohibited unless **all four** mandatory supporting artifacts are independently verified on disk:

1. **Golden Backup File (`postgresql.conf.golden.<Timestamp>.<Nonce>`):**
   - *Location:* `D:\Zentra\database\config\`
   - *Verification Contract:* Must exist as a verified normal leaf file, non-reparse point; re-read and hashed immediately prior to operation; computed SHA-256 equals `ExpectedBaselineHash` exactly.
   - *Authoritative Golden Backup Physical Filesystem Classification Contract:*
     When probing `D:\Zentra\database\config\postgresql.conf.golden.<Timestamp>.<Nonce>`, operators and automated harnesses must never infer backup file absence from `[System.IO.File]::Exists($goldenPath) -eq $false` alone. Probing the golden backup must deterministically classify into one of ten distinct outcomes:
     1. **Corroborated Missing Golden Backup File (`CONFIRMED_MISSING_GOLDEN_BACKUP`):**
        - *Observed Evidence:* Explicit `FileNotFoundException` / Win32 `ERROR_FILE_NOT_FOUND` (2) returned upon direct file open, combined with confirmed positive read access to the genuine, non-reparse `config\` parent directory.
        - *Establishes:* Golden backup leaf was absent from disk at inspection time.
        - *Does NOT Establish:* Disk controller failure, or whether backup was created under a different name.
        - *Uncertainties Remaining:* Operational history of backup creation; whether staging aborted prior to backup copy.
        - *Required Action:* Tier 2 defect. Route strictly to `REC-STATE-05` (Critical Forensic Halt). Recreation or overwrite strictly prohibited; lock pipeline.
     2. **Readable Golden Backup with Corrupt Hash (`CORRUPT_GOLDEN_BACKUP_HASH`):**
        - *Observed Evidence:* File exists, readable, valid non-reparse leaf, but computed SHA-256 $\neq$ `ExpectedBaselineHash`.
        - *Establishes:* Backup payload fails cryptographic integrity against recorded baseline.
        - *Does NOT Establish:* Whether disk corruption, concurrent write, or script error altered the backup.
        - *Uncertainties Remaining:* Cause of payload divergence; integrity of underlying baseline storage.
        - *Required Action:* Tier 2 defect. Route strictly to `REC-STATE-05` (Critical Forensic Halt). Audit staging and baseline sources; lock pipeline.
     3. **Golden Backup Access Denied (`GOLDEN_BACKUP_ACCESS_DENIED`):**
        - *Observed Evidence:* `UnauthorizedAccessException` / Win32 `ERROR_ACCESS_DENIED` (`0x80070005`, error 5) when probing golden backup file or `config\` directory.
        - *Establishes:* Caller's execution token lacks required NTFS DACL permissions to read golden backup.
        - *Does NOT Establish:* File absence or existence! If permissions are denied, `File.Exists()` returns `false`, but the golden backup may exist on disk.
        - *Uncertainties Remaining:* File existence, content, author provenance, and ACL settings.
        - *Required Action:* **HALT fail-closed (`REC-STATE-06`).** Tier 1 Precedence strictly enforced. Do NOT infer file absence; do NOT route to `REC-STATE-05` as missing backup. Audit NTFS ACLs and elevation token.
     4. **Golden Backup Sharing Violation (`GOLDEN_BACKUP_SHARING_VIOLATION`):**
        - *Observed Evidence:* `IOException` with Win32 HResult `0x80070020` (`ERROR_SHARING_VIOLATION` / error 32) when opening golden backup file.
        - *Establishes:* An existing open handle holds conflicting sharing flags. Proves golden backup exists on physical disk!
        - *Does NOT Establish:* Competing deployment worker (may be antivirus, search indexer, etc.); does not establish lock duration; does not establish file hash.
        - *Uncertainties Remaining:* Holding PID, thread, lock duration, and file hash.
        - *Required Action:* **HALT fail-closed (`REC-STATE-13`).** Tier 1 Precedence strictly enforced. Proves file is NOT missing; do NOT route to `REC-STATE-05`. Triage via Step 4 / Process Explorer.
     5. **Golden Backup Byte-Range Lock Violation (`GOLDEN_BACKUP_LOCK_VIOLATION`):**
        - *Observed Evidence:* `IOException` with Win32 HResult `0x80070021` (`ERROR_LOCK_VIOLATION` / error 33) when reading golden backup.
        - *Establishes:* Handle opened, but reading a specific byte range conflicted with an existing byte-range lock (`LockFile` / `LockFileEx`). Proves file exists on disk!
        - *Does NOT Establish:* Whole-file sharing violation; does not establish holding process identity; does not establish file hash.
        - *Uncertainties Remaining:* Locking process/thread, byte-range boundaries, and file hash.
        - *Required Action:* **HALT fail-closed (`REC-STATE-14`).** Tier 1 Precedence strictly enforced. Do NOT infer absence; do NOT route to `REC-STATE-05`. Triage via Step 4.
     6. **Golden Backup Reparse Point Violation (`GOLDEN_BACKUP_REPARSE_POINT_VIOLATION`):**
        - *Observed Evidence:* `([System.IO.File]::GetAttributes($path) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0` on golden backup file or parent directory.
        - *Establishes:* Target path contains an NTFS reparse tag (junction, symlink, mount point).
        - *Does NOT Establish:* Genuine destination legitimacy, safety, or volume integrity.
        - *Uncertainties Remaining:* Real destination path and security posture.
        - *Required Action:* **SECURITY FAULT (`REC-STATE-07`).** Tier 1 Precedence strictly enforced. Do NOT route to `REC-STATE-05`. Strict halt; audit ACLs and remove junction.
     7. **Golden Backup Missing Parent Directory (`GOLDEN_BACKUP_MISSING_PARENT_DIRECTORY`):**
        - *Observed Evidence:* `DirectoryNotFoundException` / Win32 `ERROR_PATH_NOT_FOUND` (3) on `D:\Zentra\database\config\`.
        - *Establishes:* Parent configuration directory structure is missing at read time.
        - *Does NOT Establish:* Root volume failure.
        - *Uncertainties Remaining:* Directory creation history, volume mount state.
        - *Required Action:* **HALT fail-closed (`REC-STATE-08`).** Tier 1 Precedence strictly enforced. Structural directory defect; do NOT route to `REC-STATE-05` as missing backup.
     8. **Invalid or Malformed Golden Backup Path (`GOLDEN_BACKUP_INVALID_PATH`):**
        - *Observed Evidence:* `ArgumentException`, `NotSupportedException`, or `PathTooLongException` on golden backup path string.
        - *Establishes:* Path string is syntactically invalid or exceeds Windows path limits.
        - *Does NOT Establish:* Physical storage state or backup presence.
        - *Uncertainties Remaining:* Caller tooling defect; storage remains unprobed.
        - *Required Action:* **HALT fail-closed (`REC-STATE-09`).** Tier 1 Precedence strictly enforced. Tooling defect; fix argument contract.
     9. **Golden Backup Generic or Unknown I/O Failure (`GOLDEN_BACKUP_IO_FAILURE_UNDETERMINED`):**
        - *Observed Evidence:* `IOException` with unclassified HResult (not `0x80070020`, not `0x80070021`) when probing golden backup.
        - *Establishes:* Low-level I/O subsystem failure prevented handle creation or reading.
        - *Does NOT Establish:* File presence, absence, permission, or root cause.
        - *Uncertainties Remaining:* Storage controller state, hardware durability.
        - *Required Action:* **HALT fail-closed (`REC-STATE-12`).** Tier 1 Precedence strictly enforced. Do NOT assume file absence; do NOT route to `REC-STATE-05`.
     10. **Indeterminate or Contradictory Golden Backup Probe (`GOLDEN_BACKUP_CONTRADICTORY_OR_INDETERMINATE`):**
         - *Observed Evidence:* Observations regarding golden backup are mutually contradictory (e.g. `File.Exists() == false` while open throws access denied or sharing violation; directory enumeration contradicts direct open; or file state fluctuates across calls).
         - *Establishes:* Filesystem state is indeterminate or racing.
         - *Does NOT Establish:* File absence or presence.
         - *Uncertainties Remaining:* True underlying filesystem state of golden backup.
         - *Required Action:* **CRITICAL FORENSIC HALT fail-closed (`REC-STATE-05`).** Tier 1 Precedence strictly enforced. Zero automatic restoration; escalate to Human Incident Commander.
2. **Discard Artifact (`postgresql.conf.discard.<Timestamp>.<Nonce>`):**
   - *Location:* `D:\Zentra\database\config\discarded\`
   - *Verification Contract:* Must exist as a verified normal leaf file, non-reparse point; computed SHA-256 equals `CandidateHash` (differs from `ExpectedBaselineHash`). Confirms candidate was safely preserved and cataloged before any rollback/restoration.
   - *Authoritative Discard Artifact Physical Filesystem Classification Contract:*
     When probing the discard artifact `D:\Zentra\database\config\discarded\postgresql.conf.discard.<Timestamp>.<Nonce>`, operators and automated harnesses must never infer discard file absence from `[System.IO.File]::Exists($discardPath) -eq $false` alone. Probing the discard artifact must deterministically classify into one of ten distinct outcomes:
     1. **Corroborated Missing Discard File (`CONFIRMED_MISSING_DISCARD_FILE`):**
        - *Observed Evidence:* Explicit `FileNotFoundException` / Win32 `ERROR_FILE_NOT_FOUND` (2) returned upon direct file open, combined with confirmed positive read access to the genuine, non-reparse `discarded\` parent folder.
        - *Establishes:* Discard file was absent from `discarded\` at inspection time.
        - *Does NOT Establish:* Permanent absence across subsequent operations (user-mode TOCTOU); does not establish whether candidate staging ever succeeded.
        - *Uncertainties Remaining:* Concurrency state between worker discard write and inspection.
        - *Required Action:* Route to Tier 3 missing-discard evaluation (`REC-STATE-03` if `Live == Baseline`, `REC-STATE-04` if `Live != Baseline`, `REC-STATE-05` if target absent). Automatic restoration strictly prohibited.
     2. **Readable Discard File with Corrupt Content or Inversion (`CORRUPT_OR_INVERTED_DISCARD_CONTENT`):**
        - *Observed Evidence:* File exists, readable, valid non-reparse leaf, but computed SHA-256 $\neq$ `CandidateHash` (corrupt discard content), OR computed SHA-256 equals `ExpectedBaselineHash` (discard inversion anomaly).
        - *Establishes:* Discard file is present, but payload fails cryptographic integrity or represents an inverted baseline copy.
        - *Does NOT Establish:* Who authored the corrupt content or whether a swap error occurred.
        - *Uncertainties Remaining:* Origin and payload provenance of the staged discard file.
        - *Required Action:* **HALT fail-closed (`REC-STATE-05`).** Audit golden backup source and candidate generation; lock pipeline.
     3. **Discard Access Denied (`DISCARD_ACCESS_DENIED`):**
        - *Observed Evidence:* `UnauthorizedAccessException` / Win32 `ERROR_ACCESS_DENIED` (`0x80070005`, error 5) when probing discard file or `discarded\` directory.
        - *Establishes:* Caller's execution token lacks required NTFS DACL read/traverse permissions.
        - *Does NOT Establish:* File absence or existence! If permissions are denied, `File.Exists()` returns `false`, but the discard file may exist on disk.
        - *Uncertainties Remaining:* File existence, file content, author provenance, and ACL configuration.
        - *Required Action:* **HALT fail-closed (`REC-STATE-06`).** Tier 1 Precedence strictly enforced. Do NOT infer file absence; do NOT route to `REC-STATE-03` or `REC-STATE-04`. Audit NTFS ACLs and token elevation.
     4. **Discard Sharing Violation (`DISCARD_SHARING_VIOLATION`):**
        - *Observed Evidence:* `IOException` with Win32 HResult `0x80070020` (`ERROR_SHARING_VIOLATION` / error 32) when opening discard file.
        - *Establishes:* An existing open handle holds conflicting sharing flags. Proves discard file exists on disk at inspection moment!
        - *Does NOT Establish:* Holding process identity (may be antivirus, search indexer, backup agent, etc.); does not establish lock duration; does not establish candidate hash integrity.
        - *Uncertainties Remaining:* Holding PID, locking thread, lock duration, and file hash.
        - *Required Action:* **HALT fail-closed (`REC-STATE-13`).** Tier 1 Precedence strictly enforced. Proves file is NOT missing; do NOT route to `REC-STATE-03` or `REC-STATE-04`. Triage handle holders via Step 4 / Process Explorer.
     5. **Discard Byte-Range Lock Violation (`DISCARD_LOCK_VIOLATION`):**
        - *Observed Evidence:* `IOException` with Win32 HResult `0x80070021` (`ERROR_LOCK_VIOLATION` / error 33) when reading discard file.
        - *Establishes:* Handle opened, but reading a specific byte range conflicted with an existing byte-range lock (`LockFile` / `LockFileEx`). Proves file exists on disk!
        - *Does NOT Establish:* Whole-file sharing violation; does not establish holding process identity; does not establish file hash.
        - *Uncertainties Remaining:* Locking process/thread, byte-range boundaries, and file hash.
        - *Required Action:* **HALT fail-closed (`REC-STATE-14`).** Tier 1 Precedence strictly enforced. Do NOT infer file absence; do NOT route to `REC-STATE-03` or `REC-STATE-04`. Triage via Step 4.
     6. **Discard Reparse Point Violation (`DISCARD_REPARSE_POINT_VIOLATION`):**
        - *Observed Evidence:* `([System.IO.File]::GetAttributes($path) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0` on discard file or `discarded\` folder.
        - *Establishes:* Target path contains an NTFS reparse tag (junction, symlink, mount point).
        - *Does NOT Establish:* Genuine target destination, safety, or volume integrity.
        - *Uncertainties Remaining:* Real destination path and security posture.
        - *Required Action:* **SECURITY FAULT (`REC-STATE-07`).** Tier 1 Precedence strictly enforced. Do NOT route to `REC-STATE-03` or `REC-STATE-04`. Strict halt; audit ACLs and remove junction.
     7. **Discard Missing Parent Directory (`DISCARD_MISSING_PARENT_DIRECTORY`):**
        - *Observed Evidence:* `DirectoryNotFoundException` / Win32 `ERROR_PATH_NOT_FOUND` (3) on `D:\Zentra\database\config\discarded\`.
        - *Establishes:* The `discarded\` directory segment does not exist at read time.
        - *Does NOT Establish:* Root volume failure, or whether discard was placed elsewhere.
        - *Uncertainties Remaining:* Directory creation history, volume mount state, and caller path provenance.
        - *Required Action:* **HALT fail-closed (`REC-STATE-08`).** Tier 1 Precedence strictly enforced. Missing parent directory does NOT establish corroborated leaf absence; blind directory creation prohibited; do NOT route to `REC-STATE-03` or `REC-STATE-04`.
     8. **Invalid or Malformed Discard Path (`DISCARD_INVALID_PATH`):**
        - *Observed Evidence:* `ArgumentException`, `NotSupportedException`, or `PathTooLongException` on discard path string.
        - *Establishes:* Discard path string is syntactically invalid or exceeds Windows path limits.
        - *Does NOT Establish:* Physical filesystem state, volume state, or discard presence.
        - *Uncertainties Remaining:* Physical storage remains unprobed.
        - *Required Action:* **HALT fail-closed (`REC-STATE-09`).** Tier 1 Precedence strictly enforced. Caller tooling defect; do NOT route to `REC-STATE-03` or `REC-STATE-04`.
     9. **Discard Generic or Unknown I/O Failure (`DISCARD_IO_FAILURE_UNDETERMINED`):**
        - *Observed Evidence:* `IOException` with unclassified HResult (not `0x80070020`, not `0x80070021`) when probing discard file.
        - *Establishes:* Low-level I/O failure occurred during filesystem communication with discard artifact.
        - *Does NOT Establish:* File presence, absence, permission, or root cause.
        - *Uncertainties Remaining:* File state, disk controller state, and hardware durability.
        - *Required Action:* **HALT fail-closed (`REC-STATE-12`).** Tier 1 Precedence strictly enforced. Do NOT assume file absence; do NOT route to `REC-STATE-03` or `REC-STATE-04`.
     10. **Indeterminate or Contradictory Discard Probe (`DISCARD_CONTRADICTORY_OR_INDETERMINATE`):**
         - *Observed Evidence:* Observations regarding discard artifact are mutually contradictory (e.g. `File.Exists() == false` while open throws access denied or sharing violation; directory enumeration contradicts direct open; or file state is ambiguous).
         - *Establishes:* Evidence is insufficient, ambiguous, or contradictory.
         - *Does NOT Establish:* Discard file absence or presence.
         - *Uncertainties Remaining:* True underlying filesystem state of discard directory and artifact.
         - *Required Action:* **CRITICAL FORENSIC HALT fail-closed (`REC-STATE-05`).** Tier 1 Precedence strictly enforced. Zero automatic restoration; do NOT route to `REC-STATE-03` or `REC-STATE-04`. Escalate to Human Incident Commander.
3. **Baseline Metadata (`ExpectedBaselineHash`):**
   - *Location:* Pre-flight forensic log / configuration metadata file `D:\Zentra\database\config\baseline.json` (or pre-flight log artifact).
   - *Verification Contract:* Must be a validated 64-character lowercase hexadecimal string recorded prior to any modification.
   - *Authoritative Physical Filesystem Classification vs Logical Metadata Defect Contract:*
     Triage must rigorously distinguish physical access errors on the metadata store from logical metadata payload defects:
     1. **Corroborated Missing Metadata File (`CONFIRMED_MISSING_METADATA_FILE`):**
        - *Observed Evidence:* Explicit `FileNotFoundException` (Win32 2) upon direct file open, combined with confirmed positive read access to the genuine parent directory.
        - *Establishes:* Baseline metadata file was absent from disk at inspection time.
        - *Required Action:* Tier 2 defect. Route strictly to `REC-STATE-10` (`MALFORMED_HASH_METADATA` / Missing Baseline Metadata). Refuse restoration; lock pipeline.
     2. **Readable Metadata File with Corrupt / Malformed Payload (`CORRUPT_METADATA_PAYLOAD`):**
        - *Observed Evidence:* File exists, readable, valid leaf, but content is unparseable JSON, missing `ExpectedBaselineHash` key, non-string, or not a 64-character lowercase hexadecimal digest.
        - *Establishes:* Metadata file is accessible, but payload fails cryptographic digest format or schema validation.
        - *Required Action:* Tier 2 defect. Route strictly to `REC-STATE-10` (`MALFORMED_HASH_METADATA`). Refuse restoration; lock pipeline.
     3. **Metadata File Physical Filesystem Faults (Tier 1 Physical Precedence):**
        - If probing the metadata file encounters Access Denied (`0x80070005`) $\implies$ `REC-STATE-06`; Sharing Violation (`0x80070020`) $\implies$ `REC-STATE-13`; Byte-Range Lock Violation (`0x80070021`) $\implies$ `REC-STATE-14`; Reparse Point (`ReparsePoint != 0`) $\implies$ `REC-STATE-07`; Missing Parent Directory $\implies$ `REC-STATE-08`; Invalid Path Syntax $\implies$ `REC-STATE-09`; Generic I/O Failure $\implies$ `REC-STATE-12`; or Contradictory Probe Observations $\implies$ `REC-STATE-05`.
        - *Precedence Guarantee:* Tier 1 Physical Precedence strictly enforced. Do NOT infer metadata absence; do NOT route physical access faults to `REC-STATE-10`.
4. **Consumed-Nonce Ledger Record (`.consumed_nonces\<Nonce>`):**
   - *Location:* `D:\Zentra\database\config\.consumed_nonces\`
   - *Verification Contract:* Must exist as a verified normal physical leaf file (non-reparse point). Confirms that the deployment/rollback attempt was recorded in the local consumed-nonce ledger, serving to detect duplicate worker invocations under cooperative execution within the local filesystem boundary and disambiguate worker attribution (not universal replay protection).
   - *Authoritative Consumed-Nonce Ledger Record Physical Filesystem Classification Contract:*
     When probing the consumed-nonce ledger record `D:\Zentra\database\config\.consumed_nonces\<Nonce>` and parent directory `D:\Zentra\database\config\.consumed_nonces\`, operators and automated harnesses must never infer record absence from `[System.IO.File]::Exists($noncePath) -eq $false` alone. Probing the consumed-nonce ledger record must deterministically classify into one of ten distinct outcomes:
     1. **Corroborated Missing Consumed-Nonce Ledger Record (`CONFIRMED_MISSING_NONCE_RECORD`):**
        - *Observed Evidence:* Explicit `FileNotFoundException` / Win32 `ERROR_FILE_NOT_FOUND` (2) returned upon direct file open, combined with confirmed positive read access to the genuine, non-reparse `.consumed_nonces\` parent directory.
        - *Establishes:* Nonce ledger record leaf was absent from `.consumed_nonces\` at inspection time.
        - *Does NOT Establish:* Disk controller failure, or whether transaction ticket was recorded under another identifier.
        - *Uncertainties Remaining:* Operational history of worker execution; whether pre-swap staging commenced.
        - *Required Action:* Tier 2 defect. Route strictly to `REC-STATE-05` (Critical Forensic Halt). Unbound or missing transaction ticket; lock pipeline.
     2. **Readable Nonce Ledger Record with Corrupt Content or Schema Defect (`CORRUPT_NONCE_RECORD_PAYLOAD`):**
        - *Observed Evidence:* File exists, readable, valid non-reparse leaf, but content is unparseable JSON, missing required fields, schema invalid, broken history, unbound IDs/hashes, or stale timestamps.
        - *Establishes:* Record is physically present and readable, but payload fails structural schema, semantic binding, or freshness invariants.
        - *Does NOT Establish:* Physical filesystem failure or hardware corruption.
        - *Uncertainties Remaining:* Process that wrote the malformed JSON; origin of corruption.
        - *Required Action:* Tier 2 defect. Route strictly to `REC-STATE-05` (Critical Forensic Halt). Audit staging worker and lock pipeline.
     3. **Nonce Ledger Access Denied (`NONCE_RECORD_ACCESS_DENIED`):**
        - *Observed Evidence:* `UnauthorizedAccessException` / Win32 `ERROR_ACCESS_DENIED` (`0x80070005`, error 5) when probing nonce record file or `.consumed_nonces\` directory.
        - *Establishes:* Caller's execution token lacks required NTFS DACL read/traverse permissions.
        - *Does NOT Establish:* File absence or existence! If permissions are denied, `File.Exists()` returns `false`, but the ledger record may exist on disk.
        - *Uncertainties Remaining:* File existence, payload content, author provenance, and ACL settings.
        - *Required Action:* **HALT fail-closed (`REC-STATE-06`).** Tier 1 Precedence strictly enforced. Do NOT infer file absence; do NOT route to `REC-STATE-05` as missing record. Audit NTFS ACLs and elevation token.
     4. **Nonce Ledger Sharing Violation (`NONCE_RECORD_SHARING_VIOLATION`):**
        - *Observed Evidence:* `IOException` with Win32 HResult `0x80070020` (`ERROR_SHARING_VIOLATION` / error 32) when opening nonce record file.
        - *Establishes:* An existing open handle holds conflicting sharing flags. Proves nonce record file exists on physical disk!
        - *Does NOT Establish:* Competing deployment worker (may be antivirus, search indexer, backup agent); does not establish lock duration; does not establish payload content.
        - *Uncertainties Remaining:* Holding PID, thread, lock duration, and record content.
        - *Required Action:* **HALT fail-closed (`REC-STATE-13`).** Tier 1 Precedence strictly enforced. Proves file is NOT missing; do NOT route to `REC-STATE-05`. Triage handle holders via Step 4.
     5. **Nonce Ledger Byte-Range Lock Violation (`NONCE_RECORD_LOCK_VIOLATION`):**
        - *Observed Evidence:* `IOException` with Win32 HResult `0x80070021` (`ERROR_LOCK_VIOLATION` / error 33) when reading nonce record file.
        - *Establishes:* Handle opened, but reading a specific byte range conflicted with an existing byte-range lock (`LockFile` / `LockFileEx`). Proves file exists on disk!
        - *Does NOT Establish:* Whole-file sharing violation; does not establish holding process identity; does not establish payload content.
        - *Uncertainties Remaining:* Locking process/thread, byte-range boundaries, and record content.
        - *Required Action:* **HALT fail-closed (`REC-STATE-14`).** Tier 1 Precedence strictly enforced. Do NOT infer absence; do NOT route to `REC-STATE-05`. Triage via Step 4.
     6. **Nonce Ledger Reparse Point Violation (`NONCE_RECORD_REPARSE_POINT_VIOLATION`):**
        - *Observed Evidence:* `([System.IO.File]::GetAttributes($path) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0` on nonce record file or `.consumed_nonces\` directory.
        - *Establishes:* Target path contains an NTFS reparse tag (junction, symlink, mount point).
        - *Does NOT Establish:* Genuine destination legitimacy, safety, or volume integrity.
        - *Uncertainties Remaining:* Real destination path and security posture.
        - *Required Action:* **SECURITY FAULT (`REC-STATE-07`).** Tier 1 Precedence strictly enforced. Do NOT route to `REC-STATE-05`. Strict halt; audit ACLs and remove junction.
     7. **Nonce Ledger Missing Parent Directory (`NONCE_RECORD_MISSING_PARENT_DIRECTORY`):**
        - *Observed Evidence:* `DirectoryNotFoundException` / Win32 `ERROR_PATH_NOT_FOUND` (3) on `D:\Zentra\database\config\.consumed_nonces\`.
        - *Establishes:* The `.consumed_nonces\` directory segment does not exist at read time.
        - *Does NOT Establish:* Root volume failure, or whether nonce directory was configured elsewhere.
        - *Uncertainties Remaining:* Directory creation history, volume mount state.
        - *Required Action:* **HALT fail-closed (`REC-STATE-08`).** Tier 1 Precedence strictly enforced. Structural directory defect; blind directory creation prohibited; do NOT route to `REC-STATE-05` as missing record.
     8. **Invalid or Malformed Nonce Record Path (`NONCE_RECORD_INVALID_PATH`):**
        - *Observed Evidence:* `ArgumentException`, `NotSupportedException`, or `PathTooLongException` on nonce record path string.
        - *Establishes:* Nonce path string is syntactically invalid or exceeds Windows path limits.
        - *Does NOT Establish:* Physical storage state or record presence.
        - *Uncertainties Remaining:* Caller tooling defect; storage remains unprobed.
        - *Required Action:* **HALT fail-closed (`REC-STATE-09`).** Tier 1 Precedence strictly enforced. Tooling defect; fix argument contract; do NOT route to `REC-STATE-05`.
     9. **Nonce Ledger Generic or Unknown I/O Failure (`NONCE_RECORD_IO_FAILURE_UNDETERMINED`):**
        - *Observed Evidence:* `IOException` with unclassified HResult (not `0x80070020`, not `0x80070021`) when probing nonce record file.
        - *Establishes:* Low-level I/O subsystem failure prevented handle creation or reading.
        - *Does NOT Establish:* File presence, absence, permission, or root cause.
        - *Uncertainties Remaining:* Storage controller state, hardware durability.
        - *Required Action:* **HALT fail-closed (`REC-STATE-12`).** Tier 1 Precedence strictly enforced. Do NOT assume file absence; do NOT route to `REC-STATE-05`.
     10. **Indeterminate or Contradictory Nonce Ledger Probe (`NONCE_RECORD_CONTRADICTORY_OR_INDETERMINATE`):**
         - *Observed Evidence:* Observations regarding nonce record are mutually contradictory (e.g. `File.Exists() == false` while open throws access denied or sharing violation; directory enumeration contradicts direct open; or file state fluctuates across calls).
         - *Establishes:* Filesystem state is indeterminate or racing.
         - *Does NOT Establish:* File absence or presence.
         - *Uncertainties Remaining:* True underlying filesystem state of nonce record.
         - *Required Action:* **CRITICAL FORENSIC HALT fail-closed (`REC-STATE-05`).** Tier 1 Precedence strictly enforced. Zero automatic restoration; escalate to Human Incident Commander.
   - *Structured JSON Schema (9 Mandatory Fields):* The record file must contain parseable UTF-8 JSON strictly conforming to the following 9-field contract:
     ```json
     {
       "nonce": "<32-to-64-character alphanumeric string matching filename>",
       "operationId": "<explicit UUID or operation ticket ID matching caller contract>",
       "targetConfigFile": "<postgresql.conf | pg_hba.conf>",
       "timestamp": "<ISO 8601 UTC timestamp of initial consumption>",
       "candidateHash": "<64-character lowercase hexadecimal SHA-256>",
       "expectedBaselineHash": "<64-character lowercase hexadecimal SHA-256>",
       "workerPID": <positive integer process ID of creating worker>,
       "status": "<CONSUMED | ROLLED_BACK | DISCARDED>",
       "history": [
         {
           "sequence": 1,
           "status": "CONSUMED",
           "timestamp": "<ISO 8601 UTC timestamp>",
           "workerPID": <positive integer process ID>,
           "transitionReason": "INITIAL_CONSUMPTION_PRE_SWAP"
         }
       ]
     }
     ```
   - *History Event Object Schema:*
     Every entry in the `history` array must be an object with the following mandatory fields:
     - `sequence`: Strictly positive integer (`1` for initial consumption; `2` for terminal transition).
     - `status`: String enum matching the allowed lifecycle status (`"CONSUMED"`, `"ROLLED_BACK"`, or `"DISCARDED"`).
     - `timestamp`: Valid ISO 8601 UTC string within nominal freshness window (+/- 300s).
     - `workerPID`: Positive integer representing the executing process ID.
     - `transitionReason`: String enum identifying the trigger:
       - `"INITIAL_CONSUMPTION_PRE_SWAP"`: Mandatory for sequence 1.
       - `"AUTOMATED_ROLLBACK_VERIFIED"`: Mandatory for sequence 2 when status transitions to `ROLLED_BACK`.
       - `"CANDIDATE_DISCARD_VERIFIED"`: Mandatory for sequence 2 when status transitions to `DISCARDED`.
   - *Authoritative Invariants of Transition History:*
     1. **Initial Event Invariant:** Entry index 0 in `history` MUST have `"sequence": 1` and `"status": "CONSUMED"`. Writing `ROLLED_BACK` or `DISCARDED` as sequence 1 without prior recorded consumption is strictly illegal and triggers `REC-STATE-05`.
     2. **Cardinality Invariant:** `history` must contain either exactly 1 entry (for active in-flight or aborted swap operations with status `CONSUMED`) or exactly 2 entries (for completed terminal transitions with status `ROLLED_BACK` or `DISCARDED`). Length 0, length > 2, or missing array triggers `REC-STATE-05`.
     3. **Monotonic Sequence Invariant:** Sequence numbers must be strictly contiguous positive integers (`[1]` or `[1, 2]`). Gaps, duplicates, or out-of-order sequence numbers trigger `REC-STATE-05`.
     4. **Monotonic Timestamp Invariant:** In a two-entry history, the timestamp of sequence 2 must be temporally greater than or equal to the timestamp of sequence 1 ($t_2 \ge t_1$). Negative time progression indicates synthetic tampering or clock regression and triggers `REC-STATE-05`.
     5. **Top-Level Status Consistency Invariant:** Top-level `"status"` MUST match the status of the final element in `history` (`history[-1].status`). Any internal divergence between top-level status and history array triggers `REC-STATE-05`.
     6. **Terminal State Immutability Invariant:** Once a record reaches sequence 2 (`ROLLED_BACK` or `DISCARDED`), it is strictly terminal and immutable. Any attempt to record sequence 3, revert to `CONSUMED`, or cross-transition (`ROLLED_BACK <-> DISCARDED`) triggers `REC-STATE-05`.
     7. **NTFS User-Mode Non-Repudiation Boundary:** On mutable NTFS, user-mode JSON files cannot guarantee cryptographic non-repudiation against local administrative tampering, clock rewinds, or VM snapshots. If history cannot be verified or shows internal inconsistency, fail closed to `REC-STATE-05`. Never infer prior state from current status string.
   - *Operation & Target Configuration Binding Contract:*
     - The embedded `operationId` must match the unique transaction ticket or incident identifier of the active execution. A mismatched or empty `operationId` is strictly rejected as UNBOUND.
     - The embedded `targetConfigFile` must match the specific configuration target being modified (e.g. `postgresql.conf` or `pg_hba.conf`). Cross-target reuse is strictly prohibited.
     - The embedded `candidateHash` and `expectedBaselineHash` must match the candidate hash and `ExpectedBaselineHash` of the active transaction exactly. An unbound or mismatched hash record is strictly rejected as INVALID.
   - *Timestamp Freshness, Operation Lifecycle Duration & Chronology Contract:* 
      - **Semantic Meaning of Timestamps:**
        - Top-level `timestamp` and `history[0].timestamp` ($t_1$) represent the exact UTC moment of **initial nonce allocation and consumption** (commencement of candidate validation and pre-swap staging). Top-level `timestamp` MUST strictly match `history[0].timestamp`.
        - `history[1].timestamp` ($t_2$) represents the exact UTC moment of **terminal transition execution** (`ROLLED_BACK` or `DISCARDED`).
      - **Freshness Validation Policy by Lifecycle Stage:**
        1. *Active / In-Flight Triage (`status == "CONSUMED"`, sequence 1):* Evaluated when an operation crashes or is interrupted mid-flight. Initial consumption timestamp $t_1$ must satisfy $|T_{\text{obs}} - t_1| \le 300\text{s}$ ($5\text{ minutes}$) relative to current UTC observation time $T_{\text{obs}}$, with a maximum positive future skew tolerance of $\epsilon_{\text{skew}} = 5\text{s}$. This proves that triage is evaluating an immediate, active failure rather than a historical or abandoned transaction.
        2. *Terminal Transition Assertion (`status == "ROLLED_BACK"` or `"DISCARDED"`, sequence 2):* Evaluated during post-rollback or post-discard assertion (Gates 5 and 6). The terminal transition timestamp $t_2$ must satisfy $|T_{\text{obs}} - t_2| \le 300\text{s}$ relative to observation time. The initial consumption timestamp $t_1$ is NOT evaluated against $T_{\text{obs}}$ directly; instead, the interval between consumption and terminal transition must satisfy the **Maximum Operation Lifecycle Duration**:
           $$0 \le t_2 - t_1 \le \Delta t_{\text{max\_op}} \quad (\text{proposed boundary: } 900\text{ seconds / } 15\text{ minutes})$$
       - **Precedence, Boundaries & Non-Extension Hierarchy:**
         - **The 900-Second Lifecycle Boundary Does NOT Extend Active Triage:** The 900-second maximum lifecycle duration ($\Delta t_{\text{max\_op}}$) applies **exclusively** as an upper bound on total elapsed duration ($t_2 - t_1$) across two-event terminal transition histories. It does **NOT** apply to active in-flight triage and does **NOT** extend, relax, or override the 300-second active-triage freshness window ($\Delta t_{\text{active}}$).
         - **Required Outcome for Interrupted Transactions Older Than 300s but $\le 900\text{s}$:** If an interrupted in-flight transaction is older than 300 seconds (i.e. $300\text{s} < (T_{\text{obs}} - t_1) \le 900\text{s}$), it is strictly classified as **`STALE_NONCE_RECORD` $\implies$ `REC-STATE-05` (Critical Forensic Halt)**. The fact that $T_{\text{obs}} - t_1 \le 900\text{s}$ provides **zero** relief, tolerance, or permission to proceed. Recreation of absent targets or automatic overwrite is strictly prohibited; retries and migrations are locked; runner halts with Exit Code 1.
         - **Terminal Assertion Does NOT Retroactively Validate Stale Active Records:** Terminal assertion evaluates completed two-event records under its own rule ($|T_{\text{obs}} - t_2| \le 300\text{s}$ and $0 \le t_2 - t_1 \le 900\text{s}$). It does **NOT** retroactively make a previously stale active record acceptable. If a transaction stalled in-flight for $> 300\text{s}$ before an automated worker or operator attempted a late transition, or if active triage previously locked out the record, subsequent terminal assertion does NOT retroactively pardon that defect without separate human investigation.
       - **Interrupted & Stalled Operation Triage (No Silent Relaxation):**
        - If an operation was interrupted, delayed, or stalled such that $T_{\text{obs}} - t_1 > 300\text{s}$ during active triage, the record is strictly classified as **`STALE_NONCE_RECORD`**.
        - **Rule of Non-Relaxation:** The system and operator must **NEVER silently expand the freshness window or treat stale evidence as fresh**. A stale nonce record halts execution fail-closed immediately to **`REC-STATE-05`** (`CONTRADICTORY_OR_INDETERMINATE` — Stale Evidence Lockout). Downstream retries and automated overwrites remain strictly locked out; human forensic review is required to investigate the cause of delay.
      - **Classification of Timestamp Anomalies (Mandatory Fail-Closed to `REC-STATE-05`):**
        - *Future-Skewed Timestamp ($t > T_{\text{obs}} + 5\text{s}$):* Classified as `FUTURE_SKEWED_TIMESTAMP` $\implies$ `REC-STATE-05`.
        - *Stale Timestamp ($T_{\text{obs}} - t > 300\text{s}$ for active triage):* Classified as `STALE_NONCE_RECORD` $\implies$ `REC-STATE-05`.
        - *Malformed Syntax (non-ISO 8601, missing `Z` UTC indicator, localized string, or unparseable):* Classified as `MALFORMED_TIMESTAMP` $\implies$ `REC-STATE-05`.
        - *Chronology Regression / Clock Rollback ($t_2 < t_1$ in history):* Classified as `HISTORY_CHRONOLOGY_REGRESSION` $\implies$ `REC-STATE-05`.
        - *Excessive Operation Duration ($t_2 - t_1 > 900\text{s}$):* Classified as `OPERATION_TIMEOUT_ANOMALY` $\implies$ `REC-STATE-05`.
      - **Untested Specification Notice:** The proposed freshness windows ($300\text{s}$), future-skew tolerance ($5\text{s}$), and operation lifecycle duration ($900\text{s}$) are **proposed architectural specifications**, strictly **UNTESTED** on this host. This specification does not authorize execution or guarantee immunity against clock drift.
   - *Creation Mode & Uniqueness:* Must be created using `[System.IO.FileMode]::CreateNew` with `FileShare.None`. If creation fails due to an existing file, the collision triggers an immediate fail-closed halt (`REC-STATE-05`).
   - *Nonce Status Lifecycle & Transition Contract:*
     - `CONSUMED`: Represents active, in-flight transaction consumption of this unique nonce. Set by a deployment worker at the commencement of staging and pre-swap checks.
     - `ROLLED_BACK`: Set only after an automated rollback protocol has completed its file replacement and verified on physical disk that the live configuration has been restored to baseline.
     - `DISCARDED`: Set when candidate configuration staging has been aborted or safely archived to `discarded\postgresql.conf.discard.<Timestamp>.<Nonce>` without promotion.
     - *Permitted Status Transitions:*
       $$\text{Initial (CreateNew)} \implies \text{CONSUMED} \begin{cases} \longrightarrow \text{ROLLED\_BACK} & (\text{Valid ONLY upon verified baseline restoration}) \\ \longrightarrow \text{DISCARDED} & (\text{Valid upon verified candidate discard}) \end{cases}$$
     - *Terminal States:* Both `ROLLED_BACK` and `DISCARDED` are strictly terminal. Backwards transitions (`ROLLED_BACK \to CONSUMED`, `DISCARDED \to CONSUMED`) or cross-transitions (`ROLLED_BACK \longleftrightarrow DISCARDED`) are strictly illegal and trigger an immediate fail-closed halt (`REC-STATE-05`).
   - *Entity Scope & Semantics of Lifecycle Statuses:*
     The status recorded in `.consumed_nonces\<Nonce>` describes the **Overall Operation Lifecycle State** bound to the transaction ticket, not merely the candidate file or staging artifact in isolation:
     - `CONSUMED`: Represents active, in-flight transaction consumption of this unique nonce. Set by a deployment worker at the commencement of staging and pre-swap checks. In an aborted, interrupted, or crashed swap, this remains the authoritative status.
     - `ROLLED_BACK`: Set only after an automated rollback protocol has completed physical file replacement on disk and verified that the live configuration matches `ExpectedBaselineHash` on disk.
     - `DISCARDED`: Set when the candidate configuration staging has been aborted and the candidate configuration has been safely preserved in `discarded\postgresql.conf.discard.<Timestamp>.<Nonce>` while the live configuration remains at baseline.
   - *Reconciliation of `DISCARDED` with Live Candidate State:*
     - **Can `DISCARDED` coexist with `Live == Candidate`? ABSOLUTELY NOT.**
     - If an operation reached the lifecycle state of `DISCARDED`, the candidate configuration was by definition safely archived to the discard directory and **NOT promoted** to live.
     - If the live configuration file on disk matches `CandidateHash` while the ledger record claims `DISCARDED`, this represents an impossible, uncertified, and contradictory state:
       1. The discard operation may have been interrupted or malformed, archiving the candidate to the discard folder but failing to rollback or remove the candidate from `postgresql.conf`, OR
       2. An unauthorized external modification or out-of-order execution placed the candidate file into live after or during discard.
     - **Mandatory Fail-Closed Action:** `DISCARDED` coexisting with `Live == Candidate` is strictly classified as a **`CONTRADICTORY_STATUS_ANOMALY` $\implies$ `REC-STATE-05`** (Critical Forensic Halt). It is never permitted as a valid recovery route.
   - *Strict Permissible Nonce Status for Proposed Human Recovery:*
     - In `REC-STATE-01` (target absent), `REC-STATE-02` (divergent configuration), and `REC-STATE-15` (unpromoted candidate active), the **ONLY** permissible valid nonce status for evaluating proposed human recovery is **`CONSUMED`** (with `history` having exactly 1 event: sequence 1 `CONSUMED`).
     - A status of `ROLLED_BACK` or `DISCARDED` observed when the live target is absent (`REC-STATE-01`), divergent (`REC-STATE-02`), or candidate active (`REC-STATE-15`) represents a **CONTRADICTORY STATUS ANOMALY** and routes strictly fail-closed to **`REC-STATE-05`**.
   - *Reconciliation of `CONSUMED` with Clean Baseline State:*
     - **Can `CONSUMED` Coexist with Clean Baseline Sign-Off? ABSOLUTELY NOT.**
     - An in-flight status of `CONSUMED` represents an active transaction ticket initiated at pre-swap staging.
     - If `Live == Baseline` and the discard artifact is verified on disk, but the ledger status remains `CONSUMED`, this proves the worker crashed, aborted, or was interrupted pre-swap before advancing the lifecycle to `DISCARDED`.
     - This condition is **NOT** a complete, terminal, or certified clean state. Silently ignoring `CONSUMED` or treating it as a clean baseline creates an unmonitored ticket defect and compromises auditability.
     - **Rule of Non-Promotion:** Automated tools and operators must **NEVER silently promote `CONSUMED` to `DISCARDED`** or infer completion merely because the live hash matches baseline or the discard artifact exists.
     - **Dedicated Route (`REC-STATE-16`):** This condition routes strictly to **`REC-STATE-16`** (`UNFINALIZED_IN_FLIGHT_TRANSACTION`). Execution halts fail-closed; the live file is preserved; retries and migrations remain locked until Human Incident Commander forensic review retires or reconciles the ticket under explicit authorization.
     - **The Five Deterministic Outcomes for `Live == Baseline`:**
       1. *`Live == Baseline`, status `CONSUMED`, discard verified on disk:* Worker aborted or interrupted pre-swap before updating ledger. Routes to **`REC-STATE-16`**. Halt fail-closed; preserve live baseline; LOCK PIPELINE; human review required before ticket can be retired.
       2. *`Live == Baseline`, status `CONSUMED`, discard missing or invalid:* Incomplete evidence (missing discard) plus unfinalized in-flight ticket. Routes to **`REC-STATE-03`**. Halt fail-closed; preserve live baseline; LOCK PIPELINE.
       3. *`Live == Baseline`, status `DISCARDED`, all required evidence valid:* Candidate staging aborted and safely archived; live configuration remained at baseline. Verified clean baseline; proceed to **Gate 6 sign-off** (Section 7).
       4. *`Live == Baseline`, status `ROLLED_BACK`, all required evidence valid:* Rollback completed and live baseline verified on physical disk. Verified clean baseline; proceed to **Gate 6 sign-off** (Section 7).
       5. *`Live == Baseline`, status or history disagrees, or completion cannot be established:* Contradictory, missing, stale ($> 300\text{s}$), clock regression ($t_2 < t_1$), timeout ($> 900\text{s}$), or indeterminate evidence. Routes to **`REC-STATE-05`** (Critical Forensic Halt). Halt fail-closed; preserve live baseline; LOCK PIPELINE.
   - *Comprehensive State Compatibility Matrix:*
     The interaction between live physical disk conditions, consumed-nonce ledger statuses, and discard artifact presence maps deterministically as follows:

     | Live Physical Disk Condition | Consumed-Nonce Ledger Status | Discard Artifact Condition | Architectural State Classification | Routing & Remediation Procedure |
     |---|---|---|---|---|
     | `Live == Baseline` | `ROLLED_BACK` (history seq 1 & 2) | Verified on disk (hash == candidate) | Verified Rollback Baseline | Proceed to Gate 6 sign-off (Section 7). Cluster verified clean. |
     | `Live == Baseline` | `DISCARDED` (history seq 1 & 2) | Verified on disk (hash == candidate) | Verified Candidate Discard | Proceed to Gate 6 sign-off (Section 7). Candidate archived, baseline intact. |
     | `Live == Baseline` | `CONSUMED` (history seq 1) | Verified on disk (hash == candidate) | Interrupted Swap (Unfinalized In-Flight Ticket) | `REC-STATE-16`: Halt fail-closed; preserve live baseline; incident UNRESOLVED; LOCK PIPELINE. Ticket unfinalized; human forensic review required. |
     | `Live == Baseline` | `CONSUMED` (history seq 1, fresh & bound) | Corroborated absent on disk (`FileNotFoundException` with verified parent directory) | Incomplete Discard Evidence + Unfinalized Ticket | `REC-STATE-03`: Halt fail-closed; preserve live baseline; incident UNRESOLVED; LOCK PIPELINE. (Evaluated under Tier 3 only when Tier 1 passes and Tier 2 nonce record is 100% valid and fresh). |
     | `Live == Baseline` | `ROLLED_BACK` or `DISCARDED` (fresh & bound) | Corroborated absent on disk (`FileNotFoundException` with verified parent directory) | Incomplete Discard Evidence | `REC-STATE-03`: Halt fail-closed; preserve live baseline; incident UNRESOLVED; LOCK PIPELINE. (Evaluated under Tier 3 only when Tier 1 passes and Tier 2 nonce record is 100% valid and fresh). |
     | `Live == Baseline` | Any valid status (fresh & bound) | Readable on disk, but corrupt hash (`hash != CandidateHash`) or inversion (`hash == BaselineHash`) | Corrupt Discard Content / Inversion Anomaly | `REC-STATE-05`: CRITICAL FORENSIC HALT. (Payload integrity failure; audit golden backup and staging source; LOCK PIPELINE). |
     | `Live == Baseline` | Contradictory, broken history, stale, timeout, or unbound | Verified on disk (hash == candidate) | Contradictory Evidence Anomaly | `REC-STATE-05`: CRITICAL FORENSIC HALT. (Tier 2 nonce defect; preserve live; LOCK PIPELINE). |
     | `Live == Baseline` | Contradictory, broken history, stale, timeout, or unbound | Corroborated absent on disk | Mixed Defect (Tier 2 Nonce Defect + Missing Discard) | `REC-STATE-05`: CRITICAL FORENSIC HALT. (Tier 2 precedence: nonce defect takes precedence over missing discard; preserve live; LOCK PIPELINE). |
     | `Live == Candidate` | `CONSUMED` (history seq 1, fresh & bound) | Verified on disk (hash == candidate) | Aborted Swap (Candidate Active Unpromoted) | `REC-STATE-15`: Proposed Human Restoration Decision under Gate 6 & Sec 4.3. |
     | `Live == Candidate` | `CONSUMED` (history seq 1, fresh & bound) | Corroborated absent on disk (`FileNotFoundException` with verified parent directory) | Missing Discard Evidence | `REC-STATE-04`: Halt fail-closed; preserve live; LOCK PIPELINE. (Evaluated under Tier 3 only when Tier 1 passes and Tier 2 nonce record is 100% valid and fresh). |
     | `Live == Candidate` | `ROLLED_BACK` (any history) | Any (Present or Missing) | Contradictory Status Anomaly | `REC-STATE-05`: CRITICAL FORENSIC HALT. (Claims rolled back, but candidate is live). |
     | `Live == Candidate` | `DISCARDED` (any history) | Any (Present or Missing) | Contradictory Status Anomaly | `REC-STATE-05`: CRITICAL FORENSIC HALT. (Claims candidate discarded, but candidate is live). |
     | `Live == Candidate` | Contradictory, broken history, stale, timeout, or unbound | Corroborated absent on disk | Mixed Defect (Tier 2 Nonce Defect + Missing Discard) | `REC-STATE-05`: CRITICAL FORENSIC HALT. (Tier 2 precedence: nonce defect takes precedence over missing discard `REC-STATE-04`; preserve live; LOCK PIPELINE). |
     | `Live Divergent` | `CONSUMED` (history seq 1, fresh & bound) | Verified on disk (hash == candidate) | Aborted Swap (Partial/Divergent Write) | `REC-STATE-02`: Proposed Human Restoration Decision under Gate 6 & Sec 4.3. |
     | `Live Divergent` | `CONSUMED` (history seq 1, fresh & bound) | Corroborated absent on disk (`FileNotFoundException` with verified parent directory) | Missing Discard Evidence | `REC-STATE-04`: Halt fail-closed; preserve live; LOCK PIPELINE. (Evaluated under Tier 3 only when Tier 1 passes and Tier 2 nonce record is 100% valid and fresh). |
     | `Live Divergent` | `ROLLED_BACK` (any history) | Any (Present or Missing) | Contradictory Status Anomaly | `REC-STATE-05`: CRITICAL FORENSIC HALT. (Claims rolled back, but live diverges). |
     | `Live Divergent` | `DISCARDED` (any history) | Any (Present or Missing) | Contradictory Status Anomaly | `REC-STATE-05`: CRITICAL FORENSIC HALT. (Claims discarded, but live diverges). |
     | `Live Divergent` | Contradictory, broken history, stale, timeout, or unbound | Corroborated absent on disk | Mixed Defect (Tier 2 Nonce Defect + Missing Discard) | `REC-STATE-05`: CRITICAL FORENSIC HALT. (Tier 2 precedence: nonce defect takes precedence over missing discard `REC-STATE-04`; preserve live; LOCK PIPELINE). |
     | `Target Absent` | `CONSUMED` (history seq 1, fresh & bound) | Verified on disk (hash == candidate) | Aborted Swap (Target Removed Mid-Swap) | `REC-STATE-01`: Mandatory Human Escalation; Proposed Recreation under Gate 6 & Sec 4.3. |
     | `Target Absent` | `CONSUMED` (history seq 1, fresh & bound) | Corroborated absent on disk | Incomplete Discard Evidence + Absent Target | `REC-STATE-05`: CRITICAL FORENSIC HALT. (Target absent, discard evidence missing; recreation strictly forbidden; LOCK PIPELINE). |
     | `Target Absent` | `ROLLED_BACK` (any history) | Any (Present or Missing) | Contradictory Status Anomaly | `REC-STATE-05`: CRITICAL FORENSIC HALT. (Claims rolled back, but target is absent). |
     | `Target Absent` | `DISCARDED` (any history) | Any (Present or Missing) | Contradictory Status Anomaly | `REC-STATE-05`: CRITICAL FORENSIC HALT. (Claims discarded, but target is absent). |
     | `Target Absent` | Contradictory, broken history, stale, timeout, or unbound | Any (Present or Missing) | Contradictory Evidence Anomaly | `REC-STATE-05`: CRITICAL FORENSIC HALT. (Target absent + nonce defect; recreation strictly forbidden; LOCK PIPELINE). |
     | Any Live Condition | Any Status | Physical Filesystem Fault on Discard (`0x80070005`, `0x80070020`, `0x80070021`, reparse point, missing parent `discarded\`, invalid path, generic I/O, or indeterminate probe) | Physical Filesystem Fault on Supporting Discard Artifact | Routes strictly to Tier 1 state (`REC-STATE-06`, `13`, `14`, `07`, `08`, `09`, `12`, or `05`). Tier 1 precedence enforced; do NOT infer discard file absence; do NOT route to `REC-STATE-03` or `REC-STATE-04`. |
      | Any Live Condition | Any Status | Physical Filesystem Fault on Golden Backup (`0x80070005`, `0x80070020`, `0x80070021`, reparse point, missing parent `config\`, invalid path, generic I/O, or indeterminate probe) | Physical Filesystem Fault on Supporting Golden Backup Artifact | Routes strictly to Tier 1 state (`REC-STATE-06`, `13`, `14`, `07`, `08`, `09`, `12`, or `05`). Tier 1 precedence enforced; do NOT infer golden backup absence; do NOT route to `REC-STATE-05` as missing/corrupt backup. |
      | Any Live Condition | Any Status | Physical Filesystem Fault on Consumed-Nonce Ledger (`0x80070005`, `0x80070020`, `0x80070021`, reparse point, missing parent `.consumed_nonces\`, invalid path, generic I/O, or indeterminate probe) | Physical Filesystem Fault on Supporting Nonce Ledger Artifact | Routes strictly to Tier 1 state (`REC-STATE-06`, `13`, `14`, `07`, `08`, `09`, `12`, or `05`). Tier 1 precedence enforced; do NOT infer nonce record absence; do NOT route to `REC-STATE-05` as missing/unbound ledger record. |
      | Any Live Condition | Any Status | Physical Filesystem Fault on Baseline Metadata File (`0x80070005`, `0x80070020`, `0x80070021`, reparse point, missing parent `config\`, invalid path, generic I/O, or indeterminate probe) | Physical Filesystem Fault on Supporting Baseline Metadata File | Routes strictly to Tier 1 state (`REC-STATE-06`, `13`, `14`, `07`, `08`, `09`, `12`, or `05`). Tier 1 precedence enforced; do NOT infer metadata absence; do NOT route to `REC-STATE-10` as missing/malformed hash metadata. |

   - *Five-Tier Verification Hierarchy:*
     1. **Tier 1 — Physical Leaf Existence & Path Integrity:** File exists at canonical path; verified genuine physical NTFS leaf; parent directory and file have `ReparsePoint == 0`.
     2. **Tier 2 — Structural JSON Validity & 9-Field Schema:** Parses as valid UTF-8 JSON strictly conforming to schema; all 9 fields present, non-empty, and correctly typed; `history` is non-empty array conforming to event schema.
     3. **Tier 3 — Operation & Configuration Target Binding:** Embedded `nonce`, `operationId`, `targetConfigFile`, `candidateHash`, and `expectedBaselineHash` match active transaction context exactly.
     4. **Tier 4 — Nonce Consumption, Lifecycle Freshness & Transition Invariants:** Timestamp is within $\pm 300\text{s}$; status is a valid enum value; `history` satisfies all 7 invariants (monotonic sequence, monotonic timestamp, sequence 1 is `CONSUMED`, top-level status matches latest history event); and status is lifecycle-compatible with observed recovery state per the compatibility matrix.
     5. **Tier 5 — Final State Verification:** Independent physical disk assertion of live configuration SHA-256, golden backup SHA-256, and discard artifact SHA-256. (A ledger record alone NEVER certifies final state).
   - *Rule of Non-Inference from Ledger Status:*
     A status string of `ROLLED_BACK` or `DISCARDED` in the ledger must **NEVER** be inferred as proof of clean restoration, successful rollback, or database catalog integrity. Final state is certified ONLY by independent physical disk measurement.
   - *Authoritative Multi-Tier Failure Precedence Hierarchy & Mixed-Defect Resolution:*
     To eliminate ambiguity when multiple concurrent defects occur, all triage evaluations are governed by an authoritative four-tier precedence hierarchy. Higher-tier failures take absolute precedence over lower-tier failures:
     1. **Tier 1 — Physical Filesystem Errors & Indeterminate Probes (Highest Precedence):**
        - *Defects:* Invalid path syntax (`REC-STATE-09`), missing parent directory (`REC-STATE-08`), NTFS access denied / `0x80070005` (`REC-STATE-06`), file sharing violation / `0x80070020` (`REC-STATE-13`), byte-range lock violation / `0x80070021` (`REC-STATE-14`), reparse point / junction infiltration (`REC-STATE-07`), hash helper crash (`REC-STATE-11`), generic/unclassified I/O failure (`REC-STATE-12`), or contradictory/indeterminate physical probes (`REC-STATE-05`) encountered on the live configuration target, golden backup, consumed-nonce ledger record, baseline metadata file, or discard artifact.
        - *Precedence Action:* Evaluated during initial disk probes and evidence inspection. Halts fail-closed immediately; zero file modification; supersedes all subsequent tiers. Physical faults on ANY supporting artifact probe (golden backup, nonce ledger, baseline metadata file, discard artifact) or live target must NEVER be inferred as file absence, and must NEVER be routed to Tier 2 (`REC-STATE-05`, `REC-STATE-10`) or Tier 3 (`REC-STATE-03`, `REC-STATE-04`).
     2. **Tier 2 — Nonce Ledger, History, Timestamp & Golden Backup Defects (Evaluated FIRST among supporting evidence when Tier 1 physical checks pass with ZERO faults):**
        - *Defects:* Golden backup missing, empty, or hash mismatch (`REC-STATE-05`); baseline metadata missing or corrupt payload (`REC-STATE-10`); nonce ledger record missing, zero-byte, unparseable, or schema-invalid (`REC-STATE-05`); unbound record (`operationId`, `targetConfigFile`, `candidateHash`, or `expectedBaselineHash` mismatch; `REC-STATE-05`); malformed timestamp or future skew $> 5\text{s}$ (`REC-STATE-05`); stale in-flight active record $> 300\text{s}$ (`REC-STATE-05`); stale terminal record $> 300\text{s}$ or lifecycle duration $> 900\text{s}$ (`REC-STATE-05`); history sequence non-monotonicity, missing array, length $> 2$, or sequence 1 not `CONSUMED` (`REC-STATE-05`); history clock regression / rollback ($t_2 < t_1$; `REC-STATE-05`); top-level status diverged from `history[-1].status` (`REC-STATE-05`); or contradictory status vs observed physical disk condition (e.g. `DISCARDED` or `ROLLED_BACK` observed when live target is candidate active, divergent, or absent $\implies$ `REC-STATE-05`).
        - *Precedence Action:* Evaluated FIRST among all supporting evidence when Tier 1 physical checks pass with zero faults. If ANY Tier 2 defect exists, execution halts fail-closed immediately to `REC-STATE-05` (or `REC-STATE-10`). Tier 2 defects take absolute precedence over Tier 3 missing discard artifacts.
     3. **Tier 3 — Missing Supporting Discard Artifact or Content Inversion (Evaluated ONLY when Tiers 1 & 2 are 100% Valid):**
        - *Defects:* Discard artifact is corroborated absent from disk (explicit `FileNotFoundException` with verified genuine non-reparse `discarded\` parent directory; `File.Exists() == false` alone strictly rejected); or readable discard file exhibits corrupt hash (SHA-256 $\neq$ `CandidateHash`) or inversion anomaly (SHA-256 == `ExpectedBaselineHash`). Evaluated ONLY when Tier 1 physical checks pass and Tier 2 nonce ledger and golden backup are 100% verified, valid, bound, and fresh.
        - *Precedence Routing:*
          - Target confirmed absent + discard corroborated absent $\to$ `REC-STATE-05` (Critical Forensic Halt; recreation strictly forbidden).
          - `Live == Baseline` + discard corroborated absent (Tier 2 nonce valid & fresh) $\to$ `REC-STATE-03` (`VERIFIED_HASH_MATCH` — Incomplete Forensic Evidence).
          - `Live != Baseline` (Candidate or Divergent) + discard corroborated absent (Tier 2 nonce valid & fresh) $\to$ `REC-STATE-04` (`UNVERIFIED_CANDIDATE_OR_DIVERGENT` — Missing Discard Evidence).
          - Readable discard file with hash $\neq$ `CandidateHash` or hash == `ExpectedBaselineHash` $\to$ `REC-STATE-05` (Critical Forensic Halt; payload integrity failure).
        - *Precedence Guarantee:* Any Tier 1 physical fault on discard routes to Tier 1; any Tier 2 nonce defect (e.g. stale nonce, corrupt history, unbound record) or backup defect coexisting with a missing discard artifact routes strictly to `REC-STATE-05` under Tier 2 precedence. Missing discard evidence NEVER masks, demotes, or suppresses a Tier 1 or Tier 2 defect.
     4. **Tier 4 — Valid, Fully Evidenced State-Specific Recovery Routes (Evaluated ONLY when Tiers 1–3 are 100% Verified):**
        - *Preconditions:* All 4 mandatory supporting evidence items 100% verified with valid binding, active or terminal freshness, monotonic history, and compatible lifecycle status.
        - *Routing:*
          - `Live == Baseline` + status in `{"ROLLED_BACK", "DISCARDED"}` (seq 1 & 2, fresh) $\to$ Gate 6 Sign-Off (Section 7).
          - `Live == Baseline` + status `CONSUMED` (seq 1, fresh) $\to$ `REC-STATE-16` (Halt fail-closed; preserve live; LOCK PIPELINE; human review required).
          - `Live == Candidate` + status `CONSUMED` (seq 1, fresh) $\to$ `REC-STATE-15` (Proposed Human Restoration Decision under Gate 6 & Sec 4.3).
          - `Live Divergent` + status `CONSUMED` (seq 1, fresh) $\to$ `REC-STATE-02` (Proposed Human Restoration Decision under Gate 6 & Sec 4.3).
          - `Target Confirmed Absent` + status `CONSUMED` (seq 1, fresh) $\to$ `REC-STATE-01` (Proposed Human Recreation Decision under Gate 6 & Sec 4.3).
     - *The Rule of Mixed-Defect Precedence:*
       When an incident triage uncovers multiple concurrent anomalies (such as a missing discard artifact AND a stale nonce record, or a discard access denied AND missing nonce), the incident must be routed to the failure state associated with the highest-precedence tier (Tier 1 > Tier 2 > Tier 3 > Tier 4). Lower-tier conditions (such as missing discard artifact in Tier 3) must NEVER mask, demote, or suppress higher-tier defects (such as physical filesystem errors in Tier 1 or stale nonce / contradictory history in Tier 2).

> [!CAUTION]
> **MANDATORY EVIDENCE LOCKOUT:**  
> If ANY artifact from this four-item list is missing, unreadable, malformed, corrupt, contradictory, or unverifiable, restoration is **STRICTLY PROHIBITED**, the current live file must be **PRESERVED WITHOUT AUTOMATIC OVERWRITE**, and downstream retries and migrations remain **STRICTLY LOCKED OUT**.

### 4.2.1 Nonce Ledger Local Guarantees vs Operating-System Boundaries

Operators and automated harnesses must recognize the exact physical and operating-system boundaries of what local filesystem ledger verification establishes and what it *cannot* guarantee. Specifically, `[System.IO.FileMode]::CreateNew`, file existence, a recent timestamp, a 9-field schema with `history` events, and matching cryptographic hashes do **not** individually or collectively provide universal replay protection.

1. **What Local Ledger Verification Establishes:**
   - A physical leaf file named `<Nonce>` was successfully created on disk at `D:\Zentra\database\config\.consumed_nonces\<Nonce>` without local collision.
   - The payload contains parseable UTF-8 JSON strictly conforming to the required 9-field schema, binding the transaction to the specific `operationId`, `targetConfigFile`, `candidateHash`, and `expectedBaselineHash`.
   - The embedded timestamp is within the nominal $\pm 300\text{s}$ freshness window.
   - The `history` array records a valid monotonic sequence of transition events complying with the 7 invariants.
   - Within the local operating system session, this specific nonce string has not been reused by an automated worker complying with the protocol.

2. **What Local Ledger Verification CANNOT Guarantee (Physical & OS Boundaries):**
   - **Host Clock Rollback / Time Skew:** If the local host system clock is stepped backward (via NTP re-synchronization, hypervisor time adjustments, or manual administrative alteration), previously consumed nonce records could falsely evaluate as "fresh" within the $\pm 300\text{s}$ window.
   - **Virtual Machine Snapshots & Backup Restoration:** If the local host or volume is reverted to a previous VM snapshot or restored from an earlier filesystem backup, nonce files created after the snapshot point disappear completely from disk. In this scenario, an identical nonce can be re-issued and re-consumed without local detection.
   - **Administrative Tampering & Rogue Processes:** Local filesystem checks cannot protect against an elevated administrative account (`SYSTEM`, local Administrator) or rogue process modifying, injecting, or deleting records within `.consumed_nonces\`.
   - **Process Identity (PID) Recycling:** Windows PIDs are eagerly recycled by the kernel. The `workerPID` field recorded in the nonce provides diagnostic attribution only; it cannot guarantee that a process holding that PID at audit time is the original worker.
   - **SSD DRAM Controller Cache & Power-Loss Limits:** On consumer workstation hardware ($0 budget), SSDs lack Power-Loss Protection (PLP). An un-flushed write or power cut immediately following creation can lose data from drive controller cache even if reported flushed by user-mode APIs.
   - **Universal Multi-Node Replay Protection:** Local file ledger verification provides zero cross-machine or multi-node replay guarantees; it operates strictly as a single-node host arbitration artifact.

### 4.2.2 Safe Nonce Status Transition Lifecycle, Staged Updates & Interrupted-Write Semantics

To prevent corrupt, truncated, or zero-byte ledger records during status transitions, automated tools and operators must adhere to strict write semantics:

1. **Initial Nonce Creation Protocol (`CreateNew`):**
   - The initial record is created using `[System.IO.FileMode]::CreateNew` with `FileShare.None`.
   - The file payload is generated with `"status": "CONSUMED"` and a single history event (`sequence: 1`, `status: "CONSUMED"`, `transitionReason: "INITIAL_CONSUMPTION_PRE_SWAP"`).
   - If `CreateNew` throws `IOException` (`ERROR_FILE_EXISTS`), a nonce collision is detected; execution halts immediately fail-closed (`REC-STATE-05`).

2. **Terminal Transition Update Protocol (Staged Sibling Write & Replace):**
   - Direct in-place editing or file truncation (`FileMode.Open` / `FileMode.Truncate`) of `.consumed_nonces\<Nonce>` is **strictly prohibited** because a crash during write would leave the primary ledger file zero-byte or corrupt.
   - The worker must create a temporary sibling file:
     - **Staging Path:** `D:\Zentra\database\config\.consumed_nonces\<Nonce>.tmp.<PID>`
   - The staging file is written with `CreateNew` and `FileShare.None`, containing the updated 9-field JSON:
     - Top-level `status` updated to `"ROLLED_BACK"` or `"DISCARDED"`.
     - Appended `sequence: 2` entry in `history` with monotonic timestamp and matching worker PID.
   - The worker flushes buffers to disk (`FlushFileBuffers`).
   - The staging file replaces the target `<Nonce>` file using a proposed replacement primitive (such as Win32 `ReplaceFileW` or `[System.IO.File]::Replace()`), intended to update directory entries and remove the temporary sibling file.  
    - **Host & API Replacement Limitations:** On this Windows/NTFS host, `ReplaceFileW` does **NOT** guarantee end-to-end atomicity, durability across sudden electrical loss, or concurrency safety:
      - *Intermediate Crash Window:* A system crash or process death between the staging write and the replacement call leaves the staging file orphaned.
      - *Handle and Sharing Conflicts:* If any process or thread holds an open handle without delete/sharing access on either file, `ReplaceFileW` fails with `ERROR_SHARING_VIOLATION` (`0x80070020`).
      - *Permission and Deletion Failures:* If NTFS permissions or read-only attributes prevent removing the replaced file, `ReplaceFileW` fails with `ERROR_UNABLE_TO_REMOVE_REPLACED` (1175) or `ERROR_ACCESS_DENIED` (`0x80070005`).
      - *Storage Controller Volatility:* Consumer workstation SSDs without Power-Loss Protection (PLP) can drop cached directory metadata on power loss even after API success.
   - If the target file is locked by another handle (`0x80070020`), the worker must back off and retry boundedly; if unresolvable within timeout, halt fail-closed (`REC-STATE-13`).

3. **Interrupted-Write Recovery & Triage:**
   - If an automated crash occurs during a transition write, triage may observe an orphaned `.tmp.<PID>` sibling file alongside `<Nonce>`.
   - **Evaluation Rule:**
     - If the primary `<Nonce>` file exists, parses as valid JSON, and satisfies all invariants, the primary file is authoritative. The stray `.tmp.<PID>` file is treated as an abandoned write artifact, logged, and quarantined.
     - If the primary `<Nonce>` file is missing, truncated, zero-byte, or corrupt, the state MUST be classified as **`CONTRADICTORY_OR_INDETERMINATE` (`REC-STATE-05`)** and halt fail-closed. Automatic promotion of the `.tmp.<PID>` file to primary `<Nonce>` is **strictly prohibited**.

4. **Strict Non-Authorization & Architectural Design Notice:**
   - > [!CAUTION]
   - > **UNTESTED SPECIFICATION NOTICE:**  
   - > The staged update, replacement, and concurrency mechanisms described in this section are **proposed architectural design specifications**, NOT verified or tested runtime implementations. True filesystem crash-safety and atomicity depend on NTFS driver behavior, disk controller caching, and user-mode API constraints, all of which remain strictly **UNTESTED** on this host. This document does NOT authorize automated execution or claim that status replacement is tested or safe.

### 4.3 Proposed Manual File Restoration Protocol & Replacement Semantics Specification

> [!CAUTION]
> **COPY IS NOT ATOMIC:**  
> A naive copy operation (such as `[System.IO.File]::Copy($src, $dst, $true)`) is **NOT an atomic restoration primitive**. On Windows NTFS, `CopyFile` with overwrite opens the destination, truncates it, and copies byte chunks. If a system crash, power loss, or external process read occurs during this window, the live file is left corrupted or truncated.

#### Required Operational Restoration Semantics
Any future operational implementation authorized by the Human Incident Commander must adhere to these strict replacement semantics:
1. **Source Backup Verification:** The golden backup must be verified on disk as a normal leaf file, and its SHA-256 hash must be independently confirmed equal to `ExpectedBaselineHash` immediately prior to replacement.
2. **Missing Evidence Lockout:** No file overwrite or restoration procedure may ever be executed if any required supporting evidence from the authoritative four-item supporting-evidence list (golden backup, discard artifact, baseline metadata, or consumed-nonce ledger record) is missing, unreadable, contradictory, or indeterminate.
3. **Proposed Replacement Semantics & Inherent Host Limitations:** Must use proposed replacement semantics (such as a proposed Win32 `ReplaceFileW` call targeting a verified staging copy, or a validated staging-and-rename sequence) designed to minimize the truncation exposure window compared to `CopyFile`.  
   - *Inherent Host Boundaries:* A replacement primitive alone does **NOT** establish end-to-end safety, concurrency safety, or durability across power loss on this host:
     - On Windows NTFS, `ReplaceFileW` requires write and delete permissions on destination and replacee; it will fail with `ERROR_UNABLE_TO_REMOVE_REPLACED` (1175) or `ERROR_ACCESS_DENIED` (`0x80070005`) if ACLs or attributes prevent deletion.
     - `ReplaceFileW` fails immediately with `ERROR_SHARING_VIOLATION` (`0x80070020`) if any process holds an open handle without delete/share flags.
     - An intermediate crash window exists between staging file creation and replacement invocation.
     - Consumer workstation SSD storage without Power-Loss Protection (PLP) buffers disk writes; a sudden power loss can drop unflushed metadata or directory entries even after user-mode flush.
   - *Untested Specification Notice:* These replacement operations are proposed architectural specifications, NOT verified guarantees; crash-safety and filesystem atomicity depend on underlying NTFS implementation constraints and remain strictly **UNTESTED** on this host. This runbook does not authorize automated execution or claim that replacement is tested or safe.
4. **Validated Paths:** Both source and destination paths must be canonicalized and confirmed to be non-reparse points, with the parent directory verified to exist as a genuine physical directory.
5. **Pre- and Post-Verification Semantics:**
   - **For Existing Target Overwrite (`REC-STATE-02` and `REC-STATE-15`):**
     - **For Divergent Target (`REC-STATE-02`):** The existing live file must be measured immediately before replacement (confirming it diverges from both baseline and candidate), all four supporting artifacts from the authoritative list confirmed verified on disk with valid operation binding and freshness, and the restored file measured immediately after replacement.
     - **For Unpromoted Candidate Active (`REC-STATE-15`):** The existing live file must be measured immediately before replacement (confirming it matches candidate following an aborted swap; strictly uncertified), all four supporting artifacts from the authoritative list confirmed verified on disk with valid operation binding and freshness, and the restored file measured immediately after replacement.
   - **For Absent Target Recreation (`REC-STATE-01`):** Target absence must be **corroborated** immediately before recreation (reliance on `File.Exists() == false` alone is strictly prohibited; requires confirmed positive read access to the parent directory and explicit Win32 `ERROR_FILE_NOT_FOUND` / `FileNotFoundException`); parent directory integrity verified as a genuine physical non-reparse point directory; all four supporting artifacts from the authoritative list confirmed verified on disk with valid operation binding and freshness; and the newly restored file measured immediately after creation.
6. **Explicit Human Sign-Off (Non-Authorization):** Recreating a missing live target or overwriting a mismatched live file is strictly a *proposed, separately approved human recovery decision*. No script may execute this restoration automatically; each step requires interactive Human Incident Commander confirmation under a separately approved operational procedure. This protocol is strictly untested on this host and does not authorize automated execution or claim that restoration is tested or safe.

---

## 5. Fail-Closed Rules

The following non-negotiable fail-closed rules govern all manual and automated operations:

1. **Rule of Forensic Evidence Categorization & Missing Evidence Lockout:**  
   Operators and automated handlers must rigorously differentiate between live target presence, supporting forensic evidence, and indeterminate states:
   - **`File.Exists() == false` Semantics Warning & All-Artifact Probe Invariant:** .NET `[System.IO.File]::Exists($path)` catches and suppresses exceptions, returning `false` for permissions errors (`UnauthorizedAccessException` / `0x80070005`), sharing violations (`0x80070020`), byte-range lock violations (`0x80070021`), invalid path syntax, paths exceeding length limits, directory-junction redirection, missing parent directory, and low-level I/O faults. Therefore, `File.Exists() == false` alone **NEVER** constitutes proof of physical file absence for the live configuration target, golden backup, consumed-nonce ledger record, baseline metadata file, OR discard artifact. Probing ANY required artifact must strictly adhere to its authoritative physical filesystem classification contract. Any physical error encountered during artifact probing (Access Denied `0x80070005`, Sharing Violation `0x80070020`, Lock Violation `0x80070021`, Reparse Point, Missing Parent Directory, Invalid Path, Generic I/O, or Indeterminate Probe) constitutes a **Tier 1 physical filesystem fault** taking absolute precedence over Tier 2 and Tier 3 checks, routing immediately to Tier 1 states (`REC-STATE-06`, `13`, `14`, `07`, `08`, `09`, `12`, or `05`). Inferring artifact absence from a failed probe or reclassifying physical faults as missing evidence or logical defects is **STRICTLY PROHIBITED**. Tier 3 missing-discard handling applies ONLY to corroborated missing discard files (explicit `FileNotFoundException` with verified genuine non-reparse parent directory read access) when Tier 1 and Tier 2 pass with zero defects.
   - **Category 1 — Missing Required Supporting Evidence:** If any required supporting forensic artifact from the authoritative four-item supporting-evidence list (golden backup, discard artifact, baseline metadata `ExpectedBaselineHash`, or consumed-nonce ledger record) is missing, unreadable, malformed (schema/JSON defect), unbound (operationId, targetConfigFile, or hash mismatch), stale (active in-flight triage outside $\pm 300\text{s}$ window, noting 900s lifecycle duration strictly does NOT extend active triage; or terminal assertion outside $\pm 300\text{s}$ or exceeding 900s lifecycle limit), contradictory (lifecycle status inconsistent with recovery state, such as `DISCARDED` or `ROLLED_BACK` observed when live file is candidate active, absent, or divergent; or missing/broken `history` array), or unverifiable, the system **MUST STOP IMMEDIATELY**.
     - **Multi-Tier Failure Precedence Mandate:** When multiple supporting evidence defects coexist, Tier 2 defects (nonce ledger missing, unparseable, unbound, stale $>300\text{s}$, clock regression $t_2 < t_1$, duration $>900\text{s}$, history non-monotonicity, contradictory status, or golden backup mismatch) take strict precedence over Tier 3 missing discard evidence. If a Tier 2 defect exists, execution halts strictly to `REC-STATE-05`. The missing discard routes (`REC-STATE-03` and `REC-STATE-04`) apply IF AND ONLY IF Tier 1 passes and Tier 2 evidence is 100% verified, valid, bound, and fresh. A missing discard artifact must NEVER mask, suppress, or demote a coexisting Tier 1 or Tier 2 defect.
     - **Discard Content Corrupt or Inverted:** If the discard artifact is readable on disk but its SHA-256 digest differs from `CandidateHash` or equals `ExpectedBaselineHash` (payload integrity failure or inversion anomaly), execution halts strictly to `REC-STATE-05`.
     - If the discard artifact is corroborated missing (regardless of whether the live configuration matches baseline in `REC-STATE-03` or matches candidate / divergent in `REC-STATE-04`), the current live file must be **preserved without automatic overwrite**.
     - If the discard artifact is corroborated missing when the live target is confirmed absent, the system **MUST HALT FAIL-CLOSED TO `REC-STATE-05`**; recreation of the missing target from golden backup is **STRICTLY PROHIBITED**.
     - **Do NOT infer that restoration is safe merely because the golden backup appears valid.**
     - Overwriting or creating configuration files when any required supporting evidence is missing, unreadable, contradictory, or indeterminate is strictly prohibited.
     - The incident **CANNOT be certified as clean, resolved, or restored**. Downstream migrations and retries remain **STRICTLY LOCKED OUT** until a Human Incident Commander conducts forensic review under a separately approved procedure.
   - **Category 2 — Indeterminate Filesystem State:** If filesystem state cannot be reliably distinguished from access errors (`ACCESS_DENIED` / `0x80070005`), sharing violations (`0x80070020`), byte-range lock violations (`0x80070021`), path resolution/syntax errors, directory-junction redirection, or unclassified I/O failures (`IO_FAILURE_CAUSE_UNDETERMINED`), the system **MUST STOP IMMEDIATELY**. Overwriting, creating, or modifying files in an indeterminate state is strictly prohibited. An indeterminate filesystem state requires an immediate forensic halt, but does not by itself establish that the database or its catalogs are damaged.
   - **Category 3 — Confirmed Missing Live Target:** If the target live configuration file (`postgresql.conf` or `pg_hba.conf`) is corroborated absent on disk (via explicit `FileNotFoundException` / Win32 `ERROR_FILE_NOT_FOUND` / 2, with positive parent directory access verified, not merely `File.Exists() == false`), with its parent directory confirmed to exist, verified as a genuine physical non-reparse point directory, and path integrity fully verified:
     - This state is **NOT an automated recovery path**. It triggers **mandatory human escalation** under Section 12 Trigger #2.
     - If and only if the consumed-nonce ledger record reports status strictly `CONSUMED` with monotonic `history` sequence 1 (status `ROLLED_BACK` or `DISCARDED` triggers `REC-STATE-05`), and every required supporting artifact from the authoritative four-item supporting-evidence list (golden backup, discard artifact, baseline metadata, and consumed-nonce ledger record) is independently verified on disk, recreating the live target from golden backup is described solely as a **proposed, separately approved human recovery decision** under Gate 6 and Section 4.2 / 4.3.
     - If any supporting artifact (including the discard artifact) is missing, unreadable, or malformed, recreation is strictly forbidden and execution halts fail-closed to `REC-STATE-05`.
     - Automatic restoration is **strictly prohibited**. It is unverified and untested on this host, and this document does not authorize execution or claim it is tested or safe.
2. **Rule of Non-Inference:** Success must **NEVER** be inferred from:
   - A zero process exit code alone.
   - An exception message string (e.g. `"*OUTCOME 4*"`).
   - The mere physical existence of a file on disk.
   - The mere physical existence of a file in `.consumed_nonces\` (does not prove valid schema, operation binding, or freshness without JSON inspection).
   - A `ROLLED_BACK` or `DISCARDED` status string in the consumed-nonce ledger record (must NEVER be inferred as proof of clean restoration, successful rollback, or catalog health without independent physical disk verification).
   - The presence of a `history` event array or monotonic timestamps alone (must NOT be inferred as tamper-proof evidence on mutable NTFS against administrative manipulation, clock rewinds, or VM snapshots).
   - A status of `DISCARDED` (must NEVER be inferred as compatible with a live configuration matching candidate; this is a contradictory status anomaly).
   - A nonce ledger record with valid JSON (must NEVER be inferred as valid if unbound to the active operation ID or targeting a different configuration file).
   - A live configuration file matching the candidate hash (must NEVER be inferred as a certified or permitted promotion; it is an uncertified candidate state requiring `REC-STATE-15` triage).
   - Nonce ledger presence alone (must NOT be inferred as universal replay protection against VM snapshots, backup reverts, or clock tampering).
   - A non-zero byte length (`Length > 0`).
   - An in-memory object claim without physical disk corroboration.
   - A configuration hash match alone (does not prove database catalogs are intact).
   - A live configuration matching the baseline hash when ledger status is `CONSUMED` (must NEVER be inferred as a clean, complete, or terminal state; it represents an active in-flight ticket unfinalized pre-swap, requiring `REC-STATE-16` halt fail-closed, live file preservation, pipeline lockout, and human forensic review).
   - The presence of a verified discard artifact alone or live hash matching baseline alone (must NEVER be inferred as proof of completed operation or authorization to bypass `REC-STATE-16` or silently promote `CONSUMED` to `DISCARDED`).
   - A missing discard artifact alone (must NEVER be inferred as the sole or controlling failure state when higher-severity Tier 2 nonce ledger or golden backup defects coexist; Tier 2 defects take absolute precedence and halt to `REC-STATE-05`).
   - A failed file probe or exception on ANY supporting artifact path (golden backup, nonce ledger, baseline metadata file, discard artifact) or live target (must NEVER be inferred as file absence; physical filesystem faults on any artifact probe are Tier 1 defects routing strictly to Tier 1 states).
   - A missing file claim for any supporting artifact without direct handle corroboration (must NEVER be inferred from `File.Exists() == false` alone).
   - A sharing violation (`0x80070020`) or byte-range lock violation (`0x80070021`) on golden backup, nonce ledger, or metadata file (must NEVER be inferred as missing or corrupt file; handle conflicts prove the physical file exists on disk and route strictly to Tier 1 states `REC-STATE-13` or `REC-STATE-14`).
   - A readable discard file on disk (must NEVER be inferred as valid discard evidence without SHA-256 calculation matching `CandidateHash` and verifying divergence from `ExpectedBaselineHash`).
   - A proposed replacement primitive execution (such as `ReplaceFileW` returning success) alone (must NEVER be inferred as guaranteed durability or atomic commit across power loss on consumer workstation SSD hardware lacking PLP).
   - A timestamp in a ledger record alone (must NOT be inferred as immune to administrative clock adjustment, time skew, or host time synchronization jumps).
3. **Rule of Lockout:** Any non-zero exit code (including `1`, `105`, and process timeouts) **strictly locks out** automated CI/CD retries and blocks all downstream database migrations.
4. **Rule of Unverified Cleanup:** If process-tree termination cannot be independently confirmed, the state is categorized as `PROCESS_CLEANUP_UNCERTAIN` and downstream execution is strictly prohibited.

---

## 6. PowerShell & .NET Filesystem Limitations

Operators must understand the fundamental physical and operating-system limitations of Windows user-mode filesystem interactions:

### 6.1 TOCTOU Race Windows (Windows A, B, C, D)
- **Window A (Pre-Flight live read to golden backup creation):** An external process can alter `postgresql.conf` between the initial hash calculation and backup copy.
- **Window B (Golden backup creation to candidate pre-swap check):** An external process can alter or lock the golden backup.
- **Window C (Candidate pre-swap check to live configuration swap):** An external process can mutate the live file before configuration replacement.
- **Window D (Rollback restore to post-rollback live verification):** An external process can alter the restored file before verification.
- **Entrypoint Revalidation Window:** A 10–50 microsecond window exists between the entrypoint's SHA-256 calculation and the emission of Exit Code `104`.
> [!NOTE]
> None of these user-mode race windows can be eliminated in software on Windows without deprecated kernel transactions (TxF). They are mitigated to fail-closed aborts.

### 6.2 NTFS Reparse Points & Directory Junction Risks
Windows supports volume mount points, directory junctions, and symbolic links. If an attacker or misconfigured script creates a junction at `D:\Zentra\database\config` or `.consumed_nonces`, operations could manipulate unintended system files. All scripts must verify:
`([System.IO.File]::GetAttributes($path) -band [System.IO.FileAttributes]::ReparsePoint) -eq 0`

### 6.3 File-Sharing Mode Reality (`FileShare.Read`)
Opening a file with `FileShare.Read` locks the file against external writes **only while the handle is open**. The moment the stream is closed, the lock is released. Path checks and hashes do **not** independently prove physical file identity (inode/MFT permanence) across handle closures.

### 6.4 Process-Tree Termination Limitations
- On Windows PowerShell 5.1 / .NET Framework 4.8, `Process.Kill()` kills only the root process.
- Native `taskkill.exe /PID $PID /T /F` terminates enumerated descendants, but:
  - Descendants created with `CREATE_BREAKAWAY_FROM_JOB` escape.
  - Grandchildren spawned during Toolhelp32 enumeration escape.
  - Recycled PIDs may result in signaling an innocent process if a race occurs after the pre-check.
  - If the root process exited before `taskkill` ran, exit code `128` is returned without terminating orphaned descendants.
  - Exit code `0` proves only that enumerated processes were signaled; it does not prove zero descendants survived.

### 6.5 Hardware Storage Durability Boundaries
On consumer workstation hardware ($0 budget), consumer SSDs buffer writes in volatile onboard DRAM without Power-Loss Protection (PLP). Even after Win32 `FlushFileBuffers` returns success, a sudden hard electrical power cut can lose data from drive controller cache.

### 6.6 System.IO.File.Exists() Behavioral Boundaries
- **Exception Suppression Flaw:** The .NET implementation of `[System.IO.File]::Exists($path)` catches and suppresses nearly all filesystem exceptions (including `SecurityException`, `UnauthorizedAccessException`, `PathTooLongException`, `NotSupportedException`, `ArgumentException`, and `IOException`), returning a simple boolean `$false`.
- **Inability to Distinguish Absence from Error:** A return value of `$false` cannot prove that a file does not exist on disk. A file will report `$false` if the process lacks NTFS read permissions (`0x80070005`), if a directory junction redirects to an inaccessible target, or if a transient storage controller fault occurs.
- **Fail-Closed Mandate:** Boolean `File.Exists() == false` checks are strictly rejected as authoritative proof of target absence. If an observation cannot corroborate absence via positive parent directory traversal and explicit `ERROR_FILE_NOT_FOUND` (2), the system must classify the state as `CONTRADICTORY_OR_INDETERMINATE` (`REC-STATE-05`) and halt fail-closed.

### 6.7 Windows Error Code Boundaries & Process Disambiguation
- **Sharing Violation (`ERROR_SHARING_VIOLATION` / `0x80070020` / Win32 32):**
  - *Observed Error:* `IOException` with HResult `0x80070020` on handle creation (`CreateFileW`).
  - *Establishes:* Target file exists on disk and has an existing open handle whose `FileShare` flags conflict with the requested access mode.
  - *Does NOT Establish:* Does NOT identify the holding process, thread, or account; does NOT prove that a competing deployment worker is active (can be Windows Defender, Search Indexer, backup agent, or another thread in the current PowerShell process); does NOT establish lock duration; does NOT establish file hash or database catalog damage.
  - *Uncertainties Remaining:* Holding PID, thread, lock duration, file hash, and catalog integrity remain unverified.
  - *Required Response:* HALT fail-closed (`REC-STATE-13`). Do NOT attempt blind overwrite. Do NOT claim competing worker without independent evidence. Triage handle holders via Step 4.
- **Byte-Range Lock Violation (`ERROR_LOCK_VIOLATION` / `0x80070021` / Win32 33):**
  - *Observed Error:* `IOException` with HResult `0x80070021` during read, write, or range-lock operations (`LockFileEx`).
  - *Establishes:* An open handle exists, but an operation on a specific byte range conflicted with an existing byte-range lock.
  - *Does NOT Establish:* Does NOT establish a whole-file sharing violation (`0x80070020`); does NOT establish that the whole file is locked; does NOT identify the locking process or thread; does NOT prove a competing deployment worker is active; does NOT establish database catalog damage.
  - *Uncertainties Remaining:* Holding process identity, locking thread, byte-range offsets, and file hash remain unverified.
  - *Required Response:* HALT fail-closed (`REC-STATE-14`). Do NOT attempt byte overwrites. Triage range locks via Step 4. If cause cannot be determined, classify as `CONTRADICTORY_OR_INDETERMINATE` (`REC-STATE-05`) and halt.
- **File Not Found (`FileNotFoundException` / `ERROR_FILE_NOT_FOUND` / Win32 2):**
  - *Observed Error:* `FileNotFoundException` returned on direct file open with parent directory read access confirmed and genuine non-reparse point attributes verified.
  - *Establishes:* Target file was absent from the verified parent directory at the moment of handle open.
  - *Does NOT Establish:* Does NOT establish permanent absence across future handle calls (user-mode TOCTOU Window C/D); does NOT establish physical file identity (inode/MFT index) or history across handle closures; does NOT establish database catalog damage or cluster failure.
  - *Uncertainties Remaining:* Concurrency state between inspection and subsequent operations remains subject to user-mode race conditions; database catalog integrity remains unasserted by configuration file absence alone.
  - *Required Response:* Mandatory human escalation (`REC-STATE-01`). If absence cannot be reliably distinguished from an error, classify as `CONTRADICTORY_OR_INDETERMINATE` (`REC-STATE-05`) and halt fail-closed. Recreating live target from golden backup is strictly a proposed, separately approved human recovery decision under Gate 6 and Section 4.2 / 4.3 if and only if all four supporting artifacts from the authoritative list (golden backup, discard artifact, baseline metadata, and consumed-nonce ledger record) are independently verified. Automatic restoration is strictly prohibited.
- **Access Denied (`ERROR_ACCESS_DENIED` / `0x80070005` / Win32 5):**
  - *Observed Error:* `UnauthorizedAccessException` with Win32 error 5.
  - *Establishes:* Caller's execution token lacks required NTFS DACL permissions (or path targets a directory, or file is marked read-only).
  - *Does NOT Establish:* File existence or absence! Denied traverse or read access cannot be used to infer whether a configuration file is present or missing on disk. Does NOT establish process identity or database catalog damage.
  - *Uncertainties Remaining:* File existence, file content, author provenance, and database catalog state remain unverified.
  - *Required Response:* HALT fail-closed (`REC-STATE-06`). Do NOT overwrite. Do NOT infer file absence. Inspect NTFS ACLs and elevation token.

---

## 7. Post-Restoration Verification Contract

Before declaring manual restoration complete, the Incident Commander must verify the following six physical conditions:

$$\begin{aligned}
1. \quad & \text{ComputedLiveHash} = \text{ExpectedBaselineHash} \quad (\text{VERIFIED\_HASH\_MATCH}) \\
2. \quad & \text{ComputedLiveHash} \neq \text{CandidateHash} \quad (\text{VERIFIED\_CONTENT\_HASH\_DIFFERENCE}) \\
3. \quad & \text{Path Integrity Contract} = \text{True (Verified leaf file, not reparse point, parent intact)} \\
4. \quad & \text{PostgreSQL Service Discovery} = \text{Confirmed active service running via Get-Service} \\
5. \quad & \text{TCP Socket Probe on 127.0.0.1:5432} = \text{Listening and accepting local TCP handshakes} \\
6. \quad & \text{Downstream Separation} = \text{Restoration complete does NOT authorize migrations/deployment}
\end{aligned}$$

> [!IMPORTANT]
> **Separation of Concerns:**  
> 1. **Content Hash Difference $\neq$ Physical Inode Identity:** A verified difference in SHA-256 hashes proves solely that the byte sequences read from the two files differ. It does NOT prove physical file identity (same NTFS MFT index or disk inode), path identity, author provenance, or the permanent absence of TOCTOU races once stream handles close.  
> 2. **Configuration Verification $\neq$ Catalog Integrity:** Verifying `postgresql.conf` hash proves only that the text configuration file matches baseline; it does **not** prove database tables, schemas, or records inside `PGDATA` are intact.  
> 3. **Restoration Verification $\neq$ Deployment Authorization:** Certifying that the cluster configuration is restored to baseline does **NOT** grant authorization to re-run deployments, perform migrations, or execute seeding.

---

## 8. Process Exit & Caller Responsibilities

The parent deployment runner and CI/CD orchestrator must enforce the following exit code contract:

```
[Parent Runner Exit Code Dispatch Contract]
  Exit Code 0:
    ├── Meaning: Promotion Verified Clean
    └── Action: Downstream database migrations permitted ONLY after independent pre-flight.
  
  Exit Code 104:
    ├── Meaning: Outcome 4 (Rollback Verified Clean, Deployment Aborted)
    └── Action: Downstream migrations STRICTLY BLOCKED; automated retries STRICTLY LOCKED OUT.
  
  Exit Code 105:
    ├── Meaning: Mandatory Parameter Binding Failure (Tooling Defect)
    └── Action: Pipeline halted RED; downstream migrations BLOCKED; pipeline bug filed.
  
  Exit Code 1:
    ├── Meaning: Manual Recovery Active (Indeterminate State / Fault Encountered)
    └── Action: Pipeline halted RED; Incident Commander paged; downstream migrations BLOCKED.
  
  Null / Timeout / Unrecognized Code:
    ├── Meaning: Runner Crash / Deadlock / Tooling Failure
    └── Action: Pipeline halted RED; process-tree cleanup initiated; downstream migrations BLOCKED.
```

---

## 9. Credential Handling & Zero-Plaintext Standard

1. **Zero-Plaintext Policy:** No passwords, connection strings, or master credentials may ever be hardcoded into PowerShell scripts, runbooks, markdown documentation, or CI/CD pipelines.
2. **Log Hygiene:** Connection strings and error messages containing credentials must be scrubbed before writing to forensic logs.
3. **Interactive Credential Elevation:** Administrative role management (e.g. `zen_admin` or `zentra_dev`) must utilize interactive console password prompts:
   `\password zentra_dev`
   Passwords must never be passed via command-line arguments (e.g. `PGPASSWORD=...`), which are visible in process monitoring utilities (Sysinternals Process Explorer, Task Manager).

---

## 10. Existing Application Compatibility

The local PostgreSQL instance hosts shared development databases:
- `hisecure_erp`
- `hitech_platform`
- `zentra_test`

### 10.1 Global Authentication Prohibitions
- **Prohibition on `pg_hba.conf` Mass Changes:** Operators must **never** modify global authentication lines in `pg_hba.conf` to `reject` or change default `trust`/`scram-sha-256` methods without verified, isolated impact analysis on the running instances of HiSecure ERP and HiTech Platform.
- **Port Alterations:** Port `5432` must remain unchanged.
- **Superuser Access:** The `postgres` superuser role must remain functional for existing platform maintenance.

---

## 11. Recovery Record & MUSE SPARK Incident Report Template

Following any manual restoration event, the Incident Commander must record a formal forensic recovery report in `docs/`:

```markdown
# MUSE SPARK RECOVERY RECORD — [INCIDENT ID]
- **Date/Time (UTC):** [ISO 8601 Timestamp]
- **Incident Commander:** [Operator Name / Handle]
- **Triggering Failure:** [e.g. Swap Lock Timeout / Disk Full / Mismatch]
- **Initial Exit Code:** [1 / 105 / Timeout]
- **Expected Baseline Hash:** [SHA-256 Digest]
- **Pre-Restoration Live Hash:** [SHA-256 Digest / CONFIRMED_MISSING]
- **Golden Backup Path:** [Path to golden backup file]
- **Golden Backup Hash:** [SHA-256 Digest]
- **Post-Restoration Live Hash:** [SHA-256 Digest]
- **Discard Artifact Path:** [Path to candidate discard file]
- **Discard Artifact Hash:** [SHA-256 Digest / CONFIRMED_MISSING]
- **Process-Tree Cleanup Status:** [CONFIRMED_TREE_TERMINATED / PROCESS_CLEANUP_UNCERTAIN]
- **Catalog Verification:** [Separate catalog assertion required]
- **Root Cause Category:** [Hardware / Concurrency / Tooling / Script Bug]
- **Remediation Sign-Off:** [Human Signature]
```

---

## 12. Rollback Limitations & Human Escalation Triggers

Automated rollback conclusions are **strictly prohibited**, and immediate human escalation is **mandatory**, under any of the following conditions:

1. **Corrupted Golden Backup:** The golden backup file is corroborated missing, empty, or its hash does not match `ExpectedBaselineHash`. (Physical Fault vs Backup Defect Invariant: If an Access Denied `0x80070005`, Sharing Violation `0x80070020`, Lock Violation `0x80070021`, Reparse Point, Missing Parent Directory, Invalid Path, Generic I/O, or Indeterminate Probe occurs during golden backup inspection, this is NOT an ordinary backup corruption or absence; it is a **Tier 1 physical filesystem fault** that activates Triggers 3, 4, or 7, routing strictly to Tier 1 states `REC-STATE-06`, `13`, `14`, `07`, `08`, `09`, `12`, or `05`. Do NOT infer backup absence from a failed probe; do NOT route physical faults to `REC-STATE-05` as missing backup).
2. **Missing Live File:** The live `postgresql.conf` file is corroborated absent from disk following a swap attempt. Relying on `[System.IO.File]::Exists($path) -eq $false` alone is strictly rejected as proof of absence. Mandatory human escalation. If absence cannot be reliably distinguished from an error, the incident must be classified as INDETERMINATE (`REC-STATE-05`) and halt fail-closed. If and only if absence is corroborated and all four supporting artifacts from the authoritative list (golden backup, discard artifact, baseline metadata `ExpectedBaselineHash`, and consumed-nonce ledger record) are independently verified on disk, the Human Incident Commander must evaluate proposed manual restoration under `REC-STATE-01` and Section 4.2 / 4.3. If target is corroborated absent but ANY supporting evidence is missing, unreadable, or contradictory (including missing discard artifact or invalid nonce record), it must halt fail-closed as `REC-STATE-05` (Critical Forensic Halt); recreation from backup is strictly prohibited; lock retries and migrations.
3. **Persistent File Lock / Violation:** The live configuration file remains subject to a sharing violation (`0x80070020`) or byte-range lock violation (`0x80070021`) that cannot be safely identified or resolved within $30\text{ seconds}$. Do not claim or infer a competing deployment worker is responsible without independent corroborating process evidence.
4. **Reparse Point Infiltration:** `D:\Zentra\database\config` or any configuration artifact is identified as an NTFS junction or symbolic link.
5. **Database Service Failure:** The PostgreSQL Windows service fails to start or crashes immediately upon reload.
6. **Nonce Ledger Inconsistency:** The consumed-nonce ledger record (`.consumed_nonces\<Nonce>`) is corroborated missing, unreadable, malformed (schema defect, invalid JSON), unbound (operationId, targetConfigFile, or hash mismatch), stale (active in-flight triage outside $\pm 300\text{s}$ window, where 900s lifecycle duration does NOT extend or override 300s active triage; or terminal assertion outside $\pm 300\text{s}$ or exceeding 900s lifecycle limit), missing/corrupt `history` array, reports an invalid or contradictory lifecycle status (such as `DISCARDED` or `ROLLED_BACK` while candidate is active, target is absent, or live diverges), or encounters an illegal status transition, sequence non-monotonicity, or creation collision. Halts all restoration and execution fail-closed (`REC-STATE-05`). (Physical Fault vs Nonce Inconsistency Invariant: If an Access Denied `0x80070005`, Sharing Violation `0x80070020`, Lock Violation `0x80070021`, Reparse Point, Missing Parent Directory `.consumed_nonces\`, Invalid Path, Generic I/O, or Indeterminate Probe occurs during ledger inspection, this is NOT an ordinary logical defect or absence; it is a **Tier 1 physical filesystem fault** that activates Triggers 3, 4, or 7, routing strictly to Tier 1 states `REC-STATE-06`, `13`, `14`, `07`, `08`, `09`, `12`, or `05`. Do NOT infer nonce absence from a failed probe; do NOT route physical faults to `REC-STATE-05` as missing record). (Multi-Tier Failure Precedence: Tier 2 Nonce Ledger Inconsistency takes strict precedence over Trigger 8 Missing Discard Artifact; any coexisting defect halts strictly to `REC-STATE-05`).
7. **Indeterminate File State:** Any condition where the filesystem state cannot be mapped deterministically to a verified hash match or corroborated absence. Halts all restoration and execution fail-closed (`REC-STATE-05`). Does not by itself establish database catalog damage; catalog integrity remains unverified; requires forensic investigation and separate human recovery decisions.
8. **Missing or Corrupt Discard Artifact:** Any rollback or manual recovery situation where the required discard artifact is corroborated missing from disk (explicit `FileNotFoundException` with verified genuine non-reparse parent directory read access), evaluated strictly under Tier 3 when Tier 1 physical filesystem checks pass and Tier 2 nonce ledger and golden backup are verified. If live configuration matches baseline, routes to `REC-STATE-03`; if live matches candidate or divergent, routes to `REC-STATE-04`; if target is absent, routes to `REC-STATE-05`. If the discard artifact is readable on disk but exhibits corrupt payload hash (`hash != CandidateHash`) or baseline inversion (`hash == ExpectedBaselineHash`), it halts strictly to `REC-STATE-05`. (Physical Fault vs Missing Discard Invariant: If an Access Denied `0x80070005`, Sharing Violation `0x80070020`, Lock Violation `0x80070021`, Reparse Point, Missing Parent Directory `discarded\`, Invalid Path, Generic I/O, or Indeterminate Probe occurs during discard inspection, this is NOT a missing-discard condition; it is a **Tier 1 physical filesystem fault** that activates Triggers 3, 4, or 7, routing strictly to Tier 1 states `REC-STATE-06`, `13`, `14`, `07`, `08`, `09`, `12`, or `05`. Do NOT infer discard absence from a failed probe; do NOT route physical faults to `REC-STATE-03` or `REC-STATE-04`). (Tier 2 Precedence Mandate: If any Tier 2 nonce ledger or backup defect from Trigger 6 coexists with a corroborated missing discard artifact, Trigger 6 takes absolute precedence and execution halts strictly to `REC-STATE-05`; missing discard NEVER masks a Tier 2 defect). Automatic file overwrite or target recreation is strictly prohibited; halts fail-closed immediately; locks retries and migrations.
9. **Missing Mandatory Supporting Evidence:** Any required artifact from the authoritative four-item supporting-evidence list (golden backup, discard artifact, baseline metadata `ExpectedBaselineHash`, or consumed-nonce ledger record) is missing, unreadable, corrupt, contradictory, or unverifiable. Halts restoration and downstream execution immediately; locks retries and migrations; automatic file overwrite is strictly prohibited.
10. **Unpromoted Candidate Configuration Active (`REC-STATE-15`):** The live configuration matches the candidate hash following an aborted, interrupted, or failed deployment swap. Matching the candidate does **not** authorize promotion or runtime execution; requires mandatory human escalation and proposed restoration under Gate 6 and Section 4.3.
11. **Unfinalized In-Flight Transaction Ticket Active on Baseline Live Configuration (`REC-STATE-16`):** The live configuration matches the baseline hash and discard artifact is verified on disk, but the consumed-nonce ledger record remains in unfinalized `CONSUMED` status (sequence 1). The worker was aborted or interrupted pre-swap before advancing lifecycle status to `DISCARDED`. Silent promotion to clean baseline or bypass to Gate 6 sign-off is strictly prohibited; halts fail-closed immediately; preserves live baseline; locks retries and migrations until Human Incident Commander forensic review retires or reconciles the ticket under explicit authorization.

---

## 13. Test Specifications & Verification Matrix

### 13.1 Governance & Execution Status
- All test specifications defined in this section are **proposed architectural verification specifications** authored to establish deterministic, fail-closed assertions for automated harnesses and human operators.
- **Current Execution Status:** Strictly **`[NOT EXECUTED — UNTESTED]`**.
- **Execution Mandate:** Operational execution of any test specification on this host is **STRICTLY PROHIBITED** during this documentation step. No PowerShell test harness, script, fault injector, or database query has been executed.

### 13.2 Suite Accounting & Arithmetic Reconciliation
The MUSE SPARK verification framework comprises three distinct suites totaling exactly 416 test specifications:

$$\begin{array}{|l|l|c|c|}
\hline
\textbf{Suite Identifier} & \textbf{Suite Name} & \textbf{Test Count} & \textbf{Status} \\
\hline
\text{Suite 1} & \text{Pre-Flight Baseline Suite (DSP-PF-01 through DSP-PF-34)} & 34 & \text{[NOT EXECUTED — UNTESTED]} \\
\hline
\text{Suite 2} & \text{Deployment, Rollback \& Dispatcher Suite (DSP-01 through DSP-286)} & 286 & \text{[NOT EXECUTED — UNTESTED]} \\
\hline
\text{Suite 3} & \text{Manual Restoration \& Nonce Ledger Suite (REC-01 through REC-96)} & 96 & \text{[NOT EXECUTED — UNTESTED]} \\
\hline
\textbf{Total} & \textbf{Arithmetic Grand Total across all suites} & \mathbf{416} & \mathbf{[NOT\ EXECUTED\ —\ UNTESTED]} \\
\hline
\end{array}$$

$$\text{Reconciliation Check:} \quad 34\ (\text{Pre-Flight}) + 286\ (\text{Deployment}) + 7\ (\text{Prior Recovery}) + 25\ (\text{Step AP-AA New}) + 13\ (\text{Step AP-AB New}) + 12\ (\text{Step AP-AC New}) + 9\ (\text{Step AP-AE New}) + 10\ (\text{Step AP-AF New}) + 10\ (\text{Step AP-AG New}) + 10\ (\text{Step AP-AH New}) = 416\ \text{Specifications}$$

### 13.3 Prior Manual Restoration Specifications (`REC-01` through `REC-07`)

1. **`REC-01`: Confirmed Missing Live File with All 4 Supporting Artifacts Verified (`REC-STATE-01`)**
   - *Preconditions:* Automated swap was aborted or crashed; `postgresql.conf` is absent from disk.
   - *Input / Evidence:* `FileNotFoundException` (Win32 error 2) corroborated on live file open; parent directory confirmed existing non-reparse point; golden backup verified (hash == baseline); discard artifact verified (hash == candidate); baseline metadata valid; consumed-nonce record verified (valid 9-field schema, monotonic history sequence 1, status strictly `CONSUMED`; status `ROLLED_BACK` or `DISCARDED` rejected as contradictory status anomaly `REC-STATE-05`, valid binding and freshness).
   - *Expected State:* `REC-STATE-01` (`CONFIRMED_MISSING_FILE`).
   - *Mandatory Fail-Closed Action:* Mandatory human escalation under Section 12 Trigger #2. Live recreation from golden backup is strictly a proposed, separately approved human recovery decision under Gate 6 & Section 4.3; automated overwrite strictly forbidden; runner halts with Exit Code 1.

2. **`REC-02`: Live Configuration Divergence with All 4 Supporting Artifacts Verified (`REC-STATE-02`)**
   - *Preconditions:* Automated swap aborted; live file exists on disk with unexpected content.
   - *Input / Evidence:* Live file SHA-256 differs from both `ExpectedBaselineHash` and `CandidateHash`; golden backup verified; discard artifact verified; baseline metadata valid; consumed-nonce record verified with valid 9-field schema, monotonic history sequence 1, valid binding, freshness, and status strictly `CONSUMED` (status `ROLLED_BACK` or `DISCARDED` rejected as contradictory status anomaly `REC-STATE-05`).
   - *Expected State:* `REC-STATE-02` (`VERIFIED_HASH_MISMATCH` — Divergent Configuration).
   - *Mandatory Fail-Closed Action:* Proposed human restoration decision under Gate 6 & Section 4.3. Automated overwrite or deployment progression strictly forbidden; runner halts with Exit Code 1.

3. **`REC-03`: Live Hash Matches Baseline but Required Discard Artifact is Missing (`REC-STATE-03`)**
   - *Preconditions:* Automated rollback completed file restoration to baseline, but discard artifact was deleted or failed to flush.
   - *Input / Evidence:* Live file SHA-256 equals `ExpectedBaselineHash`; golden backup verified; discard artifact file absent.
   - *Expected State:* `REC-STATE-03` (`VERIFIED_HASH_MATCH` — Incomplete Forensic Evidence).
   - *Mandatory Fail-Closed Action:* Preserve current live file without automatic overwrite; incident remains unresolved; downstream database migrations and automated retries strictly locked out; runner halts with Exit Code 1.

4. **`REC-04`: Live Configuration Matches Candidate with Missing Discard Artifact (`REC-STATE-04`)**
   - *Preconditions:* Automated swap left candidate active; discard artifact was never written or is unreadable.
   - *Input / Evidence:* Live file SHA-256 equals `CandidateHash` (or unexpected hash); golden backup verified; discard artifact file absent or corrupt.
   - *Expected State:* `REC-STATE-04` (`UNVERIFIED_CANDIDATE_OR_DIVERGENT` — Missing Discard Evidence).
   - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; preserve current live file without automatic overwrite; incident remains unresolved; downstream migrations and retries strictly locked out; runner halts with Exit Code 1.

5. **`REC-05`: Indeterminate, Contradictory, or Incoherent Supporting Evidence (`REC-STATE-05`)**
   - *Preconditions:* Filesystem state ambiguous or corrupt golden backup encountered.
   - *Input / Evidence:* Golden backup hash does not match baseline, or API reports contradictory file states.
   - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
   - *Mandatory Fail-Closed Action:* Critical forensic halt immediately; zero automatic overwrite; downstream retries and migrations strictly locked RED; runner halts with Exit Code 1.

6. **`REC-06`: NTFS Access Denied on Live File or Supporting Evidence (`REC-STATE-06`)**
   - *Preconditions:* Caller token lacks NTFS traverse or read permissions.
   - *Input / Evidence:* File open throws `UnauthorizedAccessException` (Win32 error `0x80070005`).
   - *Expected State:* `REC-STATE-06` (`ACCESS_DENIED`).
   - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; do NOT infer file absence; zero automatic overwrite; runner halts with Exit Code 1.

7. **`REC-07`: Reparse Point or Directory Junction Infiltration (`REC-STATE-07`)**
   - *Preconditions:* Unauthorized directory junction or symbolic link created in configuration path.
   - *Input / Evidence:* `FileAttributes.ReparsePoint` flag detected on directory or artifact.
   - *Expected State:* `REC-STATE-07` (`REPARSE_POINT_VIOLATION`).
   - *Mandatory Fail-Closed Action:* Security fault halt immediately; reject reparse point; audit ACLs; runner halts with Exit Code 1.

### 13.4 New Step AP-AA Nonce Consumption & Routing Test Specifications (`REC-08` through `REC-32`)

8. **`REC-08`: Unpromoted Candidate Configuration Active (`REC-STATE-15`)**
   - *Preconditions:* Deployment swap was aborted or interrupted mid-flight; parent runner halted.
   - *Input / Evidence:* Live `postgresql.conf` SHA-256 equals `CandidateHash`; golden backup SHA-256 equals `ExpectedBaselineHash`; discard artifact SHA-256 equals `CandidateHash`; baseline metadata valid; consumed-nonce ledger record verified with status strictly `CONSUMED` (valid 9-field schema, monotonic `history` sequence 1; status `ROLLED_BACK` or `DISCARDED` rejected as contradictory status anomaly `REC-STATE-05`), valid operation binding, and timestamp within $\pm 300\text{s}$.
   - *Expected State:* `REC-STATE-15` (`VERIFIED_CANDIDATE_ACTIVE`).
   - *Mandatory Fail-Closed Action:* Live matching candidate must NEVER be inferred as certified promotion. Safe restoration of baseline is a proposed, separately approved human recovery decision under Gate 6 & Section 4.3. Automated overwrite or deployment progression is strictly prohibited; runner halts with Exit Code 1.

9. **`REC-09`: Unpromoted Candidate Active with Missing Discard Artifact (`REC-STATE-04`)**
   - *Preconditions:* Deployment swap interrupted leaving candidate active; discard artifact was deleted or never written.
   - *Input / Evidence:* Live `postgresql.conf` SHA-256 equals `CandidateHash`; golden backup verified; discard artifact file absent.
   - *Expected State:* `REC-STATE-04` (`UNVERIFIED_CANDIDATE_OR_DIVERGENT`).
   - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; preserve current live file without automatic overwrite; incident remains unresolved; downstream migrations strictly locked out; runner halts with Exit Code 1.

10. **`REC-10`: Consumed-Nonce Record with Status `CONSUMED` during Active Swap Triage**
    - *Preconditions:* Swap crashed mid-operation; nonce record exists on disk.
    - *Input / Evidence:* Nonce JSON contains `"status": "CONSUMED"`, timestamp fresh within $\pm 300\text{s}$, hashes match candidate and baseline.
    - *Expected State:* Valid nonce consumption state for in-flight swap failure evaluation (`REC-STATE-01`, `REC-STATE-02`, or `REC-STATE-15`), requiring `history` array with single sequence 1 entry (`CONSUMED`).
    - *Mandatory Fail-Closed Action:* Permits evaluation of proposed human recovery IF all other supporting artifacts verified; does not authorize automatic overwrite; runner halts with Exit Code 1.

11. **`REC-11`: Consumed-Nonce Record with Status `ROLLED_BACK` Post-Rollback Assertion**
    - *Preconditions:* Automated rollback completed and recorded `ROLLED_BACK`.
    - *Input / Evidence:* Nonce JSON contains `"status": "ROLLED_BACK"`, timestamp fresh, hashes match.
    - *Expected State:* Valid status ONLY IF live physical file SHA-256 equals `ExpectedBaselineHash` on disk, requiring `history` array with sequence 1 (`CONSUMED`) and sequence 2 (`ROLLED_BACK`). If live file is candidate, divergent, or absent, triggers `REC-STATE-05` (contradictory status anomaly).
    - *Mandatory Fail-Closed Action:* Rule of Non-Inference: `"status": "ROLLED_BACK"` ALONE does not prove baseline restoration! If live file is missing or diverges, triggers `REC-STATE-05` (contradictory status anomaly); runner halts with Exit Code 1.

12. **`REC-12`: Consumed-Nonce Record with Status `DISCARDED` Post-Discard Assertion**
    - *Preconditions:* Candidate configuration staging aborted and archived to `discarded\`.
    - *Input / Evidence:* Nonce JSON contains `"status": "DISCARDED"`, timestamp fresh, hashes match.
    - *Expected State:* Valid status for discard evaluation, requiring `history` array with sequence 1 (`CONSUMED`) and sequence 2 (`DISCARDED`). Valid ONLY IF live physical file equals `ExpectedBaselineHash` on disk (`REC-STATE-03` or Gate 6). If live file is candidate, divergent, or absent, triggers `REC-STATE-05` (contradictory status anomaly).
    - *Mandatory Fail-Closed Action:* Rule of Non-Inference: `"status": "DISCARDED"` ALONE does not prove candidate was safely archived on disk. Discard artifact file must be independently verified; runner halts with Exit Code 1.

13. **`REC-13`: Consumed-Nonce Record with Invalid / Unrecognized Status Value**
    - *Preconditions:* Nonce record exists with malformed status string.
    - *Input / Evidence:* Nonce JSON contains `"status": "PENDING"`, `"INITIAL"`, `"UNKNOWN"`, or lower-case `"consumed"`.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject unapproved status enum; lock pipeline; zero automatic restoration; runner halts with Exit Code 1.

14. **`REC-14`: Consumed-Nonce Record with Illegal Status Transition**
    - *Preconditions:* Attempted invalid backward or cross transition in ledger record.
    - *Input / Evidence:* Nonce record previously recorded as `ROLLED_BACK` or `DISCARDED` has been updated or observed as `CONSUMED` or reversed.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject illegal transition; lock pipeline; runner halts with Exit Code 1.

15. **`REC-15`: Consumed-Nonce Record with Mismatched `operationId`**
    - *Preconditions:* Nonce record exists with valid schema, fresh timestamp, and matching hashes, but from another operation.
    - *Input / Evidence:* Nonce JSON `"operationId"` does not match the active incident ticket UUID.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject unbound nonce record; lock pipeline; zero automatic restoration; runner halts with Exit Code 1.

16. **`REC-16`: Consumed-Nonce Record with Mismatched `targetConfigFile`**
    - *Preconditions:* Nonce record exists for `pg_hba.conf` while currently triaging `postgresql.conf` (or vice versa).
    - *Input / Evidence:* Nonce JSON `"targetConfigFile": "pg_hba.conf"`, but active target is `postgresql.conf`.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject cross-target nonce reuse; lock pipeline; runner halts with Exit Code 1.

17. **`REC-17`: Consumed-Nonce Record with Candidate Hash Mismatch**
    - *Preconditions:* Nonce record exists, but candidate hash does not match current candidate.
    - *Input / Evidence:* Nonce JSON `"candidateHash"` differs from active candidate SHA-256 digest.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject unbound candidate hash; lock pipeline; runner halts with Exit Code 1.

18. **`REC-18`: Consumed-Nonce Record with Baseline Hash Mismatch**
    - *Preconditions:* Nonce record exists, but baseline hash does not match `ExpectedBaselineHash`.
    - *Input / Evidence:* Nonce JSON `"expectedBaselineHash"` differs from pre-flight baseline SHA-256 digest.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject unbound baseline hash; lock pipeline; runner halts with Exit Code 1.

19. **`REC-19`: Consumed-Nonce Record with Expired / Stale Timestamp**
    - *Preconditions:* Nonce record left over from an earlier execution.
    - *Input / Evidence:* Nonce JSON `"timestamp"` is $> 300\text{ seconds}$ ($5\text{ minutes}$) older than observation timestamp.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject stale nonce record; lock pipeline; runner halts with Exit Code 1.

20. **`REC-20`: Consumed-Nonce Record with Future-Skewed Timestamp**
    - *Preconditions:* Nonce record generated on host with skewed clock or synthetic tampering.
    - *Input / Evidence:* Nonce JSON `"timestamp"` is $> 300\text{ seconds}$ in the future relative to local host clock.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject future-skewed timestamp; lock pipeline; runner halts with Exit Code 1.

21. **`REC-21`: Duplicate / Replayed Nonce Creation Collision**
    - *Preconditions:* A nonce file with identical name `<Nonce>` already exists in `.consumed_nonces\`.
    - *Input / Evidence:* `[System.IO.FileMode]::CreateNew` throws `IOException` (`ERROR_FILE_EXISTS`).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject duplicate/replayed nonce collision; lock pipeline; runner halts with Exit Code 1.

22. **`REC-22`: Contradictory Nonce Ledger Record Filename vs Payload**
    - *Preconditions:* File exists at `.consumed_nonces\<NonceA>`, but contains different nonce string inside JSON.
    - *Input / Evidence:* Filename is `<NonceA>`, but `"nonce": "<NonceB>"`.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject inconsistent nonce identity; lock pipeline; runner halts with Exit Code 1.

23. **`REC-23`: Missing Consumed-Nonce Ledger Record File**
    - *Preconditions:* Triage initiated, but no nonce record exists in `.consumed_nonces\`.
    - *Input / Evidence:* `[System.IO.File]::OpenRead` throws `FileNotFoundException` (Win32 2).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; Category 1 missing evidence lockout; zero automatic overwrite; runner halts with Exit Code 1.

24. **`REC-24`: Zero-Byte / Truncated Consumed-Nonce Ledger File**
    - *Preconditions:* Nonce file was created but worker crashed before write completed.
    - *Input / Evidence:* Nonce file exists on disk, but `Length == 0` or byte count is truncated.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject zero-byte/truncated record; lock pipeline; runner halts with Exit Code 1.

25. **`REC-25`: Malformed / Non-JSON Nonce Ledger File**
    - *Preconditions:* Nonce file contains non-JSON text, corrupted binary data, or non-UTF-8 encoding.
    - *Input / Evidence:* JSON parser throws syntax error; missing mandatory fields.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject malformed record; lock pipeline; runner halts with Exit Code 1.

26. **`REC-26`: Inaccessible Nonce Ledger File (`0x80070005`)**
    - *Preconditions:* Caller execution token lacks read permission to `.consumed_nonces\<Nonce>`.
    - *Input / Evidence:* `[System.IO.File]::OpenRead` throws `UnauthorizedAccessException` (Win32 error 5).
    - *Expected State:* `REC-STATE-06` (`ACCESS_DENIED`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; do NOT infer file absence; zero automatic overwrite; runner halts with Exit Code 1.

27. **`REC-27`: Simulated Local Ledger Rollback Limitation (Snapshot / Rewind Boundary)**
    - *Preconditions:* Simulated external volume rollback / VM snapshot revert where `.consumed_nonces\` directory is rewound.
    - *Input / Evidence:* Nonce record corresponding to current execution ticket is missing from disk due to volume rewind.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Assert that local verification detects missing record and halts fail-closed; proves local ledger cannot eliminate snapshot rewind risk but fails safely; runner halts with Exit Code 1.

28. **`REC-28`: Live Hash Verification Failure due to File Handle Conflict (`0x80070020`)**
    - *Preconditions:* External process holds exclusive lock on `postgresql.conf` during triage.
    - *Input / Evidence:* Handle open throws `IOException` with HResult `0x80070020`.
    - *Expected State:* `REC-STATE-13` (`SHARING_VIOLATION`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; do NOT attempt blind overwrite; triage handle holders via Step 4; runner halts with Exit Code 1.

29. **`REC-29`: Live Hash Verification Helper Exception (`REC-STATE-11`)**
    - *Preconditions:* SHA-256 helper throws unexpected runtime exception or memory fault.
    - *Input / Evidence:* Hash helper failure; no digest produced.
    - *Expected State:* `REC-STATE-11` (`HASH_HELPER_FAILURE`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; do NOT overwrite live file with unknown state; runner halts with Exit Code 1.

30. **`REC-30`: Live Hash Comparison Yields Contradictory / Incoherent Observation (`REC-STATE-05`)**
    - *Preconditions:* Filesystem returns contradictory state (e.g. `File.Exists() == false` while handle open throws sharing violation).
    - *Input / Evidence:* Mutually contradictory observations.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Critical forensic halt fail-closed; zero automatic restoration; runner halts with Exit Code 1.

31. **`REC-31`: Golden Backup Corrupted or Mismatched during Triage (`REC-STATE-05`)**
    - *Preconditions:* Golden backup file modified or truncated following initial creation.
    - *Input / Evidence:* Golden backup SHA-256 does not equal `ExpectedBaselineHash`.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; strictly forbid live file overwrite or recreation; lock pipeline; runner halts with Exit Code 1.

32. **`REC-32`: Pipeline Lockout & Zero-Continuation Enforcement**
    - *Preconditions:* Any failure condition in tests `REC-01` through `REC-31` is triggered.
    - *Input / Evidence:* Non-zero exit code (`1` or `105`) emitted by child runner.
    - *Expected State:* Automated retry lockout active; downstream database migrations blocked.
    - *Mandatory Fail-Closed Action:* Orchestrator strictly halts red; zero automated retries permitted; downstream migrations blocked until Human Incident Commander sign-off at Gate 6.

### 13.5 Step AP-AB Nonce Status Transition History & State Compatibility Specifications (`REC-33` through `REC-45`)

33. **`REC-33`: Nonce Ledger Record with Status `ROLLED_BACK` while Live Matches Candidate (`REC-STATE-05`)**
    - *Preconditions:* Triage initiated after interrupted deployment; live file matches candidate hash.
    - *Input / Evidence:* Live `postgresql.conf` SHA-256 equals `CandidateHash`; ledger JSON contains `"status": "ROLLED_BACK"`.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Contradictory Status Anomaly).
    - *Mandatory Fail-Closed Action:* Critical forensic halt fail-closed immediately; ledger claims baseline was restored, but unpromoted candidate remains live on disk; do NOT infer clean state; lock pipeline; runner halts with Exit Code 1.

34. **`REC-34`: Nonce Ledger Record with Status `DISCARDED` while Live Matches Candidate (`REC-STATE-05`)**
    - *Preconditions:* Triage initiated after aborted staging; live file matches candidate hash.
    - *Input / Evidence:* Live `postgresql.conf` SHA-256 equals `CandidateHash`; ledger JSON contains `"status": "DISCARDED"`.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Contradictory Status Anomaly).
    - *Mandatory Fail-Closed Action:* Critical forensic halt fail-closed immediately; ledger claims candidate staging was discarded, but candidate remains live on disk; uncertified state; do NOT infer clean discard; lock pipeline; runner halts with Exit Code 1.

35. **`REC-35`: Nonce Ledger Record with Status `ROLLED_BACK` while Target File is Absent (`REC-STATE-05`)**
    - *Preconditions:* Live `postgresql.conf` corroborated absent via Win32 `ERROR_FILE_NOT_FOUND` (2).
    - *Input / Evidence:* Live file absent; ledger JSON contains `"status": "ROLLED_BACK"`.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Contradictory Status Anomaly).
    - *Mandatory Fail-Closed Action:* Critical forensic halt fail-closed immediately; ledger claims baseline was restored, but live target is absent on physical disk; do NOT evaluate `REC-STATE-01` recreation; lock pipeline; runner halts with Exit Code 1.

36. **`REC-36`: Nonce Ledger Record with Status `DISCARDED` while Target File is Absent (`REC-STATE-05`)**
    - *Preconditions:* Live `postgresql.conf` corroborated absent via Win32 `ERROR_FILE_NOT_FOUND` (2).
    - *Input / Evidence:* Live file absent; ledger JSON contains `"status": "DISCARDED"`.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Contradictory Status Anomaly).
    - *Mandatory Fail-Closed Action:* Critical forensic halt fail-closed immediately; ledger claims candidate staging was discarded, but live target is absent from physical disk; do NOT evaluate `REC-STATE-01` recreation; lock pipeline; runner halts with Exit Code 1.

37. **`REC-37`: Nonce Ledger Record with Status `ROLLED_BACK` while Live File Diverges (`REC-STATE-05`)**
    - *Preconditions:* Live `postgresql.conf` exists, but hash differs from both baseline and candidate.
    - *Input / Evidence:* Live file diverges from both baseline and candidate; ledger JSON contains `"status": "ROLLED_BACK"`.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Contradictory Status Anomaly).
    - *Mandatory Fail-Closed Action:* Critical forensic halt fail-closed immediately; ledger claims baseline was restored, but live file differs from baseline; do NOT evaluate `REC-STATE-02` restoration; lock pipeline; runner halts with Exit Code 1.

38. **`REC-38`: Nonce Ledger Record with Status `DISCARDED` while Live File Diverges (`REC-STATE-05`)**
    - *Preconditions:* Live `postgresql.conf` exists, but hash differs from both baseline and candidate.
    - *Input / Evidence:* Live file diverges from both baseline and candidate; ledger JSON contains `"status": "DISCARDED"`.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Contradictory Status Anomaly).
    - *Mandatory Fail-Closed Action:* Critical forensic halt fail-closed immediately; ledger claims candidate was safely discarded, but live file is in unexpected divergent state; do NOT evaluate `REC-STATE-02` restoration; lock pipeline; runner halts with Exit Code 1.

39. **`REC-39`: Nonce Ledger Record with Missing, Null, or Empty `history` Array (`REC-STATE-05`)**
    - *Preconditions:* Nonce record exists with valid top-level schema fields, but `history` property is missing, null, or empty array `[]`.
    - *Input / Evidence:* Ledger JSON parser detects missing or empty `"history"` field.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Schema Defect).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject ledger record lacking verifiable transition history; lock pipeline; runner halts with Exit Code 1.

40. **`REC-40`: Nonce Ledger Record with Invalid Initial History Event (`REC-STATE-05`)**
    - *Preconditions:* Nonce record exists where `history[0]` does not represent initial consumption.
    - *Input / Evidence:* `history[0].sequence != 1`, or `history[0].status` is `"ROLLED_BACK"` or `"DISCARDED"` instead of `"CONSUMED"`.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — History Invariant Violation).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject initial state skipping consumption; lock pipeline; runner halts with Exit Code 1.

41. **`REC-41`: Nonce Ledger Record with Non-Monotonic History Sequence or Timestamps (`REC-STATE-05`)**
    - *Preconditions:* Nonce record exists with out-of-order sequence numbers or clock regression across events.
    - *Input / Evidence:* Sequence numbers are non-contiguous (e.g. `[1, 3]`), or event 2 timestamp is earlier than event 1 timestamp ($t_2 < t_1$).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — History Monotonicity Violation).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject corrupt transition history; lock pipeline; runner halts with Exit Code 1.

42. **`REC-42`: Nonce Ledger Record with Illegal Third Transition or Sequence $> 2$ (`REC-STATE-05`)**
    - *Preconditions:* Nonce record exists with more than two history entries or an attempted transition past a terminal state.
    - *Input / Evidence:* `history` array length $> 2$, or contains sequence 3 event, or attempts transition following `ROLLED_BACK` / `DISCARDED`.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Terminal State Invariant Violation).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; terminal states are immutable; reject post-terminal mutation; lock pipeline; runner halts with Exit Code 1.

43. **`REC-43`: Nonce Ledger Record with Top-Level Status Mismatched against Latest History Event (`REC-STATE-05`)**
    - *Preconditions:* Nonce record exists where top-level `"status"` differs from `history[-1].status`.
    - *Input / Evidence:* Top-level `"status": "CONSUMED"`, but `history[1].status` is `"ROLLED_BACK"` (or vice-versa).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Internal History Divergence).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject internally contradictory ledger record; lock pipeline; runner halts with Exit Code 1.

44. **`REC-44`: Staged Sibling Temporary File Detected During Nonce Triage (`REC-STATE-05` / Quarantine)**
    - *Preconditions:* Worker crashed mid-transition; an orphaned temporary sibling file `.consumed_nonces\<Nonce>.tmp.<PID>` exists on disk.
    - *Input / Evidence:* Sibling `.tmp.<PID>` file found alongside primary `<Nonce>`.
    - *Expected State:* Interrupted Write Triage.
    - *Mandatory Fail-Closed Action:* If primary `<Nonce>` is intact and valid, primary is authoritative and stray `.tmp.<PID>` is quarantined. If primary `<Nonce>` is missing or corrupt, classify as `REC-STATE-05`; halt fail-closed immediately; zero automatic promotion of temporary sibling; runner halts with Exit Code 1.

45. **`REC-45`: Concurrent Worker Collision During Nonce Transition Update (`0x80070020` / `REC-STATE-13`)**
    - *Preconditions:* Concurrent process holds open exclusive handle on `.consumed_nonces\<Nonce>` during transition update.
    - *Input / Evidence:* Sibling file replacement throws `IOException` with Win32 HResult `0x80070020` (`ERROR_SHARING_VIOLATION`).
    - *Expected State:* `REC-STATE-13` (`SHARING_VIOLATION` on Nonce Ledger).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; do NOT attempt un-synchronized overwrite; triage handle holders; lock pipeline; runner halts with Exit Code 1.

### 13.6 Step AP-AC Routing, Replacement Semantics & Freshness Specifications (`REC-46` through `REC-57`)

46. **`REC-46`: Confirmed Absent Target with Missing or Corrupt Discard Artifact (`REC-STATE-05`)**
    - *Preconditions:* Automated swap aborted or crashed; live configuration target `postgresql.conf` is corroborated absent from disk.
    - *Input / Evidence:* `FileNotFoundException` (Win32 error 2) corroborated on live file open; parent directory verified non-reparse point; golden backup verified (`hash == ExpectedBaselineHash`); candidate discard artifact is absent from disk, 0-byte, unreadable, or corrupted; consumed-nonce ledger record verified.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Absent Target with Missing Discard Evidence). Strictly NOT `REC-STATE-04` (which requires physical live file).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; recreation of target file from golden backup is strictly prohibited; incident remains unresolved; lock retries and downstream migrations; runner halts with Exit Code 1.

47. **`REC-47`: Confirmed Absent Target with Missing, Unbound, or Malformed Nonce Record (`REC-STATE-05`)**
    - *Preconditions:* Automated swap aborted or crashed; live configuration target `postgresql.conf` is corroborated absent from disk.
    - *Input / Evidence:* Live configuration target corroborated absent; parent directory verified; golden backup verified; discard artifact verified; consumed-nonce ledger record is absent, malformed JSON, schema-invalid, unbound to active `operationId`, or corrupted.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Absent Target with Missing/Defective Nonce Evidence). Strictly NOT `REC-STATE-01`.
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; recreation from backup is strictly prohibited; preserve directory state for forensic analysis; lock retries and downstream migrations; runner halts with Exit Code 1.

48. **`REC-48`: Win32 `ReplaceFileW` Sharing Violation During Proposed Replacement (`0x80070020` / `REC-STATE-13`)**
    - *Preconditions:* Proposed manual restoration protocol initiated under Section 4.3; staging temporary copy created and verified.
    - *Input / Evidence:* Proposed invocation of Win32 `ReplaceFileW` (or `[System.IO.File]::Replace()`) fails with Win32 error `0x80070020` (`ERROR_SHARING_VIOLATION`) because an external handle is held open on live target `postgresql.conf`.
    - *Expected State:* `REC-STATE-13` (`SHARING_VIOLATION` on Configuration Target).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; preserve staging file without forced un-synchronized overwrite; triage lock holders; lock pipeline; runner halts with Exit Code 1.

49. **`REC-49`: Win32 `ReplaceFileW` Unable to Remove Replaced Target (`1175` / `REC-STATE-05`)**
    - *Preconditions:* Proposed manual restoration protocol initiated under Section 4.3; staging temporary copy prepared.
    - *Input / Evidence:* Win32 `ReplaceFileW` returns `FALSE` with `GetLastError()` 1175 (`ERROR_UNABLE_TO_REMOVE_REPLACED`, `0x80070497`) or `0x80070005` (`ERROR_ACCESS_DENIED`) due to restrictive ACLs, read-only attribute, or concurrent rename conflict on live file.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Replacement Primitive Failure).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; live target state marked indeterminate; staging file quarantined; lock retries and migrations; runner halts with Exit Code 1.

50. **`REC-50`: Process Crash or Power Loss During Staging Intermediate Window (`REC-STATE-05` / Orphan Triage)**
    - *Preconditions:* Proposed restoration protocol executing; temporary staging copy written to `postgresql.conf.restoration.tmp` before `ReplaceFileW` is invoked.
    - *Input / Evidence:* Host crashes or worker process terminates; upon reboot/recovery triage, both `postgresql.conf` and orphaned `postgresql.conf.restoration.tmp` exist on disk.
    - *Expected State:* Interrupted Staging Triage (`REC-STATE-05`).
    - *Mandatory Fail-Closed Action:* Do NOT automatically promote temporary staging file; halt fail-closed; quarantine temporary staging artifact; inspect live configuration hash against baseline; lock retries and migrations; runner halts with Exit Code 1.

51. **`REC-51`: Nonce Ledger Record with Malformed ISO 8601 Timestamp Syntax (`REC-STATE-05`)**
    - *Preconditions:* Consumed-nonce record evaluated during active triage or terminal assertion.
    - *Input / Evidence:* Top-level `timestamp` or `history[i].timestamp` contains a non-standard string (e.g. missing timezone offset `Z`, non-numeric characters, unparseable by `[System.DateTimeOffset]::Parse()`).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Malformed Timestamp Syntax).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject malformed ledger record; lock retries and migrations; runner halts with Exit Code 1.

52. **`REC-52`: Nonce Ledger Record with Future Time Skew Exceeding Tolerance ($t > T_{\text{obs}} + 5\text{s}$, `REC-STATE-05`)**
    - *Preconditions:* Consumed-nonce record read during active triage or terminal assertion.
    - *Input / Evidence:* Ledger timestamp $t$ exceeds host observation time $T_{\text{obs}}$ by more than $\epsilon_{\text{skew}} = 5\text{ seconds}$ (e.g. $t - T_{\text{obs}} = 35\text{s}$).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Excessive Future Time Skew).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject ledger record with future timestamp anomaly; lock retries and migrations; runner halts with Exit Code 1.

53. **`REC-53`: Stale In-Flight Nonce Record Beyond Freshness Window ($|T_{\text{obs}} - t_1| > 300\text{s}$, `REC-STATE-05`)**
    - *Preconditions:* Active triage performed following aborted or crashed deployment.
    - *Input / Evidence:* Top-level consumption timestamp $t_1$ is older than 300 seconds ($T_{\text{obs}} - t_1 = 301\text{s}$).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Stale Nonce Record Lockout).
    - *Mandatory Fail-Closed Action:* Rule of Non-Relaxation applies: window tolerance is strictly NOT expanded; halt fail-closed immediately; reject stale ledger record; lock retries and migrations; runner halts with Exit Code 1.

54. **`REC-54`: Nonce Record History Clock Rollback or Backward Jump ($t_2 < t_1$, `REC-STATE-05`)**
    - *Preconditions:* Consumed-nonce record with two history events evaluated during terminal rollback/discard assertion.
    - *Input / Evidence:* Event 1 timestamp $t_1$ is later than event 2 timestamp $t_2$ ($t_2 - t_1 < 0\text{s}$), indicating host clock rollback or record tampering.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Non-Monotonic History Chronology).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject chronological inversion; lock retries and migrations; runner halts with Exit Code 1.

55. **`REC-55`: Nonce Record Operation Duration Exceeding Maximum Limit ($t_2 - t_1 > 900\text{s}$, `REC-STATE-05`)**
    - *Preconditions:* Terminal assertion (Gate 5 or Gate 6) evaluates transition history.
    - *Input / Evidence:* Terminal event timestamp $t_2$ is fresh ($|T_{\text{obs}} - t_2| \le 300\text{s}$), but elapsed duration from initial consumption exceeds Maximum Operation Duration ($t_2 - t_1 = 901\text{s} > 900\text{s}$).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Operation Duration Exceeded).
    - *Mandatory Fail-Closed Action:* Halt fail-closed immediately; reject expired operation lifecycle; lock retries and migrations; runner halts with Exit Code 1.

56. **`REC-56`: Comprehensive Decision Tree, State Matrix & Compatibility Route Consistency Verification (`REC-STATE-01` through `REC-STATE-16` & Gate 6)**
    - *Preconditions:* Static architectural walkthrough and algorithmic traversal of Decision Tree Steps 1–3 against Table 4.1 State Matrix, Table 332 Compatibility Matrix, and Gate Criteria.
    - *Input / Evidence:* Systematic evaluation of all distinct physical disk conditions and supporting evidence permutations:
      1. Live hash matches baseline with status in {ROLLED_BACK, DISCARDED} and all 4 artifacts verified $\to$ Clean operational baseline verified; proceeds to Gate 6 sign-off (Section 7). (Not an incident recovery state; no undefined `REC-STATE-00`).
      1a. Live hash matches baseline with status CONSUMED and discard artifact verified $\to$ Strictly `REC-STATE-16` (`UNFINALIZED_IN_FLIGHT_TRANSACTION` — Halt fail-closed; preserve live baseline; LOCK PIPELINE; ticket unfinalized; human forensic review required).
      2. Live hash matches baseline with discard artifact missing $\to$ Strictly `REC-STATE-03` (`VERIFIED_HASH_MATCH` — Incomplete Forensic Evidence).
      3. Live hash matches candidate with all 4 artifacts verified $\to$ Strictly `REC-STATE-15` (`VERIFIED_CANDIDATE_ACTIVE` — Proposed Human Restoration under Gate 6 & Sec 4.3).
      4. Live hash matches candidate with discard artifact missing $\to$ Strictly `REC-STATE-04` (`UNVERIFIED_CANDIDATE_OR_DIVERGENT` — Missing Discard Evidence).
      5. Live hash diverges from both baseline and candidate with all 4 artifacts verified $\to$ Strictly `REC-STATE-02` (`VERIFIED_HASH_MISMATCH` — Proposed Human Restoration under Gate 6 & Sec 4.3).
      6. Live hash diverges from both baseline and candidate with discard artifact missing $\to$ Strictly `REC-STATE-04` (`UNVERIFIED_CANDIDATE_OR_DIVERGENT` — Missing Discard Evidence).
      7. Target confirmed absent with all 4 artifacts verified $\to$ Strictly `REC-STATE-01` (`CONFIRMED_MISSING_FILE` — Proposed Human Recreation under Gate 6 & Sec 4.3).
      8. Target confirmed absent with discard artifact missing or any supporting evidence defect $\to$ Strictly `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Critical Forensic Halt; target recreation strictly prohibited).
      9. File sharing violation (`0x80070020`) $\to$ Strictly `REC-STATE-13` (`SHARING_VIOLATION`).
      10. Byte-range lock violation (`0x80070021`) $\to$ Strictly `REC-STATE-14` (`LOCK_VIOLATION`).
      11. Parent directory missing (`DirectoryNotFoundException`) $\to$ Strictly `REC-STATE-08` (`CONFIRMED_MISSING_DIRECTORY`).
      12. Access denied (`0x80070005`) $\to$ Strictly `REC-STATE-06` (`ACCESS_DENIED`).
      13. Reparse point / junction infiltration $\to$ Strictly `REC-STATE-07` (`REPARSE_POINT_VIOLATION`).
      14. Invalid or malformed path $\to$ Strictly `REC-STATE-09` (`INVALID_OR_MALFORMED_PATH`).
      15. Malformed baseline hash metadata $\to$ Strictly `REC-STATE-10` (`MALFORMED_HASH_METADATA`).
      16. Hash helper calculation failure $\to$ Strictly `REC-STATE-11` (`HASH_HELPER_FAILURE`).
      17. Undetermined generic I/O failure $\to$ Strictly `REC-STATE-12` (`IO_FAILURE_CAUSE_UNDETERMINED`).
      18. Contradictory status, broken history, stale in-flight record ($> 300\text{s}$), operation duration timeout ($> 900\text{s}$), clock regression ($t_2 < t_1$), future skew ($> 5\text{s}$), malformed timestamp, or indeterminate physical evidence $\to$ Strictly `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE`).
    - *Expected State:* Deterministic, non-overlapping mapping where every supported condition resolves to exactly one consistent authoritative state (or Gate 6 baseline sign-off), verified by static textual consistency audit.
    - *Mandatory Fail-Closed Action:* Any divergent, contradictory, unmapped, or circular route terminates immediately in `REC-STATE-05`; automated execution locked; runner halts with Exit Code 1.

57. **`REC-57`: Indeterminate Filesystem Diagnostic Fallback Contract Verification (`REC-STATE-05`)**
    - *Preconditions:* Filesystem query encounters unmapped exception or ambiguous I/O condition during recovery triage.
    - *Input / Evidence:* Generic `System.IO.IOException` with unknown HResult, directory reparse point violation, or uncorroborated boolean probe.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Diagnostic Fallback).
    - *Mandatory Fail-Closed Action:* Strictly fail-closed; zero heuristic inference of absence or presence; zero catalog health inference; halt runner with Exit Code 1.

### 13.7 Step AP-AE Consumed-Status Clean-Baseline Consistency Specifications (`REC-58` through `REC-66`)

58. **`REC-58`: Live Equals Baseline with Status `CONSUMED` and Discard Verified (`REC-STATE-16`)**
    - *Preconditions:* Deployment swap was aborted or interrupted pre-swap; live `postgresql.conf` was never swapped and remains intact at baseline; candidate configuration was staged and archived to `discarded\`.
    - *Input / Evidence:* Live configuration SHA-256 equals `ExpectedBaselineHash`; golden backup SHA-256 equals `ExpectedBaselineHash`; candidate discard artifact SHA-256 equals `CandidateHash`; baseline metadata valid; consumed-nonce ledger record verified with status strictly `CONSUMED`, monotonic `history` array with single sequence 1 entry (`CONSUMED`), matching operation binding (`operationId`, `targetConfigFile`, `candidateHash`, `expectedBaselineHash`), and fresh timestamp ($|T_{\text{obs}} - t_1| \le 300\text{s}$).
    - *Expected State:* `REC-STATE-16` (`UNFINALIZED_IN_FLIGHT_TRANSACTION` — Interrupted Pre-Swap Ticket).
    - *Mandatory Fail-Closed Action:* The ticket was never finalized to a terminal lifecycle status (`DISCARDED`); rule of non-promotion strictly prohibits silently advancing `CONSUMED` to `DISCARDED` or clean baseline sign-off; do NOT overwrite live file; preserve live baseline configuration; incident remains UNRESOLVED; downstream database migrations and automated retries remain strictly locked out; runner halts with Exit Code 1 until Human Incident Commander forensic review retires or reconciles the ticket under explicit authorization.

59. **`REC-59`: Live Equals Baseline with Status `CONSUMED` and Discard Missing or Invalid (`REC-STATE-03`)**
    - *Preconditions:* Deployment swap was aborted or interrupted pre-swap; live `postgresql.conf` remains at baseline; discard artifact failed to write, is zero-byte, unreadable, or missing.
    - *Input / Evidence:* Live configuration SHA-256 equals `ExpectedBaselineHash`; golden backup verified; candidate discard artifact is absent, zero-byte, unreadable, or corrupt; consumed-nonce record verified with status `CONSUMED` (sequence 1) and 100% verified valid, bound, and fresh within $\pm 300\text{s}$ (strictly zero Tier 2 defects present).
    - *Expected State:* `REC-STATE-03` (`VERIFIED_HASH_MATCH` — Incomplete Forensic Evidence).
    - *Mandatory Fail-Closed Action:* Incomplete forensic evidence (missing required discard artifact) combined with an unfinalized in-flight ticket, evaluated strictly under Tier 3 because Tier 2 nonce ledger and golden backup are verified and fresh; preserve current live file without automatic overwrite; incident remains UNRESOLVED; downstream retries and migrations remain strictly locked out; runner halts with Exit Code 1. (Precedence Guarantee: If any Tier 2 nonce or backup defect coexists, execution halts strictly to `REC-STATE-05`).

60. **`REC-60`: Live Equals Baseline with Status `DISCARDED` and All Evidence Valid (Gate 6 Sign-Off)**
    - *Preconditions:* Candidate staging was safely aborted and cataloged; live `postgresql.conf` remained untouched at baseline; terminal transition to `DISCARDED` was recorded.
    - *Input / Evidence:* Live configuration SHA-256 equals `ExpectedBaselineHash`; golden backup verified (`hash == ExpectedBaselineHash`); candidate discard artifact verified (`hash == CandidateHash`); baseline metadata valid; consumed-nonce record verified with status `DISCARDED`, monotonic `history` array containing sequence 1 (`CONSUMED`) and sequence 2 (`DISCARDED`), matching operation binding, and terminal transition timestamp $t_2$ fresh within $|T_{\text{obs}} - t_2| \le 300\text{s}$ with total duration $0 \le t_2 - t_1 \le 900\text{s}$.
    - *Expected State:* Verified Candidate Discard $\to$ Gate 6 Sign-Off (Section 7).
    - *Mandatory Fail-Closed Action:* Clean operational baseline verified on disk; candidate safely archived; proceed to Gate 6 sign-off; cluster certified clean; does NOT authorize downstream migrations without independent pre-flight.

61. **`REC-61`: Live Equals Baseline with Status `ROLLED_BACK` and All Evidence Valid (Gate 6 Sign-Off)**
    - *Preconditions:* Automated rollback completed physical file replacement following an aborted swap; live `postgresql.conf` restored to baseline; terminal transition to `ROLLED_BACK` was recorded.
    - *Input / Evidence:* Live configuration SHA-256 equals `ExpectedBaselineHash`; golden backup verified (`hash == ExpectedBaselineHash`); candidate discard artifact verified (`hash == CandidateHash`); baseline metadata valid; consumed-nonce record verified with status `ROLLED_BACK`, monotonic `history` array containing sequence 1 (`CONSUMED`) and sequence 2 (`ROLLED_BACK`), matching operation binding, and terminal transition timestamp $t_2$ fresh within $|T_{\text{obs}} - t_2| \le 300\text{s}$ with total duration $0 \le t_2 - t_1 \le 900\text{s}$.
    - *Expected State:* Verified Rollback Baseline $\to$ Gate 6 Sign-Off (Section 7).
    - *Mandatory Fail-Closed Action:* Clean operational baseline verified restored on disk; proceed to Gate 6 sign-off; Exit Code 104 dispatch; does NOT authorize downstream migrations without independent pre-flight.

62. **`REC-62`: Live Equals Baseline with Contradictory Nonce Transition History (`REC-STATE-05`)**
    - *Preconditions:* Triage evaluates live configuration matching baseline, but ledger history array violates transition invariants.
    - *Input / Evidence:* Live configuration SHA-256 equals `ExpectedBaselineHash`; discard artifact verified; ledger JSON contains contradictory history (e.g. sequence 1 status is `DISCARDED` without prior recorded consumption, sequence numbers are non-monotonic `[1, 3]`, array length $> 2$, or top-level status contradicts `history[-1].status`).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — History Invariant Violation).
    - *Mandatory Fail-Closed Action:* Critical forensic halt fail-closed immediately; preserve live baseline configuration; reject corrupt or tampered ledger history; lock retries and migrations; runner halts with Exit Code 1.

63. **`REC-63`: Live Equals Baseline with Stale In-Flight `CONSUMED` Record ($> 300\text{s}$, `REC-STATE-05`)**
    - *Preconditions:* Interrupted swap evaluated during active triage; live file remains at baseline.
    - *Input / Evidence:* Live configuration SHA-256 equals `ExpectedBaselineHash`; discard artifact verified; ledger status is `CONSUMED` (sequence 1), but initial consumption timestamp $t_1$ is older than 300 seconds ($T_{\text{obs}} - t_1 = 301\text{s}$).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Stale Nonce Record Lockout).
    - *Mandatory Fail-Closed Action:* Rule of Non-Relaxation applies: 900s lifecycle boundary strictly does NOT extend active triage; preserve live baseline configuration; halt fail-closed immediately; lock retries and migrations; runner halts with Exit Code 1.

64. **`REC-64`: Live Equals Baseline with History Clock Rollback or Regression ($t_2 < t_1$, `REC-STATE-05`)**
    - *Preconditions:* Terminal assertion (Gate 5 / Gate 6) evaluated; live configuration matches baseline.
    - *Input / Evidence:* Live configuration SHA-256 equals `ExpectedBaselineHash`; discard artifact verified; ledger status is `ROLLED_BACK` or `DISCARDED`, but sequence 2 timestamp is earlier than sequence 1 timestamp ($t_2 < t_1$).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Non-Monotonic History Chronology).
    - *Mandatory Fail-Closed Action:* Critical forensic halt fail-closed immediately; reject chronological regression / clock rollback anomaly; preserve live baseline; lock retries and migrations; runner halts with Exit Code 1.

65. **`REC-65`: Live Equals Baseline with Operation Duration Exceeding Maximum Limit ($t_2 - t_1 > 900\text{s}$, `REC-STATE-05`)**
    - *Preconditions:* Terminal assertion evaluated; live configuration matches baseline.
    - *Input / Evidence:* Live configuration SHA-256 equals `ExpectedBaselineHash`; discard artifact verified; ledger status is `ROLLED_BACK` or `DISCARDED`, terminal timestamp $t_2$ is fresh ($|T_{\text{obs}} - t_2| \le 300\text{s}$), but elapsed operation duration exceeds maximum boundary ($t_2 - t_1 = 901\text{s} > 900\text{s}$).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Operation Duration Exceeded).
    - *Mandatory Fail-Closed Action:* Critical forensic halt fail-closed immediately; reject expired operation lifecycle; preserve live baseline; lock retries and migrations; runner halts with Exit Code 1.

66. **`REC-66`: End-to-End Decision Tree, State Matrix & Compatibility Route Consistency Across All `Live == Baseline` Paths**
    - *Preconditions:* Static architectural walkthrough and algorithmic traversal of all five `Live == Baseline` combinations across Table 2.1 (Gates 5 and 6), Decision Tree Step 3, Table 4.1 State Matrix, Section 4.2 Reconciliation Contract, Section 5 Fail-Closed Rules, and Table 332 Compatibility Matrix.
    - *Input / Evidence:* Systematic validation that every `Live == Baseline` combination maps deterministically to exactly one non-overlapping authoritative outcome:
      1. Status `CONSUMED` + discard verified $\to$ Strictly `REC-STATE-16` (Halt fail-closed; preserve live baseline; LOCK PIPELINE).
      2. Status `CONSUMED` + discard missing/invalid $\to$ Strictly `REC-STATE-03` (Halt fail-closed; preserve live baseline; LOCK PIPELINE).
      3. Status `DISCARDED` + all required evidence valid $\to$ Strictly Gate 6 clean baseline sign-off (Section 7).
      4. Status `ROLLED_BACK` + all required evidence valid $\to$ Strictly Gate 6 clean baseline sign-off (Section 7).
      5. Contradictory history, broken schema, stale ($> 300\text{s}$), duration timeout ($> 900\text{s}$), or clock regression ($t_2 < t_1$) $\to$ Strictly `REC-STATE-05` (Critical Forensic Halt; preserve live baseline; LOCK PIPELINE).
    - *Expected State:* Fully deterministic, closed-loop mapping where no branch silently promotes `CONSUMED` to a terminal status, no branch infers completion merely from live hash or discard presence, the live file is preserved in all five cases, and retries/migrations remain strictly locked until separately authorized human review.
    - *Mandatory Fail-Closed Action:* Any routing ambiguity, silent promotion, or non-fail-closed route terminates immediately in `REC-STATE-05`; automated execution locked; runner halts with Exit Code 1.

### 13.8 Step AP-AF Fail-Closed Precedence & Mixed-Defect Specifications (`REC-67` through `REC-76`)

67. **`REC-67`: Live Equals Baseline with Missing Discard Artifact and Stale Nonce Record ($> 300\text{s}$, `REC-STATE-05`)**
    - *Preconditions:* Active triage evaluates live baseline configuration where both the discard artifact is missing and the in-flight nonce record is stale.
    - *Input / Evidence:* Live configuration SHA-256 equals `ExpectedBaselineHash`; golden backup verified; candidate discard artifact is absent/unreadable; consumed-nonce record exists with status `CONSUMED` (sequence 1), but initial consumption timestamp $t_1$ is older than 300 seconds ($T_{\text{obs}} - t_1 = 301\text{s}$).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Stale Nonce Record Lockout).
    - *Mandatory Fail-Closed Action:* Authoritative Multi-Tier Precedence Hierarchy strictly enforces Tier 2 precedence over Tier 3 missing discard (`REC-STATE-03`); missing discard evidence must NEVER mask a stale nonce defect; halt fail-closed immediately; preserve live baseline configuration; lock downstream retries and migrations; runner halts with Exit Code 1.

68. **`REC-68`: Live Equals Baseline with Missing Discard Artifact and Contradictory Nonce History (`REC-STATE-05`)**
    - *Preconditions:* Triage evaluates live baseline configuration with missing discard artifact and corrupted or illegal nonce transition history.
    - *Input / Evidence:* Live configuration SHA-256 equals `ExpectedBaselineHash`; golden backup verified; candidate discard artifact is absent; consumed-nonce record contains non-monotonic history (e.g. sequence 1 status is `DISCARDED`, sequence numbers `[1, 3]`, or length $> 2$).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — History Invariant Violation).
    - *Mandatory Fail-Closed Action:* Tier 2 history invariant defect takes absolute precedence over Tier 3 missing discard (`REC-STATE-03`); missing discard must NEVER mask history corruption; critical forensic halt fail-closed immediately; preserve live baseline; lock retries and migrations; runner halts with Exit Code 1.

69. **`REC-69`: Live Equals Baseline with Missing Discard Artifact and Unbound Nonce Record (`REC-STATE-05`)**
    - *Preconditions:* Triage evaluates live baseline configuration with missing discard artifact and unbound nonce ticket.
    - *Input / Evidence:* Live configuration SHA-256 equals `ExpectedBaselineHash`; golden backup verified; candidate discard artifact is absent; consumed-nonce record JSON contains mismatched `operationId` (different UUID) or mismatched `targetConfigFile` (`pg_hba.conf` while inspecting `postgresql.conf`).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Unbound Nonce Record).
    - *Mandatory Fail-Closed Action:* Tier 2 unbound record defect takes absolute precedence over Tier 3 missing discard (`REC-STATE-03`); halt fail-closed immediately; preserve live baseline; lock retries and migrations; runner halts with Exit Code 1.

70. **`REC-70`: Live Equals Candidate with Missing Discard Artifact and Stale Nonce Record ($> 300\text{s}$, `REC-STATE-05`)**
    - *Preconditions:* Aborted swap left candidate active on disk; discard artifact is missing and nonce record is stale.
    - *Input / Evidence:* Live configuration SHA-256 equals `CandidateHash`; golden backup verified; candidate discard artifact is absent; consumed-nonce record has status `CONSUMED` (sequence 1), but initial timestamp $t_1$ is older than 300 seconds ($T_{\text{obs}} - t_1 = 301\text{s}$).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Stale Nonce Record Lockout).
    - *Mandatory Fail-Closed Action:* Tier 2 stale nonce defect takes absolute precedence over Tier 3 missing discard on candidate (`REC-STATE-04`); missing discard must NEVER mask a stale nonce record; halt fail-closed immediately; preserve live candidate file; lock retries and migrations; runner halts with Exit Code 1.

71. **`REC-71`: Live Equals Candidate with Missing Discard Artifact and Contradictory Nonce Status (`REC-STATE-05`)**
    - *Preconditions:* Aborted swap left candidate active on disk; discard artifact is missing and nonce record claims `DISCARDED` or `ROLLED_BACK`.
    - *Input / Evidence:* Live configuration SHA-256 equals `CandidateHash`; golden backup verified; candidate discard artifact is absent; consumed-nonce record top-level status reports `"DISCARDED"` or `"ROLLED_BACK"`.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Contradictory Status Anomaly).
    - *Mandatory Fail-Closed Action:* Tier 2 contradictory status anomaly takes absolute precedence over Tier 3 missing discard (`REC-STATE-04`); claims of discard or rollback while candidate remains active on physical disk represent an impossible contradictory state; halt fail-closed immediately; preserve live candidate file; lock retries and migrations; runner halts with Exit Code 1.

72. **`REC-72`: Live Divergent Configuration with Missing Discard Artifact and Malformed Nonce JSON (`REC-STATE-05`)**
    - *Preconditions:* Partial swap left divergent configuration on disk; discard artifact is missing and nonce ledger is unparseable or zero-byte.
    - *Input / Evidence:* Live configuration SHA-256 diverges from both baseline and candidate; golden backup verified; candidate discard artifact is absent; consumed-nonce record is 0-byte, truncated, or contains invalid JSON syntax.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Malformed Nonce Ledger Record).
    - *Mandatory Fail-Closed Action:* Tier 2 malformed ledger defect takes absolute precedence over Tier 3 missing discard on divergent configuration (`REC-STATE-04`); halt fail-closed immediately; preserve live divergent file; lock retries and migrations; runner halts with Exit Code 1.

73. **`REC-73`: Target Confirmed Absent with Missing Discard Artifact and Stale or Contradictory Nonce (`REC-STATE-05`)**
    - *Preconditions:* Target configuration file confirmed absent; both discard artifact and nonce ledger exhibit defects.
    - *Input / Evidence:* Live `postgresql.conf` corroborated absent (`FileNotFoundException`); golden backup verified; candidate discard artifact is absent; consumed-nonce record is stale ($> 300\text{s}$), unbound, or claims `ROLLED_BACK` / `DISCARDED`.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Target Absent Incomplete Forensic Evidence).
    - *Mandatory Fail-Closed Action:* Critical forensic halt fail-closed immediately; recreation of target file from golden backup is strictly and absolutely FORBIDDEN; lock retries and migrations; runner halts with Exit Code 1.

74. **`REC-74`: Live Equals Baseline with Missing Discard Artifact and Golden Backup Hash Mismatch (`REC-STATE-05`)**
    - *Preconditions:* Triage evaluates live baseline configuration where both the discard artifact is missing and the golden backup file fails hash verification.
    - *Input / Evidence:* Live configuration SHA-256 equals `ExpectedBaselineHash`; golden backup exists on disk but computed SHA-256 differs from `ExpectedBaselineHash`; candidate discard artifact is absent; consumed-nonce record exists with status `CONSUMED` (sequence 1, fresh).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Corrupt Golden Backup Defect).
    - *Mandatory Fail-Closed Action:* Tier 2 golden backup integrity failure takes absolute precedence over Tier 3 missing discard (`REC-STATE-03`); corrupt golden backup halts fail-closed immediately; preserve live baseline; lock retries and migrations; runner halts with Exit Code 1.

75. **`REC-75`: Multi-Tier Precedence Hierarchy Traversal Across All Defect Permutations (Tier 1 $\to$ Tier 2 $\to$ Tier 3 $\to$ Tier 4 Order Enforced)**
    - *Preconditions:* Algorithmic and static walkthrough of all defect permutations across the 4-tier precedence hierarchy.
    - *Input / Evidence:* Systematic evaluation verifying that:
      1. Any Tier 1 filesystem/probe error (`REC-STATE-06` through `REC-STATE-14`) halts before Tier 2 supporting evidence is evaluated.
      2. Any Tier 2 nonce ledger or backup defect (`REC-STATE-05`, `REC-STATE-10`) halts before Tier 3 missing discard is evaluated.
      3. Tier 3 missing discard routes (`REC-STATE-03`, `REC-STATE-04`) execute ONLY when Tier 2 evidence is 100% verified and fresh.
      4. Tier 4 valid recovery routes (`REC-STATE-16`, `REC-STATE-15`, `REC-STATE-02`, `REC-STATE-01`, Gate 6) execute ONLY when Tiers 1–3 pass with zero defects.
    - *Expected State:* Deterministic, non-overlapping order of evaluation verified; zero masking of higher-tier defects by lower-tier conditions.
    - *Mandatory Fail-Closed Action:* Any out-of-order evaluation or masking terminates immediately in `REC-STATE-05`; automated execution locked; runner halts with Exit Code 1.

76. **`REC-76`: Mixed-Defect Non-Masking and Fail-Closed Routing Invariant Across Entire Decision Tree**
    - *Preconditions:* Exhaustive combinatorial analysis of concurrent failure conditions (e.g., missing discard + stale nonce, missing discard + corrupt backup, candidate active + contradictory status + missing discard).
    - *Input / Evidence:* Verification that across all 9 authoritative combinations, every mixed-defect state routes strictly to `REC-STATE-05` (or `REC-STATE-10` for baseline metadata), never to `REC-STATE-03` or `REC-STATE-04`.
    - *Expected State:* All mixed-defect permutations resolve deterministically to `REC-STATE-05` (or `REC-STATE-10`), confirming zero lower-tier classification when higher-tier defects are present.
    - *Mandatory Fail-Closed Action:* Strictly fail-closed; zero heuristic bypass; runner halts with Exit Code 1.

### 13.9 Step AP-AG Discard Artifact Filesystem Classification & Mixed-Defect Specifications (`REC-77` through `REC-86`)

77. **`REC-77`: Discard Artifact Probe Access Denied (`0x80070005`, `REC-STATE-06`) — Tier 1 Physical Precedence**
    - *Preconditions:* Active triage evaluates candidate discard artifact path `postgresql.conf.discard.<Timestamp>.<Nonce>`.
    - *Input / Evidence:* File probe encounters Win32 error 5 (`ERROR_ACCESS_DENIED` / `0x80070005` / `UnauthorizedAccessException`) when opening or asserting the discard leaf. Live configuration matches baseline or candidate; nonce ledger is valid and fresh.
    - *Expected State:* `REC-STATE-06` (`NTFS_SECURITY_ACCESS_DENIED` — Discard Artifact Access Denied).
    - *Mandatory Fail-Closed Action:* Tier 1 physical filesystem fault takes absolute precedence over Tier 2 and Tier 3 checks; inferring file absence from access denial is strictly prohibited; routing to `REC-STATE-03` or `REC-STATE-04` is strictly prohibited; preserve live configuration file; halt fail-closed immediately; lock retries and migrations; runner halts with Exit Code 1.

78. **`REC-78`: Discard Artifact Probe Sharing Violation (`0x80070020`, `REC-STATE-13`) — Tier 1 Physical Precedence**
    - *Preconditions:* Active triage evaluates candidate discard artifact path.
    - *Input / Evidence:* File open throws `IOException` with HResult `0x80070020` (`ERROR_SHARING_VIOLATION` / Win32 32). Conflicting handle held without read/delete share flags. Nonce ledger is valid and fresh.
    - *Expected State:* `REC-STATE-13` (`NTFS_SHARING_VIOLATION_CONFLICT` — Discard Artifact Sharing Violation).
    - *Mandatory Fail-Closed Action:* Sharing violation establishes that the discard file exists on physical disk with an active handle conflict; inferring absence is strictly prohibited; Tier 1 physical fault takes absolute precedence; do not claim competing deployment worker without independent corroborating process evidence; preserve live configuration file; halt fail-closed immediately; lock retries and migrations; runner halts with Exit Code 1.

79. **`REC-79`: Discard Artifact Probe Byte-Range Lock Violation (`0x80070021`, `REC-STATE-14`) — Tier 1 Physical Precedence**
    - *Preconditions:* Active triage evaluates candidate discard artifact path.
    - *Input / Evidence:* File stream throws `IOException` with HResult `0x80070021` (`ERROR_LOCK_VIOLATION` / Win32 33) during byte-range access. Nonce ledger is valid and fresh.
    - *Expected State:* `REC-STATE-14` (`NTFS_LOCK_VIOLATION_CONFLICT` — Discard Artifact Byte-Range Lock).
    - *Mandatory Fail-Closed Action:* Range lock violation establishes handle existence and range conflict; does not establish full-file sharing violation or file absence; Tier 1 physical fault takes absolute precedence over Tier 2 and Tier 3; preserve live configuration file; halt fail-closed immediately; lock retries and migrations; runner halts with Exit Code 1.

80. **`REC-80`: Discard Artifact Directory Junction or Reparse Point Infiltration (`REC-STATE-07`) — Tier 1 Security Precedence**
    - *Preconditions:* Active triage inspects `discarded\` parent directory or discard leaf artifact.
    - *Input / Evidence:* Directory or discard file attribute query returns `([System.IO.File]::GetAttributes($path) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0`.
    - *Expected State:* `REC-STATE-07` (`DIRECTORY_OR_FILE_REPARSE_POINT` — Junction / Symlink Infiltration).
    - *Mandatory Fail-Closed Action:* Security invariant violation; junction redirection detected; Tier 1 physical/security fault takes absolute precedence over all ledger or discard absence evaluations; preserve live configuration file; halt fail-closed immediately; lock retries and migrations; runner halts with Exit Code 1.

81. **`REC-81`: Discard Artifact Missing Parent Directory (`REC-STATE-08`) — Tier 1 Physical Precedence**
    - *Preconditions:* Active triage inspects discard artifact path.
    - *Input / Evidence:* Probe throws `DirectoryNotFoundException` because `D:\Zentra\database\config\discarded` does not exist on disk.
    - *Expected State:* `REC-STATE-08` (`PARENT_DIRECTORY_MISSING` — Discard Directory Missing).
    - *Mandatory Fail-Closed Action:* Missing parent directory is a structural filesystem defect, NOT an ordinary corroborated discard absence; routing to `REC-STATE-03` or `REC-STATE-04` is strictly prohibited; Tier 1 physical fault halts fail-closed immediately; preserve live configuration; lock retries and migrations; runner halts with Exit Code 1.

82. **`REC-82`: Discard Artifact Invalid Path Syntax (`REC-STATE-09`) — Tier 1 Physical Precedence**
    - *Preconditions:* Active triage resolves candidate discard artifact path.
    - *Input / Evidence:* Path resolution throws `ArgumentException` (illegal path characters), `PathTooLongException` (> 260 chars without long-path prefix), or `NotSupportedException`.
    - *Expected State:* `REC-STATE-09` (`INVALID_OR_MALFORMED_PATH` — Malformed Discard Path).
    - *Mandatory Fail-Closed Action:* Structural syntax error halts triage under Tier 1 precedence; do not infer file absence; preserve live configuration; halt fail-closed immediately; lock retries and migrations; runner halts with Exit Code 1.

83. **`REC-83`: Discard Artifact Unclassified Generic I/O Failure (`REC-STATE-12`) — Tier 1 Physical Precedence**
    - *Preconditions:* Active triage inspects candidate discard artifact path.
    - *Input / Evidence:* File open throws unclassified `IOException` (e.g. storage device I/O error, network share disconnection, controller fault) without Win32 2, 5, 32, or 33 error code.
    - *Expected State:* `REC-STATE-12` (`IO_FAILURE_CAUSE_UNDETERMINED` — Discard I/O Failure).
    - *Mandatory Fail-Closed Action:* Unclassified I/O failure must never be assumed to represent file absence; Tier 1 physical fault takes absolute precedence; preserve live configuration; halt fail-closed immediately; lock retries and migrations; runner halts with Exit Code 1.

84. **`REC-84`: Discard Artifact Contradictory or Indeterminate Probe Observations (`REC-STATE-05`) — Tier 1 Indeterminate Halt**
    - *Preconditions:* Active triage performs redundant or repeated physical probes of candidate discard artifact.
    - *Input / Evidence:* Probe 1 reports handle open success, but immediate follow-up probe 2 reports `ERROR_PATH_NOT_FOUND` or transient fault, or conflicting attribute records returned across handle closures within the triage window.
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Indeterminate Discard Probe).
    - *Mandatory Fail-Closed Action:* Contradictory filesystem observations halt triage immediately under Tier 1 indeterminate precedence; do NOT infer absence; do NOT execute restoration; preserve live configuration; lock retries and migrations; runner halts with Exit Code 1.

85. **`REC-85`: Readable Discard Leaf with Corrupt Hash or Baseline Inversion Anomaly (`REC-STATE-05`) — Payload Integrity Failure**
    - *Preconditions:* Active triage reads discard artifact; Tier 1 physical checks pass; Tier 2 nonce ledger is valid and fresh.
    - *Input / Evidence:* Discard leaf is readable on disk, but computed SHA-256 digest either diverges from `CandidateHash` (payload corruption) or equals `ExpectedBaselineHash` (baseline inversion anomaly, indicating wrong file archived).
    - *Expected State:* `REC-STATE-05` (`CONTRADICTORY_OR_INDETERMINATE` — Discard Payload Corruption / Inversion Anomaly).
    - *Mandatory Fail-Closed Action:* Discard artifact payload integrity failure triggers critical forensic halt; do NOT treat as clean discard or missing discard; audit staging source and golden backup; preserve live configuration; lock retries and migrations; runner halts with Exit Code 1.

86. **`REC-86`: Corroborated Discard Absence with Valid Nonce vs Mixed Nonce Defect (`REC-STATE-03`/`04` vs `REC-STATE-05`)**
    - *Preconditions:* Comparative triage of corroborated missing discard (`FileNotFoundException` with genuine parent directory confirmed) under isolated vs mixed defect conditions.
    - *Input / Evidence:*
      - *Case A (Pure Missing Discard):* Tier 1 passes, Tier 2 nonce ledger is 100% valid and fresh `CONSUMED`, discard is corroborated absent:
        - If `Live == Baseline` $\to$ Strictly `REC-STATE-03`.
        - If `Live == Candidate` or `Live Divergent` $\to$ Strictly `REC-STATE-04`.
      - *Case B (Mixed Defect):* Discard is corroborated absent, BUT Tier 2 nonce record is stale (> 300s), has broken history, or golden backup hash mismatches:
        - Any live condition $\to$ Strictly `REC-STATE-05` under Tier 2 precedence.
    - *Expected State:* Case A routes strictly to Tier 3 states (`REC-STATE-03` / `REC-STATE-04`); Case B routes strictly to `REC-STATE-05`.
    - *Mandatory Fail-Closed Action:* Proves that missing discard evidence routes to Tier 3 if and only if Tiers 1 and 2 pass with zero defects; any coexisting Tier 2 defect takes absolute precedence; live file preserved; lock retries and migrations; runner halts with Exit Code 1.

### 13.10 Step AP-AH All-Supporting-Artifact Filesystem Precedence Specifications (`REC-87` through `REC-96`)

87. **`REC-87`: Golden Backup Probe Access Denied (`0x80070005`, `REC-STATE-06`) — Tier 1 Physical Precedence**
    - *Preconditions:* Active triage evaluates golden backup path `postgresql.conf.golden.<Timestamp>.<Nonce>`.
    - *Input / Evidence:* File probe encounters Win32 error 5 (`ERROR_ACCESS_DENIED` / `0x80070005` / `UnauthorizedAccessException`) when opening or asserting the golden backup leaf. Live configuration matches baseline or candidate; nonce ledger is valid and fresh.
    - *Expected State:* `REC-STATE-06` (`NTFS_SECURITY_ACCESS_DENIED` — Golden Backup Access Denied).
    - *Mandatory Fail-Closed Action:* Tier 1 physical filesystem fault takes absolute precedence over Tier 2 and Tier 3 checks; inferring file absence from access denial is strictly prohibited; routing to `REC-STATE-05` as missing backup is strictly prohibited; preserve live configuration file; halt fail-closed immediately; lock retries and migrations; runner halts with Exit Code 1.

88. **`REC-88`: Golden Backup Probe Sharing Violation (`0x80070020`, `REC-STATE-13`) — Tier 1 Physical Precedence**
    - *Preconditions:* Active triage evaluates golden backup path.
    - *Input / Evidence:* File open throws `IOException` with HResult `0x80070020` (`ERROR_SHARING_VIOLATION` / Win32 32). Conflicting handle held without read/delete share flags. Nonce ledger is valid and fresh.
    - *Expected State:* `REC-STATE-13` (`NTFS_SHARING_VIOLATION_CONFLICT` — Golden Backup Sharing Violation).
    - *Mandatory Fail-Closed Action:* Sharing violation establishes that the golden backup exists on physical disk with an active handle conflict; inferring absence or corruption is strictly prohibited; Tier 1 physical fault takes absolute precedence; do not claim competing deployment worker without independent corroborating process evidence; preserve live configuration file; halt fail-closed immediately; lock retries and migrations; runner halts with Exit Code 1.

89. **`REC-89`: Golden Backup Probe Byte-Range Lock Violation (`0x80070021`, `REC-STATE-14`) — Tier 1 Physical Precedence**
    - *Preconditions:* Active triage evaluates golden backup path.
    - *Input / Evidence:* File stream throws `IOException` with HResult `0x80070021` (`ERROR_LOCK_VIOLATION` / Win32 33) during byte-range read. Nonce ledger is valid and fresh.
    - *Expected State:* `REC-STATE-14` (`NTFS_LOCK_VIOLATION_CONFLICT` — Golden Backup Byte-Range Lock).
    - *Mandatory Fail-Closed Action:* Range lock violation establishes handle existence and range conflict; does not establish full-file sharing violation or file absence; Tier 1 physical fault takes absolute precedence over Tier 2 and Tier 3; preserve live configuration file; halt fail-closed immediately; lock retries and migrations; runner halts with Exit Code 1.

90. **`REC-90`: Nonce Ledger Record Probe Access Denied (`0x80070005`, `REC-STATE-06`) — Tier 1 Physical Precedence**
    - *Preconditions:* Active triage evaluates consumed-nonce ledger record path `D:\Zentra\database\config\.consumed_nonces\<Nonce>`.
    - *Input / Evidence:* File probe encounters Win32 error 5 (`ERROR_ACCESS_DENIED` / `0x80070005` / `UnauthorizedAccessException`) when opening or asserting the ledger leaf. Golden backup is verified; live configuration matches baseline.
    - *Expected State:* `REC-STATE-06` (`NTFS_SECURITY_ACCESS_DENIED` — Nonce Ledger Access Denied).
    - *Mandatory Fail-Closed Action:* Tier 1 physical filesystem fault takes absolute precedence; inferring file absence from access denial is strictly prohibited; routing to `REC-STATE-05` as missing ledger record is strictly prohibited; preserve live configuration; halt fail-closed immediately; lock retries and migrations; runner halts with Exit Code 1.

91. **`REC-91`: Nonce Ledger Record Probe Sharing Violation (`0x80070020`, `REC-STATE-13`) — Tier 1 Physical Precedence**
    - *Preconditions:* Active triage evaluates consumed-nonce ledger record path.
    - *Input / Evidence:* File open throws `IOException` with HResult `0x80070020` (`ERROR_SHARING_VIOLATION` / Win32 32). Conflicting handle held on nonce file without read/share permissions.
    - *Expected State:* `REC-STATE-13` (`NTFS_SHARING_VIOLATION_CONFLICT` — Nonce Ledger Sharing Violation).
    - *Mandatory Fail-Closed Action:* Sharing violation establishes that the ledger record exists on physical disk with an active handle conflict; inferring absence is strictly prohibited; Tier 1 physical fault takes absolute precedence; do not claim competing worker without process evidence; preserve live configuration file; halt fail-closed immediately; lock retries and migrations; runner halts with Exit Code 1.

92. **`REC-92`: Nonce Ledger Record Probe Byte-Range Lock Violation (`0x80070021`, `REC-STATE-14`) — Tier 1 Physical Precedence**
    - *Preconditions:* Active triage evaluates consumed-nonce ledger record path.
    - *Input / Evidence:* File stream throws `IOException` with HResult `0x80070021` (`ERROR_LOCK_VIOLATION` / Win32 33) during byte-range read of nonce JSON payload.
    - *Expected State:* `REC-STATE-14` (`NTFS_LOCK_VIOLATION_CONFLICT` — Nonce Ledger Byte-Range Lock).
    - *Mandatory Fail-Closed Action:* Range lock violation establishes handle existence and range conflict; does not establish full-file sharing violation or file absence; Tier 1 physical fault takes absolute precedence over Tier 2 schema/history checks; preserve live configuration file; halt fail-closed immediately; lock retries and migrations; runner halts with Exit Code 1.

93. **`REC-93`: Baseline Metadata File Probe Access Denied vs Malformed JSON Payload (`REC-STATE-06` vs `REC-STATE-10`)**
    - *Preconditions:* Comparative triage of baseline metadata store `baseline.json` under physical access denial vs logical payload corruption.
    - *Input / Evidence:*
      - *Case A (Physical Fault):* Probing `baseline.json` throws `UnauthorizedAccessException` (`0x80070005`).
      - *Case B (Logical Defect):* File `baseline.json` is physically readable, but JSON is unparseable or `ExpectedBaselineHash` key is missing/corrupted.
    - *Expected State:* Case A routes strictly to Tier 1 `REC-STATE-06` (`NTFS_SECURITY_ACCESS_DENIED`); Case B routes strictly to Tier 2 `REC-STATE-10` (`MALFORMED_HASH_METADATA`).
    - *Mandatory Fail-Closed Action:* Rigorous distinction enforced: physical access errors on metadata file route to Tier 1 states; readable but defective JSON payloads route to Tier 2 `REC-STATE-10`; physical faults must NEVER be reclassified as logical metadata defects; preserve live configuration; lock retries and migrations; runner halts with Exit Code 1.

94. **`REC-94`: Baseline Metadata File Probe Sharing Violation (`0x80070020`, `REC-STATE-13`) — Tier 1 Physical Precedence**
    - *Preconditions:* Active triage evaluates baseline metadata file `baseline.json`.
    - *Input / Evidence:* File open throws `IOException` with HResult `0x80070020` (`ERROR_SHARING_VIOLATION` / Win32 32). Conflicting handle held on metadata store.
    - *Expected State:* `REC-STATE-13` (`NTFS_SHARING_VIOLATION_CONFLICT` — Baseline Metadata Sharing Violation).
    - *Mandatory Fail-Closed Action:* Sharing violation establishes that the metadata file exists on physical disk with an active handle conflict; inferring absence or missing hash is strictly prohibited; Tier 1 physical fault takes absolute precedence over Tier 2 `REC-STATE-10`; preserve live configuration; halt fail-closed immediately; lock retries and migrations; runner halts with Exit Code 1.

95. **`REC-95`: All-Artifact Physical Filesystem Precedence Walkthrough Across 5 Artifacts (Live, Golden, Nonce, Metadata, Discard)**
    - *Preconditions:* Algorithmic and static walkthrough asserting that physical filesystem faults (`0x80070005`, `0x80070020`, `0x80070021`, reparse point, missing parent directory, invalid path, generic I/O, or indeterminate probe) on ANY of the 5 artifacts route strictly to Tier 1 states.
    - *Input / Evidence:* Systematic evaluation of physical faults injected on:
      1. Live target configuration file (`postgresql.conf`).
      2. Golden backup file (`postgresql.conf.golden.<Timestamp>.<Nonce>`).
      3. Consumed-nonce ledger record (`.consumed_nonces\<Nonce>`).
      4. Baseline metadata store (`baseline.json`).
      5. Discard artifact file (`postgresql.conf.discard.<Timestamp>.<Nonce>`).
    - *Expected State:* Across all 5 artifacts, every physical fault routes strictly to Tier 1 states (`REC-STATE-06`, `13`, `14`, `07`, `08`, `09`, `12`, or `05`), confirming zero demotion to Tier 2 (`REC-STATE-05`, `REC-STATE-10`) or Tier 3 (`REC-STATE-03`, `REC-STATE-04`).
    - *Mandatory Fail-Closed Action:* Deterministic Tier 1 physical precedence verified across the entire artifact surface; zero misclassification of physical errors as missing files; runner halts with Exit Code 1.

96. **`REC-96`: Mixed Physical/Logical Defect Non-Masking Invariant (Tier 1 Physical Fault on Supporting Artifact Supersedes Tier 2/3 Logical Defects)**
    - *Preconditions:* Combinatorial triage of concurrent physical and logical defects across multiple artifacts (e.g., golden backup sharing violation + stale nonce record, or nonce ledger access denied + missing discard artifact, or metadata lock violation + candidate active).
    - *Input / Evidence:* Concurrent fault scenarios evaluated where a Tier 1 physical fault on any supporting artifact coexists with Tier 2 nonce/history defects or Tier 3 missing discard evidence.
    - *Expected State:* Every concurrent permutation routes strictly to the corresponding Tier 1 physical state (`REC-STATE-06`, `REC-STATE-13`, `REC-STATE-14`, etc.); Tier 2 defects and Tier 3 missing-discard states are completely superseded and never masked or prioritized ahead of Tier 1 physical faults.
    - *Mandatory Fail-Closed Action:* Proves absolute multi-tier failure precedence: Tier 1 > Tier 2 > Tier 3 > Tier 4; halts fail-closed immediately; live file preserved; lock retries and migrations; runner halts with Exit Code 1.

---

```
STOP — STEP 2D-2A MANUAL RESTORATION RUNBOOK SPECIFICATION COMPLETE
```
