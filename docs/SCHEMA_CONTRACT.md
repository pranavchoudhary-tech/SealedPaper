# SealedPaper — Database Schema Contract for Backend (Anant)
**Author:** Pranav Choudhary (`pranavchoudhary-tech`)  
**Lead:** Database (PostgreSQL)  
**Consumer:** Anant (Backend / Express API) & Sarija (Frontend / Models)

This document specifies the exact database schema contract for SealedPaper across all 29 tables, custom enum types, foreign key relationships, stored functions, and analytical views.

---

## 1. Custom Enum Types

```sql
user_role            : 'admin', 'setter', 'custodian', 'superintendent', 'investigator'
user_status          : 'pending', 'active', 'disabled'
face_purpose         : 'enroll', 'login', 'unlock'
document_status      : 'sealed', 'released', 'revoked'
document_category    : 'research', 'financial', 'board', 'legal', 'executive', 'other'
paper_status         : 'draft', 'questions_ready', 'sealed', 'unlocked', 'released'
blueprint_difficulty : 'easy', 'medium', 'hard'
reprint_status       : 'pending', 'approved', 'rejected'
leak_phase           : 'pre_release', 'post_release'
leak_target_kind     : 'paper', 'document'
```

---

## 2. Table Schemas by Module

### Module 1: Accounts, Authentication & Audit

#### `users`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key, `DEFAULT gen_random_uuid()` |
| `name` | `text` | `NOT NULL`, `CHECK (length(trim(name)) BETWEEN 2 AND 100)` |
| `email` | `text` | `NOT NULL`, lowercase, unique index |
| `password_hash` | `text` | `NOT NULL` (Argon2id hash) |
| `role` | `user_role` | `NOT NULL`, default `'custodian'` |
| `status` | `user_status` | `NOT NULL`, default `'pending'` |
| `totp_secret_enc` | `bytea` | Encrypted with server master key |
| `totp_enabled` | `boolean` | `NOT NULL`, default `false` |
| `totp_last_step` | `bigint` | Replay protection timestamp counter |
| `created_at` | `timestamptz` | `NOT NULL`, default `now()` |

#### `sessions`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `user_id` | `uuid` | FK $\to$ `users(id) ON DELETE CASCADE` |
| `refresh_hash` | `bytea` | SHA-256 of refresh token |
| `user_agent` | `text` | Client UA |
| `ip` | `inet` | Client IP address |
| `created_at` | `timestamptz` | default `now()` |
| `expires_at` | `timestamptz` | `NOT NULL` |
| `revoked_at` | `timestamptz` | `NULL` until logged out |

#### `face_templates`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `user_id` | `uuid` | Primary Key, FK $\to$ `users(id) ON DELETE CASCADE` |
| `descriptor_enc` | `bytea` | `NOT NULL`, 128 floats, AES-GCM encrypted |
| `model` | `text` | `NOT NULL DEFAULT 'face-api faceRecognitionNet'` |
| `enrolled_at` | `timestamptz` | `NOT NULL`, default `now()` |

#### `face_challenges`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `user_id` | `uuid` | `NULLABLE`, FK $\to$ `users(id) ON DELETE CASCADE` |
| `purpose` | `face_purpose` | `NOT NULL` (`enroll`, `login`, `unlock`) |
| `poses` | `text[]` | `NOT NULL`, e.g. `['straight', 'left', 'right']` |
| `expires_at` | `timestamptz` | `NOT NULL` |
| `used_at` | `timestamptz` | Single-use challenge |

#### `face_checks`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `challenge_id` | `uuid` | FK $\to$ `face_challenges(id)` |
| `user_id` | `uuid` | FK $\to$ `users(id)` |
| `purpose` | `face_purpose` | `NOT NULL` |
| `liveness_score` | `numeric(4,3)` | Score 0.000 to 1.000 |
| `match_score` | `numeric(4,3)` | Distance / similarity score |
| `passed` | `boolean` | `NOT NULL` |
| `ip` | `inet` | Client IP |
| `created_at` | `timestamptz` | default `now()` (Append-only) |

#### `audit_log`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `actor_id` | `uuid` | `NULLABLE`, FK $\to$ `users(id)` |
| `action` | `text` | `NOT NULL` (e.g. `'paper.seal'`, `'share.submit'`) |
| `entity` | `text` | `NOT NULL` |
| `entity_id` | `text` | `NOT NULL` |
| `payload` | `jsonb` | Event metadata |
| `ip` | `inet` | Request IP |
| `created_at` | `timestamptz` | default `now()` |
| `prev_hash` | `bytea` | Cryptographic pointer to previous row |
| `row_hash` | `bytea` | `sha256(prev_hash \|\| row contents)` |

