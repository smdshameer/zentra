# ZENTRA — Staged Ingestion, OCR & AI Architecture Specification
## Hi-Tech Lab Field Service Management Platform

---

## 1. Architectural Purpose & Boundaries

In real-world Hi-Tech Lab operations, complaint data enters the ecosystem through heterogeneous, uncoordinated channels:
1. **Periodic Spreadsheet Dumps**: District Education Officers and state helpline contractors export bulk complaints in Microsoft Excel (`.xlsx`, `.xls`) or CSV formats.
2. **Direct Google Form Submissions**: Lab Instructors (AI Teachers) submit incident forms with attached photos.
3. **Physical / Scanned Service Call Logs**: Paper field call reports signed by Headmasters, scanned into PDF format.
4. **Mobile Screenshots**: WhatsApp screenshots or portal error screen captures shared by teachers.

A primary cause of data loss in legacy applications was **uncontrolled, direct-to-production imports**: raw spreadsheets were parsed and written directly into live production collections, overwriting active engineer assignments, resetting statuses, and creating duplicate tickets.

ZENTRA enforces an uncompromising architectural principle:
> [!IMPORTANT]
> **NO DIRECT-TO-PRODUCTION INGESTION.**
> All external files, OCR extractions, and AI-assisted data must pass through an isolated **Staging Pipeline** with an interactive **Human-in-the-Loop Approval Gate** before a single byte touches production tables.

---

## 2. End-to-End Staged Ingestion Pipeline

```mermaid
graph TD
    A["Raw Ingestion File<br/>(XLSX / XLS / CSV / PDF / Image)"] --> B["Upload to S3 Secure Staging Bucket"]
    B --> C["Create import_jobs Record (Status: UPLOADED)"]
    C --> D["Parsing & Tabular Extraction"]
    D --> E["Dynamic Column Mapping<br/>(Auto-detect headers: UDISE, Issue, Contact, etc.)"]
    E --> F["Data Sanitization & Normalization<br/>(Trim quotes, 10-digit phone, 11-digit UDISE)"]
    F --> G["Natural Key & Identity Resolution"]
    G --> H["Controlled Duplicate Classification Engine"]
    H --> I["Validation & School Master Linkage Check"]
    I --> J["Insert into import_staging_records (Status: STAGED)"]
    J --> K["ZENTRA Web: Interactive Diff & Anomaly Preview"]
    K --> L{"Admin Review & Approval Gate"}
    L -->|Rejected / Cancelled| M["Job Aborted; Staging Discarded; Zero Prod Impact"]
    L -->|Approved with Corrections| N["Atomic Database Transaction Commit"]
    N --> O["Insert source_complaints (Immutable)"]
    N --> P["Insert / Link service_cases (Operational)"]
    N --> Q["Emit Audit Events & Notify Coordinators"]
```

---

## 3. Complaint Identity & Controlled Duplicate Classification

Legacy systems failed by applying naive deduplication rules (such as a unique constraint on `UDISE + Issue`). Phase 0 data proved that:
- A single school frequently experiences **multiple distinct equipment failures simultaneously** (e.g., a broken I/O box and an un-assembled computer table in the same week). Treating these as duplicates caused severe under-reporting.
- Conversely, re-reporting an unresolved UPS breakdown three days later generates duplicate complaints that must be linked.

ZENTRA replaces simplistic constraints with a **5-Tier Duplicate Classification Model**:

