# SealedPaper — Database Architecture & Viva Defense Guide
**Author:** Pranav Choudhary (`pranavchoudhary-tech`)  
**Role:** Database Lead (PostgreSQL Schema, Security Triggers, DCL, Normalisation, Viva Checks)  
**System:** SealedPaper Confidential Document & Exam Security Platform

---

## 1. Executive Summary

In high-stakes environments (national examinations, confidential board resolutions, clinical trial findings, regulatory filings), application-level security alone is insufficient. If the application server is compromised, misconfigured, or has an unauthenticated route injection, application checks can be bypassed.

In **SealedPaper**, the **PostgreSQL database engine acts as the ultimate authority and last line of defense**. The database enforces mathematical and physical invariants through:
- **29 Tables** strictly normalised to **Boyce-Codd Normal Form (BCNF)**.
- **23 Triggers** that enforce physical print caps, quorum authorization, time locks, and question freeze rules.
- **Append-only cryptographic hash chain** (`SHA-256`) on the audit log.
- **Role-Based DCL (Data Control Language)** separating runtime application privileges from audit inspection and database administration.
- **33 Automated assertion checks** (`server/sql/viva_checks.sql`) proving that direct raw SQL cannot violate security policies.

---

## 2. Relational Schema & Normalisation (1NF $\to$ BCNF)

The schema spans 29 tables across four core functional domains:
1. **Accounts, Authentication & Audit** (`users`, `sessions`, `face_templates`, `face_challenges`, `face_checks`, `audit_log`)
2. **Key Vault & Quorum Management** (`documents`, `document_blobs`, `key_shares`, `document_recipients`, `share_submissions`, `pending_shares`, `releases`, `downloads`)
3. **Exam Blueprint & Question Pool Pipeline** (`exams`, `centres`, `papers`, `paper_setters`, `paper_custodians`, `blueprint_items`, `questions`, `paper_centres`, `final_questions`, `variants`)
4. **Physical Printing, Reprints & Leak Tracing** (`printed_copies`, `reprint_requests`, `leak_reports`, `leak_matches`, `document_copies`)

### Normalisation Analysis

Every table in SealedPaper satisfies **Boyce-Codd Normal Form (BCNF)**:

#### First Normal Form (1NF)
- **Atomic Attributes**: No composite or repeating groups. Every column contains atomic values.
  - Multi-factor face encodings are stored in dedicated scalar vectors (`face_templates.template bytea`), not comma-separated lists.
  - Key shares are normalised into individual rows (`key_shares`), with one share per custodian per document.
- **Defined Primary Keys**: Every table has a distinct single-column UUID primary key (or an explicit composite primary key for associative bridge tables).

#### Second Normal Form (2NF)
- A table is in 2NF if it is in 1NF and every non-prime attribute is **fully functionally dependent** on the primary key (no partial dependencies on a composite candidate key).
- In bridge tables with composite primary keys (e.g. `paper_custodians(paper_id, custodian_id)` or `final_questions(paper_id, question_id)`):
  - There are no partial attributes. Associative tables only link foreign keys or record metadata that depends on the entire pair (e.g., `share_submissions(document_id, custodian_id)` with `submitted_at`).

#### Third Normal Form (3NF)
- A table is in 3NF if it is in 2NF and **no non-prime attribute is transitively dependent** on any candidate key ($X \to Y \to Z$).
- Example of 3NF enforcement:
  - In `variants(id, paper_id, centre_id)` and `printed_copies(id, variant_id, printed_by, copy_code)`:
    - We do not store `centre_id` directly inside `printed_copies`. Storing `centre_id` inside `printed_copies` would create a transitive dependency (`copy_id \to variant_id \to centre_id`).
    - The centre is resolved strictly through the `variant_id` relationship.