---

### Module 2: Key Vault & Confidential Documents

#### `documents`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `title` | `text` | `NOT NULL` |
| `category` | `document_category` | default `'other'` |
| `original_name`| `text` | `NOT NULL` |
| `mime_type` | `text` | `NOT NULL` |
| `size_bytes` | `bigint` | `NOT NULL` |
| `threshold_k` | `integer` | `NOT NULL, CHECK (threshold_k BETWEEN 2 AND total_shares_n)` |
| `total_shares_n`| `integer` | `NOT NULL, CHECK (total_shares_n >= 2)` |
| `max_copies_per_reader` | `integer` | `NOT NULL DEFAULT 1` |
| `unlock_at` | `timestamptz` | `NOT NULL` (Time-lock timestamp) |
| `status` | `document_status` | `NOT NULL DEFAULT 'sealed'` |
| `created_by` | `uuid` | FK $\to$ `users(id)` |
| `created_at` | `timestamptz` | default `now()` |

#### `key_shares`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `document_id` | `uuid` | FK $\to$ `documents(id) ON DELETE CASCADE` |
| `custodian_id` | `uuid` | FK $\to$ `users(id)` |
| `share_index` | `integer` | Shamir $x$-coordinate |
| `share_hash` | `bytea` | SHA-256 of the Shamir share (immutable) |
| `pickup_enc` | `bytea` | Single-use encrypted share file |
| `collected_at` | `timestamptz` | Set upon first download |

#### `share_submissions`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `document_id` | `uuid` | FK $\to$ `documents(id)` |
| `custodian_id` | `uuid` | FK $\to$ `users(id)` |
| `share_index` | `integer` | `NOT NULL` |
| `submitted_at` | `timestamptz` | default `now()` |

#### `document_copies`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `document_id` | `uuid` | FK $\to$ `documents(id)` |
| `reader_id` | `uuid` | FK $\to$ `users(id)` |
| `copy_code` | `text` | `NOT NULL UNIQUE` (e.g. `RES-0001-62QJ`) |
| `issued_at` | `timestamptz` | default `now()` |
| `ip` | `inet` | Reader IP |

---

### Module 3: Exam Papers Pipeline

#### `exams`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `name` | `text` | `NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 3 AND 120)` |
| `created_by` | `uuid` | FK $\to$ `users(id)` |
| `created_at` | `timestamptz` | default `now()` |

#### `centres`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `code` | `text` | `NOT NULL UNIQUE` (e.g. `'DEL01'`, `'PUN02'`) |
| `name` | `text` | `NOT NULL` |
| `city` | `text` | `NOT NULL` |

#### `papers`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `exam_id` | `uuid` | FK $\to$ `exams(id)` |
| `title` | `text` | `NOT NULL` |
| `subject` | `text` | `NOT NULL` |
| `duration_minutes` | `integer` | `NOT NULL` |
| `seal_deadline` | `timestamptz` | `NOT NULL` |
| `unlock_at` | `timestamptz` | `NOT NULL CHECK (unlock_at >= seal_deadline)` |
| `exam_start_at` | `timestamptz` | `NOT NULL CHECK (exam_start_at >= unlock_at)` |
| `status` | `paper_status` | default `'draft'` |
| `threshold_k` | `integer` | default 2 |
| `total_shares_n`| `integer` | default 3 |
| `data_key_wrapped` | `bytea` | `NULL` once sealed and deleted |
| `created_by` | `uuid` | FK $\to$ `users(id)` |

#### `blueprint_items`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `paper_id` | `uuid` | FK $\to$ `papers(id) ON DELETE CASCADE` |
| `topic` | `text` | `NOT NULL` |
| `difficulty` | `blueprint_difficulty` | `'easy'`, `'medium'`, `'hard'` |
| `required_count` | `integer` | Number of questions needed |
| `marks_per_question` | `integer` | Marks weightage |
| `position` | `integer` | Order in paper |

