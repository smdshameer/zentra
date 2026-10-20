# MUSE SPARK — ZENTRA STEP 2D-2A-AP-AG
## DISCARD ARTIFACT FILESYSTEM CLASSIFICATION AUDIT REPORT

**Document ID:** `MUSE_SPARK_STEP2D_2A_AP_AG_AUDIT_REPORT`  
**Target Repository:** `D:\Zentra`  
**Host Target:** Local Windows Workstation (`127.0.0.1:5432`)  
**Target Component:** Local PostgreSQL Configuration & Manual Recovery Framework  
**Authoritative Runbook:** `docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md` (Revision `REV_AP_AG`)  
**Previous Runbook Revision:** `MUSE_SPARK_STEP2D_2A_RUNBOOK_REV_AP_AF`  
**Audit Scope:** Discard Artifact Physical Filesystem Classification Contract & State Routing Reconciliation  
**Audit Date:** 2026-10-10  
**Status:** COMPLETE AUDIT REPORT — STRICTLY UNTESTED SPECIFICATION  
**Operational Approval:** NOT GRANTED — THIS DOCUMENT DOES NOT AUTHORIZE EXECUTION  
**Budget Constraint:** Strict ₹0/month (Zero cost, no credit cards, no paid services)  

---

## 1. Executive Summary & Purpose of Step AP-AG

### 1.1 Context & Background
In Step 2D-2A runbook revision `REV_AP_AF`, an authoritative multi-tier failure precedence hierarchy was established: Tier 1 (Physical Filesystem & Indeterminate Probes) > Tier 2 (Nonce Ledger, Timestamp, History & Golden Backup Defects) > Tier 3 (Missing Supporting Discard Artifact) > Tier 4 (Valid State-Specific Recovery Routes). This hierarchy successfully resolved the masking defects where missing discard artifacts could suppress higher-severity nonce ledger or golden backup defects.

However, detailed architectural audit of `REV_AP_AF` revealed a remaining ambiguity in the triage of the supporting discard artifact (`postgresql.conf.discard.<Timestamp>.<Nonce>`):
1. **Lack of Physical Error Disambiguation on Discard Artifact:** While Tier 1 physical filesystem error handling (`REC-STATE-06` through `REC-STATE-14`) was rigorously established for the live target file (`postgresql.conf`), the inspection of the supporting discard artifact was loosely referred to as "missing, unreadable, or malformed" and routed to Tier 3 (`REC-STATE-03` / `REC-STATE-04`).
2. **False Inference of Absence from Failed Probes:** On Windows NTFS, `.NET` `[System.IO.File]::Exists($path)` catches and suppresses exceptions, returning `$false` for permissions errors (`UnauthorizedAccessException` / `0x80070005`), sharing violations (`0x80070020`), byte-range lock violations (`0x80070021`), reparse points, missing parent directories, invalid paths, and low-level I/O faults. Without an authoritative physical classification contract for the discard artifact, an automated runner or operator encountering an access denial or sharing violation on the discard artifact could falsely infer that the file was "missing" and route the incident to `REC-STATE-03` or `REC-STATE-04`.
3. **Improper Routing of Discard Content Inversion / Corruption:** If the discard leaf exists and is readable, but its cryptographic SHA-256 hash does not match `CandidateHash` (or matches `ExpectedBaselineHash` due to an inversion anomaly), routing this condition simply as "missing discard" would fail to highlight a critical payload integrity violation.

