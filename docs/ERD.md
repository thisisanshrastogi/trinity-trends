## Database Design

Version 0.1

---

# 1. Philosophy

The database stores business entities.

The database does not store temporary pipeline state.

Intermediate computations should be regenerated whenever possible.

Only information that is expensive to recollect or valuable historically should be persisted.

---

# 2. Storage Categories

Permanent

- Topics
    
- Analysis Runs
    
- Queries
    
- Normalized Content
    
- Opportunities
    

Cache

- Raw Platform Responses
    
- LLM Responses
    
- Search Results
    

Computed

- Features
    
- Gap Scores
    
- Trend Scores
    
- Rankings
    

---

# 3. Entity Relationship Diagram

```
                 Topic
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
 Analysis Run            Normalized Content
        │                     │
        ▼                     ▼
     Query              Metric Snapshot
        │
        ▼
  Opportunity
```

---

# 4. Tables

---

## Topics

Represents canonical topics.

Fields

id

canonical_name

aliases (JSONB)

category

created_at

updated_at

last_analysis_at

---

## Analysis Runs

Represents one pipeline execution.

Fields

id

topic_id

input

status

started_at

completed_at

duration_ms

sources_used (JSONB)

warnings (JSONB)

errors (JSONB)

---

## Queries

Represents expanded search queries.

Fields

id

run_id

query

source

confidence

---

## Normalized Content

Represents platform-independent content.

Fields

id

topic_id

platform

external_id

title

description

url

author

published_at

views

likes

comments

shares

engagement_rate

raw_payload (JSONB)

created_at

---

## Opportunities

Represents final recommendations.

Fields

id

run_id

type

title

platform

format

score

confidence

reason

suggested_content

suggested_hook

questions (JSONB)

evidence (JSONB)

created_at

---

## Metric Snapshots

Historical measurements.

Fields

id

content_id

captured_at

views

likes

comments

shares

engagement_rate

velocity

momentum

---

# 5. Relationships

Topic

1

↓

Many

Analysis Runs

Topic

1

↓

Many

Normalized Content

Analysis Run

1

↓

Many

Queries

Analysis Run

1

↓

Many

Opportunities

Normalized Content

1

↓

Many

Metric Snapshots

---

# 6. JSONB Usage

JSONB is used only for data that varies significantly between platforms.

Examples

aliases

warnings

errors

sources_used

raw_payload

questions

evidence

Structured business fields remain relational.

---

# 7. Indexes

Topics

canonical_name

Analysis Runs

topic_id

completed_at

Queries

query

run_id

Normalized Content

topic_id

platform

published_at

Opportunities

run_id

score

type

Metric Snapshots

content_id

captured_at

---

# 8. Data Retention

Permanent

Topics

Runs

Normalized Content

Opportunities

Snapshots

Temporary

Raw platform payloads may be removed after configurable retention.

Cache entries expire automatically.

---

# 9. Versioning

Pipeline version

Scoring version

Prompt version

should be recorded inside Analysis Runs.

This allows historical analyses to be reproduced.

---

# 10. Future Extensions

Additional platforms require no schema modifications.

Platform-specific information should remain inside JSONB payloads while normalized fields remain stable.