```mermaid
graph TD
    Inbound["Inbound Staged Complaint Record"] --> Step1{"Does source_system + external_ticket_id exist?"}
    Step1 -->|Yes| T1["Tier 1: EXACT SOURCE DUPLICATE<br/>(Action: Update Source Metadata Only; Never Overwrite Field Work)"]
    Step1 -->|No / Blank ID| Step2{"Does UDISE match an active, open Service Case?"}
    Step2 -->|No Active Cases| T2["Tier 2: NEW UNIQUE SERVICE CASE<br/>(Action: Create New SourceComplaint + New ServiceCase)"]
    Step2 -->|Yes, Active Case Exists| Step3{"Does reported equipment type match active case equipment?"}
    Step3 -->|Different Equipment| T3["Tier 3: DIFFERENT EQUIPMENT FAILURE IN SAME SCHOOL<br/>(Action: Create Distinct Parallel ServiceCase; Zero Collision)"]
    Step3 -->|Same Equipment| Step4{"Is active case older than 48 hours with no engineer visit?"}
    Step4 -->|Yes, Unresolved| T4["Tier 4: SAME UNRESOLVED PHYSICAL ISSUE / CHASER<br/>(Action: Append as Supplementary SourceComplaint to Existing Case)"]
    Step4 -->|No, Case Recently Resolved| T5["Tier 5: REOPENED / POST-SERVICE FAILURE<br/>(Action: Flag for Coordinator Decision: Reopen vs New Ticket)"]
```

### Detailed Duplicate Classification Matrix

| Classification Category | Operational Definition | System Behavior & Action |
|---|---|---|
| **1. Exact Source Duplicate** | Identical `source_system` and `external_ticket_id` already exists in database. | System updates unassigned source metadata (e.g., remarks). **NEVER overwrites assigned engineer, visit notes, or entered diagnostic data.** |
| **2. New Unique Complaint** | Valid school UDISE; no active open cases for this equipment category. | Spawns a new `source_complaints` row and initializes a new `service_cases` row in `UNASSIGNED` state. |
| **3. Different Equipment in Same School** | Same school UDISE, but reported equipment differs (e.g., active case is UPS; new complaint is D-Link Switch). | Spawns an independent parallel `service_cases` row. Both cases exist simultaneously without conflict. |
| **4. Same Unresolved Physical Issue (Chaser)** | Same school, same equipment type, existing case is still in progress (`ASSIGNED` or `PENDING_SPARES`). | New intake is classified as a "Chaser". Linked to the existing `service_case_id` as supplementary intake; avoids duplicate dispatch. |
| **5. Reopened / Post-Service Failure** | Same school and equipment, but prior case was marked `RESOLVED` within the past 7 days. | Flags an alert: `"Potential Recurring Fault"`. Coordinator can choose to reopen the existing case or create a new warranty case. |

---

## 4. Protection Against Accidental Overwrite

When an updated statewide spreadsheet is re-imported (a weekly occurrence in government operations), ZENTRA enforces an **Authoritative Boundary Wall**:

```mermaid
graph LR
    subgraph "External Re-Import"
        Import["Imported Spreadsheet Record"]
    end

    subgraph "ZENTRA Storage Boundary Wall"
        SC["source_complaints Table"]
        SC_Perm["ALLOWED MUTATIONS:<br/>• source_status<br/>• external_ticket_id<br/>• original_remarks<br/>• last_source_sync_timestamp"]
        
        SC_Wall["STRICT PROHIBITION:<br/>Import Engine cannot write to service_cases directly"]
        
        SC -.-> SC_Perm
        SC -.-> SC_Wall
        
        SC_Wall -->|BLOCKED| SC_Prot
        
        subgraph "Protected Field Engineering Ledger"
            SC_Prot["PROTECTED ENTITIES (IMMUTABLE TO IMPORTS):<br/>• assigned_primary_engineer_id<br/>• operational_status<br/>• field_visits (Check-in, GPS, Timestamps)<br/>• on_site_diagnosis & action_taken<br/>• spares_consumed<br/>• evidence_files (Slot 1 & Slot 2 Photos)<br/>• conveyance_claims"]
        end
    end

    Import --> SC
```