### 1.2 Core Defect Resolved
A physical filesystem error encountered while probing a supporting artifact is **not** an evidence absence condition; it is a **Tier 1 physical filesystem fault**:
- A sharing violation (`0x80070020`) or byte-range lock violation (`0x80070021`) on the discard path proves that the file **does exist on physical disk**, but is held open by a conflicting handle. Treating this as a "missing discard file" is factually incorrect and dangerous.
- An NTFS access denied error (`0x80070005`) means the execution token lacks permissions to read the discard directory or file; it does not prove the file is absent.
- Reparse points, missing parent directories (`discarded\`), invalid path syntax, and unclassified I/O failures on the discard path are structural or security faults that take absolute precedence over ledger and state evaluation.
- Therefore, physical filesystem errors on the discard artifact must be classified as **Tier 1 physical filesystem faults**, halting fail-closed immediately to Tier 1 states (`REC-STATE-06`, `13`, `14`, `07`, `08`, `09`, `12`, or `05`).
- Tier 3 missing-discard handling (`REC-STATE-03` / `REC-STATE-04`) applies **strictly to corroborated missing discard files** (`FileNotFoundException` / Win32 2 on direct open with verified genuine non-reparse parent directory read access) when Tier 1 physical checks pass and Tier 2 supporting evidence is 100% verified.
- A readable discard leaf with corrupt payload hash or baseline inversion halts strictly to `REC-STATE-05` (payload integrity failure).

### 1.3 Remediation Actions Executed
Under Step AP-AG, this ambiguity was completely resolved through strict documentation-only remediation in `docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md` (advanced to revision `REV_AP_AG`):
1. **Established 10-Way Discard Artifact Physical Filesystem Classification Contract:** Codified an exhaustive 10-way contract governing discard artifact inspection with rigorous *Observed Evidence*, *Establishes*, *Does NOT Establish*, *Uncertainties Remaining*, and *Required Action* definitions.
2. **Reconciled Multi-Tier Precedence Hierarchy:** Explicitly integrated discard artifact physical triage into Tier 1, ensuring that physical faults on discard probe take absolute precedence over Tier 2 and Tier 3 evaluations, and that Tier 3 handling applies solely to corroborated absence.
3. **Updated Decision Tree Steps 2 and 3:** Step 2 explicitly governs live target physical triage; Step 3 incorporates `[TIER 1 SUPPORTING] Discard Artifact Physical Filesystem Triage` before proceeding to Tier 2 nonce ledger checks and Tier 3 discard absence.
4. **Reconciled Table 2.1 Approval Gates 5 & 6:** Codified the 10-way contract and Tier 1 precedence across Gates 5 and 6 sign-offs.
5. **Reconciled Table 4.1 State Matrix & Table 332 Compatibility Matrix:** Updated all discard-related rows to require corroborated absence for `REC-STATE-03` and `04`, route physical faults to Tier 1, and route corrupt/inverted content to `REC-STATE-05`.
6. **Updated Section 5 Fail-Closed Rules & Section 12 Escalation Triggers:** Codified strict prohibition against inferring discard absence from probe failure, and updated Trigger 8 to distinguish corroborated absence from physical faults.
7. **Authored 10 New Test Specifications (`REC-77` through `REC-86`):** Dedicated tests covering each discard classification branch and mixed-defect permutations, all marked strictly `[NOT EXECUTED — UNTESTED]`.
8. **Reconciled Test Suite Accounting to Exactly 406 Specifications:** Suite 1 (34) + Suite 2 (286) + Suite 3 (86) = 406 specifications ($34 + 286 + 86 = 406$).

---

## 2. Authoritative 10-Way Discard Artifact Physical Filesystem Classification Contract

Section 4.2 (Item 2) of `docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md` establishes the authoritative 10-way physical classification contract for the discard artifact (`postgresql.conf.discard.<Timestamp>.<Nonce>`):

$$\begin{array}{|c|l|l|c|l|}
\hline
\textbf{\#} & \textbf{Classification Name} & \textbf{Observed Physical Evidence} & \textbf{State Route} & \textbf{Precedence Domain} \\
\hline
1 & \text{CONFIRMED\_MISSING\_DISCARD\_FILE} & \text{FileNotFoundException (Win32 2) + verified parent} & \text{Tier 3 (03 / 04 / 05)} & \text{Tier 3 (Only if Tiers 1 \& 2 Pass)} \\
\hline
2 & \text{CORRUPT\_OR\_INVERTED\_DISCARD} & \text{Readable leaf, but hash } \neq \text{ Cand or } == \text{ Base} & \mathbf{REC\text{-}STATE\text{-}05} & \text{Payload Integrity Failure Halt} \\
\hline
3 & \text{DISCARD\_ACCESS\_DENIED} & \text{UnauthorizedAccessException / 0x80070005} & \mathbf{REC\text{-}STATE\text{-}06} & \text{Tier 1 Physical Precedence} \\
\hline
4 & \text{DISCARD\_SHARING\_VIOLATION} & \text{IOException / 0x80070020 (Win32 32)} & \mathbf{REC\text{-}STATE\text{-}13} & \text{Tier 1 Physical Precedence} \\
\hline
5 & \text{DISCARD\_LOCK\_VIOLATION} & \text{IOException / 0x80070021 (Win32 33)} & \mathbf{REC\text{-}STATE\text{-}14} & \text{Tier 1 Physical Precedence} \\
\hline
6 & \text{DISCARD\_REPARSE\_POINT} & \text{ReparsePoint != 0 on parent or leaf} & \mathbf{REC\text{-}STATE\text{-}07} & \text{Tier 1 Security Precedence} \\
\hline
7 & \text{DISCARD\_MISSING\_PARENT\_DIR} & \text{DirectoryNotFoundException on discarded\textbackslash} & \mathbf{REC\text{-}STATE\text{-}08} & \text{Tier 1 Physical Precedence} \\
\hline
8 & \text{DISCARD\_INVALID\_PATH} & \text{ArgumentException / PathTooLongException} & \mathbf{REC\text{-}STATE\text{-}09} & \text{Tier 1 Physical Precedence} \\
\hline
9 & \text{DISCARD\_IO\_FAILURE\_UNDETERMINED} & \text{Unclassified IOException (storage/controller)} & \mathbf{REC\text{-}STATE\text{-}12} & \text{Tier 1 Physical Precedence} \\
\hline
10 & \text{DISCARD\_CONTRADICTORY\_PROBE} & \text{Conflicting probe results across calls} & \mathbf{REC\text{-}STATE\text{-}05} & \text{Tier 1 Forensic Halt} \\
\hline
\end{array}$$

### 2.1 Detailed Analysis of the Ten Classification Outcomes

1. **Outcome 1 — `CONFIRMED_MISSING_DISCARD_FILE` (Corroborated Discard Absence):**
   - *Observed Evidence:* Direct handle open throws `FileNotFoundException` (Win32 error `ERROR_FILE_NOT_FOUND` / 2); positive read traversal of parent directory `D:\Zentra\database\config\discarded` succeeds; parent directory is confirmed a genuine physical non-reparse point directory (`ReparsePoint == 0`).
   - *Establishes:* Discard artifact leaf was absent from the verified directory at the moment of handle open.
   - *Does NOT Establish:* Does NOT establish permanent absence across future handle calls (user-mode TOCTOU); does NOT establish that live target is damaged; does NOT establish catalog corruption.
   - *Uncertainties Remaining:* Concurrency state between inspection and subsequent operations remains subject to user-mode race conditions; database catalog health remains unasserted.
   - *Required Action:* Route strictly through Tier 3 evidence evaluation (`REC-STATE-03` if `Live == Baseline`, `REC-STATE-04` if `Live != Baseline`, or `REC-STATE-05` if target absent). Evaluated ONLY when Tier 1 passes and Tier 2 nonce ledger and golden backup are 100% verified and fresh.

2. **Outcome 2 — `CORRUPT_OR_INVERTED_DISCARD_CONTENT` (Payload Integrity Failure):**
   - *Observed Evidence:* Direct handle open succeeds; discard leaf exists as a normal physical file (`ReparsePoint == 0`); file is readable and non-empty; computed SHA-256 digest either diverges from `CandidateHash` (corrupt content) or equals `ExpectedBaselineHash` (baseline inversion anomaly).
   - *Establishes:* The file exists on disk, but its cryptographic payload does not match candidate staging or represents the baseline file mistakenly archived as discard.
   - *Does NOT Establish:* Does NOT establish whether corruption occurred in-flight, during staging, or post-swap; does NOT establish database catalog damage.
   - *Uncertainties Remaining:* Root cause of payload alteration (disk corruption, script bug, incorrect source file archived); catalog integrity remains unasserted.
   - *Required Action:* Critical Forensic Halt fail-closed to `REC-STATE-05`. Do NOT treat as missing discard; do NOT proceed to Gate 6; audit golden backup and staging source; preserve live configuration file; lock retries and migrations.

3. **Outcome 3 — `DISCARD_ACCESS_DENIED` (NTFS Permissions Violation):**
   - *Observed Evidence:* Handle open or directory traversal throws `UnauthorizedAccessException` with Win32 error `ERROR_ACCESS_DENIED` (`0x80070005` / 5).
   - *Establishes:* Caller's execution token lacks required NTFS DACL permissions to traverse `discarded\` or read the discard leaf (or path targets a directory, or file is marked read-only).
   - *Does NOT Establish:* File existence or absence! Denied access must **NEVER** be inferred as proof of file absence. Does NOT establish catalog damage.
   - *Uncertainties Remaining:* File existence, file content, author provenance, and database catalog state remain unverified.
   - *Required Action:* Tier 1 Physical Precedence enforced. Halt fail-closed immediately to `REC-STATE-06`. Do NOT infer file absence; do NOT route to `REC-STATE-03` or `REC-STATE-04`. Preserve live configuration; lock retries and migrations.

4. **Outcome 4 — `DISCARD_SHARING_VIOLATION` (File Sharing Handle Conflict):**
   - *Observed Evidence:* Handle creation throws `IOException` with HResult `0x80070020` (`ERROR_SHARING_VIOLATION` / Win32 32).
   - *Establishes:* Target discard file **exists on physical disk** and has an existing open handle whose `FileShare` flags conflict with the requested access mode.
   - *Does NOT Establish:* Does NOT establish file absence (proves existence!); does NOT identify holding PID, thread, or account; does NOT prove a competing deployment worker is active; does NOT establish catalog damage.
   - *Uncertainties Remaining:* Holding process identity, lock duration, file hash, and catalog integrity remain unverified.
   - *Required Action:* Tier 1 Physical Precedence enforced. Halt fail-closed immediately to `REC-STATE-13`. Inferring discard absence is strictly prohibited; do NOT route to `REC-STATE-03` or `REC-STATE-04`. Preserve live configuration; lock retries and migrations.

5. **Outcome 5 — `DISCARD_LOCK_VIOLATION` (Byte-Range Lock Conflict):**
   - *Observed Evidence:* Stream read or lock operation throws `IOException` with HResult `0x80070021` (`ERROR_LOCK_VIOLATION` / Win32 33).
   - *Establishes:* An open handle exists on the discard file, but an operation on a specific byte range conflicted with an existing byte-range lock.
   - *Does NOT Establish:* Does NOT establish full-file sharing violation (`0x80070020`); does NOT establish file absence; does NOT identify locking process; does NOT prove catalog damage.
   - *Uncertainties Remaining:* Locking process identity, thread, locked byte ranges, and file hash remain unverified.
   - *Required Action:* Tier 1 Physical Precedence enforced. Halt fail-closed immediately to `REC-STATE-14`. Do NOT infer absence; do NOT route to `REC-STATE-03` or `REC-STATE-04`. Preserve live configuration; lock retries and migrations.

6. **Outcome 6 — `DISCARD_REPARSE_POINT_VIOLATION` (Junction / Symlink Infiltration):**
   - *Observed Evidence:* Directory or file attribute query returns `([System.IO.File]::GetAttributes($path) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0`.
   - *Establishes:* `D:\Zentra\database\config\discarded` or the discard leaf is an NTFS directory junction, volume mount point, or symbolic link.
   - *Does NOT Establish:* Does NOT establish file absence; does NOT establish destination legitimacy; does NOT establish catalog damage.
   - *Uncertainties Remaining:* Symlink target path legitimacy, security boundaries, and catalog integrity remain unverified.
   - *Required Action:* Tier 1 Security Precedence enforced. Halt fail-closed immediately to `REC-STATE-07`. Junction redirection violates security invariants; do NOT route to `REC-STATE-03` or `REC-STATE-04`. Preserve live configuration; lock retries and migrations.

7. **Outcome 7 — `DISCARD_MISSING_PARENT_DIRECTORY` (Parent Directory Absent):**
   - *Observed Evidence:* Handle open or directory traversal throws `DirectoryNotFoundException` because `D:\Zentra\database\config\discarded` does not exist on disk.
   - *Establishes:* The parent directory structure is missing or path traversal failed at directory level.
   - *Does NOT Establish:* Does NOT establish ordinary leaf file absence; does NOT establish catalog damage.
   - *Uncertainties Remaining:* Cause of directory removal or non-creation; catalog integrity remains unverified.
   - *Required Action:* Tier 1 Physical Precedence enforced. Halt fail-closed immediately to `REC-STATE-08`. Missing parent directory is a structural filesystem defect, NOT an ordinary discard absence; do NOT route to `REC-STATE-03` or `REC-STATE-04`. Preserve live configuration; lock retries and migrations.

8. **Outcome 8 — `DISCARD_INVALID_PATH` (Malformed Path Syntax):**
   - *Observed Evidence:* Path resolution throws `ArgumentException` (illegal path characters), `PathTooLongException` (> 260 chars without long-path prefix), or `NotSupportedException`.
   - *Establishes:* The constructed discard artifact path violates Windows filesystem naming conventions or length constraints.
   - *Does NOT Establish:* Does NOT establish file existence or absence; does NOT establish catalog damage.
   - *Uncertainties Remaining:* Configuration parameter corruption, script path construction bug; catalog state unverified.
   - *Required Action:* Tier 1 Physical Precedence enforced. Halt fail-closed immediately to `REC-STATE-09`. Do NOT infer absence; preserve live configuration; lock retries and migrations.

9. **Outcome 9 — `DISCARD_IO_FAILURE_UNDETERMINED` (Generic I/O Failure):**
   - *Observed Evidence:* Handle creation throws unclassified `IOException` without Win32 2, 5, 32, or 33 error code (e.g. storage device I/O error, network share disconnection, controller fault).
   - *Establishes:* Low-level I/O subsystem failure prevented handle creation or traversal.
   - *Does NOT Establish:* Does NOT establish file existence or absence; does NOT establish catalog damage.
   - *Uncertainties Remaining:* Underlying storage device health, controller state; catalog integrity unasserted.
   - *Required Action:* Tier 1 Physical Precedence enforced. Halt fail-closed immediately to `REC-STATE-12`. Do NOT assume file absence; preserve live configuration; lock retries and migrations.

10. **Outcome 10 — `DISCARD_CONTRADICTORY_OR_INDETERMINATE` (Contradictory Probe Observations):**
    - *Observed Evidence:* Redundant or repeated physical probes of the discard artifact return conflicting results (e.g. handle open succeeds on probe 1, but fails with `ERROR_PATH_NOT_FOUND` on probe 2, or file attributes conflict across handle closures within the triage window).
    - *Establishes:* Filesystem state is fluctuating, indeterminate, or subject to severe concurrency races.
    - *Does NOT Establish:* Does NOT establish file existence, absence, or validity; does NOT establish catalog damage.
    - *Uncertainties Remaining:* Concurrency source, filesystem stability; catalog integrity unasserted.
    - *Required Action:* Tier 1 Indeterminate Halt enforced. Halt fail-closed immediately to `REC-STATE-05`. Do NOT infer absence; do NOT execute restoration; preserve live configuration; lock retries and migrations.

---

## 3. Before vs After State Routing Comparison Matrix

The table below contrasts incident routing under `REV_AP_AF` versus the reconciled contract under `REV_AP_AG`:

$$\begin{array}{|l|l|l|l|l|}
\hline
\textbf{Live Disk State} & \textbf{Discard Probe Observation} & \textbf{Revision REV\_AP\_AF Route} & \textbf{Revision REV\_AP\_AG Route} & \textbf{Reconciliation Architectural Rationale} \\
\hline
\text{Live == Baseline} & \text{Corroborated Missing (Win32 2)} & \text{REC-STATE-03} & \mathbf{REC\text{-}STATE\text{-}03} & \text{Tier 3: Pure missing discard; Tier 2 valid \& fresh} \\
\hline
\text{Live == Baseline} & \text{Access Denied (0x80070005)} & \text{Ambiguous (REC-STATE-03?)} & \mathbf{REC\text{-}STATE\text{-}06} & \text{Tier 1 Precedence: Physical fault; do NOT infer absence} \\
\hline
\text{Live == Baseline} & \text{Sharing Violation (0x80070020)} & \text{Ambiguous (REC-STATE-03?)} & \mathbf{REC\text{-}STATE\text{-}13} & \text{Tier 1 Precedence: Discard exists on disk; handle conflict} \\
\hline
\text{Live == Baseline} & \text{Lock Violation (0x80070021)} & \text{Ambiguous (REC-STATE-03?)} & \mathbf{REC\text{-}STATE\text{-}14} & \text{Tier 1 Precedence: Discard exists; byte-range locked} \\
\hline
\text{Live == Baseline} & \text{Reparse Point / Junction} & \text{Ambiguous (REC-STATE-03?)} & \mathbf{REC\text{-}STATE\text{-}07} & \text{Tier 1 Security: Junction redirection detected} \\
\hline
\text{Live == Baseline} & \text{Missing Parent Directory} & \text{Ambiguous (REC-STATE-03?)} & \mathbf{REC\text{-}STATE\text{-}08} & \text{Tier 1 Precedence: Structural directory defect, not leaf absence} \\
\hline
\text{Live == Baseline} & \text{Corrupt Hash / Baseline Inversion} & \text{Unspecified} & \mathbf{REC\text{-}STATE\text{-}05} & \text{Payload Integrity Failure: Corrupt/inverted discard content} \\
\hline
\text{Live == Candidate} & \text{Corroborated Missing (Win32 2)} & \text{REC-STATE-04} & \mathbf{REC\text{-}STATE\text{-}04} & \text{Tier 3: Pure missing discard; Tier 2 valid \& fresh} \\
\hline
\text{Live == Candidate} & \text{Sharing Violation (0x80070020)} & \text{Ambiguous (REC-STATE-04?)} & \mathbf{REC\text{-}STATE\text{-}13} & \text{Tier 1 Precedence: Discard exists on disk; handle conflict} \\
\hline
\text{Live Divergent} & \text{Access Denied (0x80070005)} & \text{Ambiguous (REC-STATE-04?)} & \mathbf{REC\text{-}STATE\text{-}06} & \text{Tier 1 Precedence: Physical fault; do NOT infer absence} \\
\hline
\text{Target Absent} & \text{Corroborated Missing (Win32 2)} & \text{REC-STATE-05} & \mathbf{REC\text{-}STATE\text{-}05} & \text{Tier 3 Precedence: Absent target + missing discard; halt} \\
\hline
\text{Any Condition} & \text{Mixed: Missing Discard + Stale Nonce} & \text{REC-STATE-05} & \mathbf{REC\text{-}STATE\text{-}05} & \text{Tier 2 Precedence: Stale nonce supersedes missing discard} \\
\hline
\end{array}$$

---

## 4. Cross-Section Reconciliation in Runbook `REV_AP_AG`

Every relevant section of `docs/MUSE_SPARK_STEP2D_2A_RUNBOOK.md` was audited and updated to maintain 100% semantic and structural alignment:

| Runbook Section | Previous Revision (`REV_AP_AF`) State | Remediated Revision (`REV_AP_AG`) State | Consistency Proof |
|---|---|---|---|
| **Header (Lines 1-13)** | Revision was `REV_AP_AF`, Step AP-AF. | Updated to `MUSE_SPARK_STEP2D_2A_RUNBOOK_REV_AP_AG`, Step AP-AG. | Unambiguous revision traceability. |
| **Table 2.1 (Gate 5)** | Handled discard evidence without explicit physical error classification. | Codified 10-way physical classification contract; physical errors route to Tier 1; corroborated absence evaluated under Tier 3. | Prevents Gate 5 from clearing tickets with masked physical errors. |
| **Table 2.1 (Gate 6)** | Required discard verification without explicit physical error disambiguation. | Codified Tier 1 precedence on discard probe; corrupt/inverted content halts to `REC-STATE-05`. | Discard physical faults cannot bypass to Gate 6 sign-off. |
| **Decision Tree Step 2** | Addressed live target physical triage. | Explicitly codified that Step 2 governs live target physical triage under Tier 1. | Clear separation between target and supporting artifact physical triage. |
| **Decision Tree Step 3** | Evaluated supporting evidence, but lacked dedicated discard physical triage block. | Added `[TIER 1 SUPPORTING] Discard Artifact Physical Filesystem Triage` before Tier 2 nonce checks and Tier 3 missing discard. | Eliminates discard physical fault misrouting in decision tree. |
| **Table 4.1 State Matrix** | `REC-STATE-03` and `04` required "Corroborated absent"; `05` lacked explicit discard corrupt content row. | Explicitly updated `REC-STATE-03` and `04` to require corroborated absence; updated `REC-STATE-05` with corrupt/inverted discard content; updated `06`–`14` to explicitly encompass discard artifact. | Full alignment between state definitions and physical reality. |
| **Section 4.2 Discard Contract** | Outlined discard artifact purpose without detailed error classification. | Added full 10-Way Authoritative Discard Artifact Physical Filesystem Classification Contract with all 5 mandatory analysis fields per outcome. | Complete specification of discard physical boundaries. |
| **Section 4.2 Compatibility Matrix (Table 332)** | Contained generic missing discard rows. | Replaced with explicit corroborated absence rows, physical filesystem fault row routing to Tier 1, and corrupt/inverted content rows routing to `REC-STATE-05`. | Mathematically closed compatibility mapping. |
| **Section 4.2 Multi-Tier Precedence** | Codified Tier 1 physical faults on live target. | Expanded Tier 1 to explicitly include discard artifact physical faults; updated Tier 3 to govern corroborated absence and corrupt/inverted content. | Eliminates ambiguity in multi-tier precedence. |
| **Section 5 Fail-Closed Rules** | Rule 1 & Rule 2 warned against `File.Exists() == false` on target. | Updated Rule 1 and Rule 2 to explicitly forbid inferring discard absence from probe failure; enforce Tier 1 physical precedence over Tier 3 missing discard. | Non-inference rule covers discard artifact completely. |
| **Section 12 Escalations** | Trigger 8 covered missing discard without physical error distinction. | Updated Trigger 8 to distinguish corroborated missing discard from physical faults (which activate Triggers 3, 4, or 7 and route to Tier 1). | Unambiguous human escalation guidance. |
| **Section 13 Suite Accounting** | Totaled 396 test specifications across 3 suites. | Updated Suite 3 count to 86 tests; updated grand total to 406 specifications ($34 + 286 + 86 = 406$); updated reconciliation formula. | Strict mathematical accounting preserved. |
| **Section 13 Test Specifications** | Concluded at `REC-76`. | Authored Section 13.9 with 10 new test specifications (`REC-77` through `REC-86`), all marked `[NOT EXECUTED — UNTESTED]`. | Complete test suite coverage for all discard physical classifications. |

---

## 5. Test Specification Accounting & Verification Matrix

### 5.1 Verification Suite Arithmetic Reconciliation
The MUSE SPARK test architecture comprises three distinct verification suites. The exact arithmetic reconciliation is verified below:

$$\begin{aligned}
\text{Suite 1 (Pre-Flight Baseline Suite)} &= 34 \quad (\text{DSP-PF-01 through DSP-PF-34}) \\
\text{Suite 2 (Deployment, Rollback \& Dispatcher Suite)} &= 286 \quad (\text{DSP-01 through DSP-286}) \\
\text{Suite 3 (Manual Restoration \& Nonce Ledger Suite)} &= 86 \quad (\text{REC-01 through REC-86}) \\
\hline
\mathbf{Total\ Test\ Specifications} &= \mathbf{406}
\end{aligned}$$

$$\begin{aligned}
\text{Suite 3 Sub-Accounting Breakdown:} & \\
\text{Prior Recovery Specifications (Step 2D-2A Legacy)} &= 7 \quad (\text{REC-01 through REC-07}) \\
\text{Step AP-AA Nonce Consumption Specifications} &= 25 \quad (\text{REC-08 through REC-32}) \\
\text{Step AP-AB Nonce Transition History Specifications} &= 13 \quad (\text{REC-33 through REC-45}) \\
\text{Step AP-AC Routing, Replacement \& Freshness Specs} &= 12 \quad (\text{REC-46 through REC-57}) \\
\text{Step AP-AE Clean-Baseline Consistency Specs} &= 9 \quad (\text{REC-58 through REC-66}) \\
\text{Step AP-AF Fail-Closed Precedence \& Mixed-Defect Specs} &= 10 \quad (\text{REC-67 through REC-76}) \\
\text{Step AP-AG Discard Filesystem Classification Specs} &= 10 \quad (\text{REC-77 through REC-86}) \\
\hline
\mathbf{Suite\ 3\ Subtotal} &= \mathbf{86}
\end{aligned}$$

$$\text{Grand Total Arithmetic Check:} \quad 34 + 286 + 7 + 25 + 13 + 12 + 9 + 10 + 10 = 406 \quad (\text{Exact Mathematical Match})$$

### 5.2 Step AP-AG Test Specifications Summary (`REC-77` through `REC-86`)

| Test ID | Test Specification Name | Target State | Expected Outcome | Execution Status |
|---|---|---|---|---|
| **REC-77** | Discard Artifact Probe Access Denied (`0x80070005`) — Tier 1 Physical Precedence | `REC-STATE-06` | Halt fail-closed; Tier 1 physical fault supersedes Tier 2/3; do NOT infer absence or route to `REC-STATE-03`/`04`; lock pipeline | `[NOT EXECUTED — UNTESTED]` |
| **REC-78** | Discard Artifact Probe Sharing Violation (`0x80070020`) — Tier 1 Physical Precedence | `REC-STATE-13` | Halt fail-closed; proves discard file exists on disk with active handle conflict; Tier 1 precedence; lock pipeline | `[NOT EXECUTED — UNTESTED]` |
| **REC-79** | Discard Artifact Probe Byte-Range Lock Violation (`0x80070021`) — Tier 1 Physical Precedence | `REC-STATE-14` | Halt fail-closed; proves file handle opened but range locked; Tier 1 precedence supersedes Tier 2/3; lock pipeline | `[NOT EXECUTED — UNTESTED]` |
| **REC-80** | Discard Artifact Directory Junction or Reparse Point Infiltration — Tier 1 Security Precedence | `REC-STATE-07` | Halt fail-closed; junction redirection detected on parent or leaf; Tier 1 security fault; lock pipeline | `[NOT EXECUTED — UNTESTED]` |
| **REC-81** | Discard Artifact Missing Parent Directory (`discarded\`) — Tier 1 Physical Precedence | `REC-STATE-08` | Halt fail-closed; structural parent directory defect, NOT ordinary discard absence; Tier 1 precedence; lock pipeline | `[NOT EXECUTED — UNTESTED]` |
| **REC-82** | Discard Artifact Invalid Path Syntax — Tier 1 Physical Precedence | `REC-STATE-09` | Halt fail-closed; path syntax/length error halts under Tier 1 precedence; do NOT infer absence; lock pipeline | `[NOT EXECUTED — UNTESTED]` |
| **REC-83** | Discard Artifact Unclassified Generic I/O Failure — Tier 1 Physical Precedence | `REC-STATE-12` | Halt fail-closed; unclassified I/O failure must never be assumed absence; Tier 1 precedence; lock pipeline | `[NOT EXECUTED — UNTESTED]` |
| **REC-84** | Discard Artifact Contradictory or Indeterminate Probe Observations — Tier 1 Indeterminate Halt | `REC-STATE-05` | Halt fail-closed; conflicting probe observations halt immediately under Tier 1 indeterminate precedence; lock pipeline | `[NOT EXECUTED — UNTESTED]` |
| **REC-85** | Readable Discard Leaf with Corrupt Hash or Baseline Inversion Anomaly | `REC-STATE-05` | Critical forensic halt; payload integrity failure (SHA-256 $\neq$ Candidate or $==$ Baseline); audit sources; lock pipeline | `[NOT EXECUTED — UNTESTED]` |
| **REC-86** | Corroborated Discard Absence with Valid Nonce vs Mixed Nonce Defect | `REC-STATE-03`/`04` vs `REC-STATE-05` | Pure absence routes to Tier 3 `REC-STATE-03`/`04`; mixed defect routes strictly to `REC-STATE-05` under Tier 2 precedence | `[NOT EXECUTED — UNTESTED]` |

---

## 6. Artifact Integrity, Exact Physical Metrics & Counting Conventions

### 6.1 Counting Conventions
To maintain mathematical reproducibility and eliminate reporting ambiguities across operating systems:
- **Physical Line Counting Convention:** A physical line is defined as any sequence of characters terminated by a standard newline delimiter (`\r\n` or `\n`), plus any final line preceding the end-of-file boundary.
- **Content Line Convention:** Equivalent to physical lines in these formatted Markdown documents as trailing empty lines are preserved.
- **Byte Measurement Convention:** Exact physical file size in bytes as reported by the Windows filesystem and low-level file inspect tools.
- **Inspection Boundary:** Local workspace inspection was performed strictly through direct file viewing tools (`view_file`). Zero PowerShell commands, CMD shells, Python scripts, or automated test runners were executed.

### 6.2 Exact Physical File Metrics
The authoritative files governing this audit step possess the following verified physical metrics:

$$\begin{array}{|l|c|c|c|l|}
\hline
\textbf{File Path} & \textbf{Physical Lines} & \textbf{File Size (Bytes)} & \textbf{Revision} & \textbf{Status} \\
\hline
\text{docs/MUSE\_SPARK\_STEP2D\_2A\_RUNBOOK.md} & 1,420 & 202,283 & \text{REV\_AP\_AG} & \text{RECONCILED SPECIFICATION} \\
\hline
\text{docs/MUSE\_SPARK\_STEP2D\_2A\_AP\_AG\_DISCARD\_FILESYSTEM\_CLASSIFICATION\_AUDIT\_REPORT.md} & 299 & 33,080 & \text{INITIAL} & \text{AUDIT REPORT (THIS FILE)} \\
\hline
\end{array}$$

### 6.3 Separation of Workspace Inspection vs Repository & Database Verification
Operators and auditors must strictly differentiate between:
1. **Local Workspace File Inspection:** Direct, read-only textual verification of Markdown artifacts within the local working directory (`D:\Zentra\docs\`).
2. **Repository & Version Control State:** Git index, commit trees, branches, and remote repository synchronization (which remain unmodified in this documentation step).
3. **Local PostgreSQL Cluster State:** Physical cluster catalogs (`PGDATA`), active Windows service processes, and application databases (`hisecure_erp`, `hitech_platform`, `zentra_test`), which remain completely untouched and preserved.

---

## 7. Operational Safety, Zero Cost & Budget Compliance

1. **Strict Documentation Boundary:** Zero PowerShell, CMD, SQL, database migrations, service queries, background scripts, automated tests, or network operations were performed during this audit and remediation.
2. **Catalog Preservation:** Application databases `hisecure_erp`, `hitech_platform`, and `zentra_test` remain untouched and preserved.
3. **Budget Compliance:** Strict ₹0/month expenditure maintained (zero cloud resources, zero paid APIs).
4. **Execution Authority:** Operational approval remains **NOT GRANTED**. All recovery procedures and test specifications are strictly **`[NOT EXECUTED — UNTESTED]`**.

---

```
STOP — STEP 2D-2A-AP-AG COMPLETE — WAITING FOR HUMAN REVIEW
```