#### Boyce-Codd Normal Form (BCNF)
- A relation $R$ is in BCNF if and only if for every non-trivial functional dependency $X \to Y$, $X$ is a **superkey**.
- In SealedPaper:
  - In `key_shares(document_id, custodian_id, share_index, share_hash)`:
    - Candidate keys are `(document_id, custodian_id)` and `(document_id, share_index)`.
    - Both determinants are candidate keys. There are no dependencies where a non-key determines part of a key.
  - In `questions(id, paper_id, setter_id, blueprint_item_id, body_enc, body_hmac)`:
    - Candidate keys: `id` and `(paper_id, body_hmac)`.
    - `body_hmac` provides cryptographic deduplication; each HMAC is unique within a paper. Both determinants are candidate keys.
  - Hence, all functional dependencies satisfy the BCNF condition: every determinant is a superkey.

---

## 3. The 23 Database Triggers (Defense-in-Depth)

The triggers are organised into 5 functional security clusters:

| # | Trigger Name | Table | Event | Security Invariant Enforced |
|---|:---|:---|:---|:---|
| **1** | `audit_chain_ins` | `audit_log` | `BEFORE INSERT` | Computes SHA-256 hash chaining: `sha256(prev_hash \|\| payload)`. |
| **2** | `audit_no_edit` | `audit_log` | `BEFORE UPDATE OR DELETE` | Complete immutability of audit logs. |
| **3** | `audit_no_truncate` | `audit_log` | `BEFORE TRUNCATE` | Prevents flushing audit logs via `TRUNCATE`. |
| **4** | `share_submissions_no_edit` | `share_submissions` | `BEFORE UPDATE OR DELETE` | Prevents modifying or withdrawing submitted Shamir key shares. |
| **5** | `face_checks_no_edit` | `face_checks` | `BEFORE UPDATE OR DELETE` | Prevents tampering with biometric verification history. |
| **6** | `documents_guard_upd` | `documents` | `BEFORE UPDATE` | Enforces state transition rules, threshold $k \le n$, and prevents moving unlock time earlier once sealed. |
| **7** | `key_shares_guard_upd` | `key_shares` | `BEFORE UPDATE` | Makes `share_hash` and recipient immutable once provisioned. |
| **8** | `pending_shares_guard_ins` | `pending_shares` | `BEFORE INSERT` | Blocks unauthorized third parties from submitting key shares. |
| **9** | `releases_require_released` | `releases` | `BEFORE INSERT` | Ensures a release record cannot be created unless document status is `released`. |
| **10** | `downloads_require_released` | `downloads` | `BEFORE INSERT` | Prohibits raw file download while document remains `sealed`. |
| **11** | `users_activation_guard_upd` | `users` | `BEFORE UPDATE OF status`| Blocks user activation until both face template and TOTP are fully enrolled. |
| **12** | `papers_guard_upd` | `papers` | `BEFORE UPDATE` | Enforces lifecycle transitions (`draft` $\to$ `questions_ready` $\to$ `sealed` $\to$ `unlocked` $\to$ `released`). |
| **13** | `questions_guard_all` | `questions` | `BEFORE INSERT/UPDATE/DELETE` | Freezes question modifications once paper enters `sealed` state. |
| **14** | `blueprint_frozen` | `blueprint_items` | `BEFORE INSERT/UPDATE/DELETE` | Disallows changing topic/difficulty distribution after paper sealing. |
| **15** | `setters_frozen` | `paper_setters` | `BEFORE INSERT/UPDATE/DELETE` | Freezes assigned setters after paper sealing. |
| **16** | `custodians_frozen` | `paper_custodians` | `BEFORE INSERT/UPDATE/DELETE` | Locks custodian quorum after paper sealing. |
| **17** | `centres_frozen` | `paper_centres` | `BEFORE INSERT/UPDATE/DELETE` | Locks candidate allocations and centres after sealing. |
| **18** | `printed_copies_cap` | `printed_copies` | `BEFORE INSERT` | Rejects prints exceeding centre candidate count + approved spare quota. |
| **19** | `printed_copies_no_edit` | `printed_copies` | `BEFORE UPDATE OR DELETE` | Printed exam copy records are permanent legal evidence; no deletions allowed. |
| **20** | `leak_reports_no_edit` | `leak_reports` | `BEFORE UPDATE OR DELETE` | Protects integrity of whistleblower and leak forensic records. |
| **21** | `documents_settings_frozen_upd`| `documents` | `BEFORE UPDATE` | Prohibits altering recipient list or permissions after sealing. |
| **22** | `document_copies_guard` | `document_copies` | `BEFORE INSERT` | Enforces per-reader download limits and prevents copies of sealed documents. |
| **23** | `document_copies_no_edit` | `document_copies` | `BEFORE UPDATE OR DELETE` | Prevents deletion or modification of traced confidential copies. |