#### `questions`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `paper_id` | `uuid` | FK $\to$ `papers(id)` |
| `setter_id` | `uuid` | FK $\to$ `users(id)` |
| `blueprint_item_id` | `uuid` | FK $\to$ `blueprint_items(id)` |
| `topic` | `text` | Matched with blueprint |
| `difficulty` | `blueprint_difficulty` | Matched with blueprint |
| `body_enc` | `bytea` | AES-256-GCM encrypted question text |
| `body_hmac` | `text` | Blind HMAC for deduplication & leak matching |
| `answer_enc` | `bytea` | Encrypted answer key |
| `is_burned` | `boolean` | `NOT NULL DEFAULT false` (Leaked question flag) |
| `burned_at` | `timestamptz` | Timestamp if burned |

#### `paper_centres`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `paper_id` | `uuid` | Composite PK, FK $\to$ `papers(id)` |
| `centre_id` | `uuid` | Composite PK, FK $\to$ `centres(id)` |
| `superintendent_id`| `uuid` | FK $\to$ `users(id)` |
| `candidate_count`| `integer` | `NOT NULL CHECK (candidate_count > 0)` |
| `spare_count` | `integer` | `NOT NULL DEFAULT 1 CHECK (spare_count >= 0)` |

#### `variants`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `paper_id` | `uuid` | FK $\to$ `papers(id)` |
| `centre_id` | `uuid` | FK $\to$ `centres(id)` |
| `question_order` | `jsonb` | Centre-specific shuffle permutation |

#### `printed_copies`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `variant_id` | `uuid` | FK $\to$ `variants(id)` |
| `printed_by` | `uuid` | FK $\to$ `users(id)` (Superintendent) |
| `copy_code` | `text` | Unique printed serial |
| `copy_number` | `integer` | Sequential copy index |
| `is_void` | `boolean` | `DEFAULT false` (marked void if spoiled) |
| `printed_at` | `timestamptz` | default `now()` |

#### `reprint_requests`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `copy_id` | `uuid` | FK $\to$ `printed_copies(id)` (Spoiled copy) |
| `requested_by` | `uuid` | FK $\to$ `users(id)` (Superintendent) |
| `reason` | `text` | Reason for reprint |
| `status` | `reprint_status` | default `'pending'` |
| `decided_by` | `uuid` | FK $\to$ `users(id)` (`CHECK decided_by != requested_by`) |
| `decided_at` | `timestamptz` | Decision timestamp |

---

### Module 4: Leak Tracing & Forensics

#### `leak_reports`
| Column | Type | Constraints / Description |
|:---|:---|:---|
| `id` | `uuid` | Primary Key |
| `reported_by` | `uuid` | FK $\to$ `users(id)` |
| `paper_id` | `uuid` | `NULLABLE`, FK $\to$ `papers(id)` |
| `document_id` | `uuid` | `NULLABLE`, FK $\to$ `documents(id)` |
| `raw_text` | `text` | Leaked snippet / OCR text |
| `matched_variant_id` | `uuid` | Identified exam variant |
| `matched_copy_id` | `uuid` | Identified printed copy |
| `confidence` | `numeric(3,2)` | Match confidence (0.0 to 1.0) |
| `created_at` | `timestamptz` | default `now()` |

---

## 3. Stored Functions Available to Backend

1. **`verify_audit_chain()`**
   - Returns: `TABLE(valid boolean, broken_at_id uuid, broken_index bigint, error_reason text)`
   - Usage: Called by `GET /api/audit/verify` to validate audit log cryptographic integrity.

2. **`draw_final_questions(p_paper_id uuid)`**
   - Draws random questions matching the paper blueprint, skipping any question where `is_burned = true`.
   - Populates table `final_questions`.

3. **`custodian_locked_out(p_document_id uuid, p_custodian_id uuid, p_window interval, p_max_attempts int)`**
   - Returns: `boolean`
   - Usage: Rate-limits bad key uploads to prevent brute-force attacks on Shamir shares.

---

## 4. Analytical Views

1. `unlock_status`: Current submitted key count vs $k$ threshold per document/paper.
2. `suspicious_key_attempts`: Failed submissions grouped by custodian and IP.
3. `face_failure_report`: Biometric audit logs with failure rates.
4. `pool_coverage`: Count of pool questions vs required blueprint items.
5. `centre_readiness`: Centre print status, candidate counts, and completed print runs.
6. `setter_leak_report`: Traceable setter attribution for leaked questions.
7. `centre_reprint_rates`: Forensic analysis of reprint ratios per exam centre.
8. `reader_copy_report`: Traced copies downloaded per reader vs permitted limits.