> [!CAUTION]
> **IMMUTABILITY DIRECTIVE**:
> Under no circumstances may an import job alter, clear, or overwrite:
> - `assigned_primary_engineer_id` or `assigned_secondary_engineer_id`
> - `field_visits` records (dates, check-in GPS, visit notes)
> - `spares_consumed` records
> - `evidence_files` (Slot 1 HM reports or Slot 2 photos)
> - `conveyance_claims`
> Any software code attempting to overwrite these fields during an import process is considered a critical defect.

---

## 5. OCR & AI Architecture (Advisory-Only Pipeline)

ZENTRA supports optical character recognition (OCR) and machine learning (AI) extraction to accelerate processing of scanned paper service reports and mobile screenshots.

However, ZENTRA enforces a strict governance model:
> **AI is an extraction assistant, NEVER an authoritative writer.**

### Pipeline Architecture

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Administrator
    participant Ingest as Import Engine
    participant S3 as Staging Bucket
    participant OCR as OCR / AI Extraction Worker
    participant DB as Staging Store
    participant Web as ZENTRA Web (Review UI)

    Admin->>Ingest: Uploads Scanned PDF / WhatsApp Screenshot
    Ingest->>S3: Saves raw document
    Ingest->>OCR: Enqueues extraction job
    OCR->>OCR: Runs Textract / Vision API / Multimodal AI
    OCR->>OCR: Extracts fields: UDISE, School, Equipment, Problem
    OCR->>OCR: Computes confidence scores per field (0.00 - 1.00)
    OCR->>DB: Stores in import_staging_records (with raw vs extracted lineage)
    OCR->>Web: Emits event: "Staged Extraction Ready for Review"
    Admin->>Web: Inspects side-by-side: Original Image vs AI Extracted Fields
    Admin->>Web: Corrects low-confidence UDISE code (e.g., changes '3319040050I' to '33190400501')
    Admin->>Web: Clicks "Approve & Commit"
    Web->>DB: Commits record with complete value lineage (raw, ai, human)
```

### Complete Value Lineage Schema
To guarantee institutional auditability, every field extracted via OCR or AI is stored with full provenance:

```json
{
  "field_name": "udise_code",
  "source_document_path": "s3://staging/2026/09/batch_84/scan_042.pdf",
  "raw_ocr_extracted_text": "3319040050I",
  "ocr_confidence_score": 0.78,
  "system_normalized_value": "33190400501",
  "human_reviewed": true,
  "human_corrected_value": "33190400501",
  "reviewed_by_user_id": "usr_coord_ngp_01",
  "reviewed_at": "2026-09-08T10:14:22Z",
  "authoritative_final_value": "33190400501"
}
```

### Architectural Guarantees for AI/OCR
1. **No Direct Production Commits**: AI extraction results are written exclusively to `import_staging_records`.
2. **Confidence-Based Highlighting**: Any field with an extraction confidence score below 0.90 is highlighted in amber/red on the web preview interface.
3. **Auditable Lineage**: The final database record permanently stores both what the AI originally saw and what the human administrator verified or corrected.
4. **Offline Safety**: OCR and AI processing operate strictly server-side in asynchronous background workers; the mobile app is never burdened with heavy local AI models.

---

## 6. Summary of Ingestion Architectural Guarantees

| Ingestion Challenge | Historical Failure Mode | ZENTRA Architectural Defense |
|---|---|---|
| Unmapped or Misspelled Headers | Silent column drop; blank tickets created | Dynamic column mapper with mandatory field verification. |
| Re-import of Same Spreadsheet | Overwrote assigned engineers and notes | Authoritative boundary wall blocks field mutation. |
| Duplicate Complaints | Parallel duplicate tickets; wasted travel | 5-Tier classification links chasers to existing cases. |
| Multi-Equipment School Breakdowns | Erroneously merged into single ticket | Distinct parallel cases created per equipment type. |
| Poor Quality Scans / OCR Errors | Corrupted UDISE codes and school names | Side-by-side human review with confidence scoring. |
| System Failure During Import | Partial, unrecoverable data corruption | All commits executed within atomic database transactions. |