---

## 4. Cryptographic Hash Chain on `audit_log`

To prevent audit tampering, the `audit_log` uses an append-only cryptographic hash chain modeled after blockchain block headers:

```
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│ Row N-1                         │       │ Row N                           │
│ id: uuid                        │       │ id: uuid                        │
│ action: 'paper.seal'            │       │ action: 'share.submit'          │
│ ...                             │       │ ...                             │
│ hash: 0x9b3a...                 │──────▶│ prev_hash: 0x9b3a...            │
└─────────────────────────────────┘       │ hash: sha256(prev_hash || row)  │
                                          └─────────────────────────────────┘
```

### Hash Calculation Implementation
Inside `server/migrations/002_triggers.sql`:
```sql
CREATE FUNCTION audit_row_hash(p_id uuid, p_actor_id uuid, p_action text,
                               p_entity text, p_entity_id text,
                               p_created_at timestamptz, p_prev_hash bytea)
RETURNS bytea LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    RETURN digest(
        coalesce(p_id::text, '') || '|' ||
        coalesce(p_actor_id::text, '') || '|' ||
        coalesce(p_action, '') || '|' ||
        coalesce(p_entity, '') || '|' ||
        coalesce(p_entity_id, '') || '|' ||
        to_char(p_created_at, 'YYYY-MM-DD"T"HH24:MI:SS.USOF') || '|' ||
        coalesce(encode(p_prev_hash, 'hex'), ''),
        'sha256'
    );
END $$;
```
If an adversary directly alters row $N-1$ in the database:
- The pre-computed `hash` in row $N-1$ will no longer match its contents.
- The `prev_hash` of row $N$ will point to the old hash, invalidating the entire subsequent chain.
- The stored function `verify_audit_chain()` iterates over every record in sequence and raises an alert upon detecting the first invalid link.

---

## 5. Advanced Constraints & DCL Least-Privilege

### Composite Foreign Keys
We enforce strict multi-tenant boundaries using composite foreign keys:
- A question can only be submitted by a setter who was assigned to that specific paper:
  ```sql
  FOREIGN KEY (paper_id, setter_id) REFERENCES paper_setters(paper_id, setter_id)
  ```
- A question must map to an existing blueprint cell in the exact same paper:
  ```sql
  FOREIGN KEY (paper_id, blueprint_item_id) REFERENCES blueprint_items(paper_id, id)
  ```
- This guarantees that an authenticated setter cannot inadvertently or maliciously insert a question into an unrelated paper.

### Partial Indexes
Used for fast lookups without wasting index storage on terminal states:
- Active sessions:
  ```sql
  CREATE INDEX idx_sessions_active ON sessions(user_id) WHERE revoked_at IS NULL;
  ```
- Pending reprint authorizations:
  ```sql
  CREATE INDEX idx_reprints_pending ON reprint_requests(paper_id) WHERE status = 'pending';
  ```

### Data Control Language (DCL)
In `004_dcl.sql`, runtime permissions are partitioned:
1. `sealed_app`: Application user running Express.
   - `INSERT, SELECT, UPDATE` on domain tables.
   - `INSERT, SELECT` on `audit_log` (NO `UPDATE`, NO `DELETE`, NO `TRUNCATE`).
2. `sealed_auditor`: Read-only compliance auditor role.
   - `SELECT` on `audit_log`, `v_copy_leak_report`, `v_centre_readiness`.
   - Cannot view raw passwords or encrypted key shares.

---

## 6. The 33 Viva Assertion Checks

The test suite in `server/sql/viva_checks.sql` validates that the database itself refuses illegal operations, even when executed directly via `psql`.

All tests run in an isolated `BEGIN ... ROLLBACK` block so the database remains pristine:

1. **Threshold sanity**: Rejects $k < 2$ and $k > n$.
2. **Time-Lock**: Rejects paper release before `unlock_at`.
3. **Quorum verification**: Rejects release when submitted shares $< k$.
4. **Schedule immutability**: Rejects moving `unlock_at` earlier once sealed.
5. **Key immutability**: Rejects modifying `share_hash`.
6. **Access boundary**: Rejects key submissions from unassigned users.
7. **Document secrecy**: Rejects reading/downloading documents in `sealed` status.
8. **Enrolment constraint**: Rejects activating users missing face template or TOTP.
9. **Audit immutability**: Rejects `UPDATE` or `DELETE` on `audit_log`.
10. **Audit verification**: Confirms `verify_audit_chain()` returns `(true, ...)`.
11. **Idempotent release**: Rejects releasing an already-released document a second time.
12. **Timeline integrity**: Rejects setting paper unlock before seal deadline.
13. **Setter assignment**: Rejects question insertions from unassigned setters.
14. **Blueprint alignment**: Rejects questions outside defined blueprint cells.
15. **Question deduplication**: Rejects duplicate question submissions (matching HMAC).
16. **Key disposal**: Rejects sealing paper while server master key is still present.
17. **Question freeze**: Rejects question edits/deletes after sealing.
18. **Blueprint freeze**: Rejects blueprint alterations after sealing.
19. **Paper Quorum release**: Rejects paper release before key threshold is met.
20. **Centre print cap**: Rejects generating copies beyond centre candidates + spares.
21. **Four-Eyes principle**: Rejects reprint approval by the requester.
22. **Evidence immutability**: Rejects deletion of `printed_copies`.
23. **Confidential download limit**: Rejects 3rd download when reader cap is 2.
24. **Leak attribution**: Rejects leak reports targeting both an exam paper and a document simultaneously.

---

## 7. Sample Examiner Questions & Model Answers

### Q1: "Why use triggers instead of putting these checks in Anant's Express routes?"
> **Answer:** "Defense-in-depth. Express API middleware is a software layer subject to route bugs, misconfigured permissions, or direct database access by a rogue DBA. By baking quorum rules, print caps, and question freezes directly into PostgreSQL triggers and constraints, we guarantee that the database enforces business and security invariants regardless of how the SQL statement is submitted."

### Q2: "Why is the audit log modeled with a hash chain instead of just using PostgreSQL WAL or pg_audit?"
> **Answer:** "pg_audit tracks database-level queries, but does not provide an application-level, mathematically verifiable cryptographic proof of tamper-resistance. Our `audit_log` calculates `sha256(prev_hash || row_payload)`. If any row is modified or deleted, the cryptographic hash of all subsequent rows becomes invalid, allowing `verify_audit_chain()` to prove whether the audit trail has been altered."

### Q3: "How does the schema prevent a compromised exam centre from overprinting question papers?"
> **Answer:** "Table `paper_centres` sets an immutable quota `(candidate_count + spare_count)`. The trigger `printed_copies_cap` executes `BEFORE INSERT ON printed_copies`. It counts the existing copies for that variant and raises an exception if `current_count >= max_allowed`. Reprints require a distinct `reprint_request` approved by a controller (implementing four-eyes authorization)."
