# Project Roadmap

Version: 0.1
Last updated: 2026-07-08

## Goal

Deliver the Opportunity Discovery Engine in thin, testable layers so each stage can be validated before the next one is added.

## Guiding Principles

- build the smallest vertical slice first
- keep business logic behind interfaces
- make collectors and normalizers source-specific but replaceable
- store only durable or expensive-to-recompute data
- keep the LLM out of discovery logic

## Phase 1 - Foundation

Deliverables:

- repository structure aligned with the pipeline
- shared domain models and interfaces
- config, logging, and error-handling conventions
- test harness and fixture strategy
- database abstraction through repository interfaces

Exit criteria:

- core contracts compile cleanly
- tests can run against mocked infrastructure
- no business logic depends on concrete storage or LLM providers

## Phase 2 - Collector Layer

Deliverables:

- collector interface
- collector registry
- source-specific collector implementations
- request retries and basic rate-limit protection
- fixture-backed tests for collector behavior

Recommended first collector:

- Google Autocomplete, because it is free, lightweight, and validates the collector contract without requiring heavy infrastructure

Alternative first collectors:

- Google Trends
- Reddit public data

Exit criteria:

- one collector can fetch raw data end-to-end
- raw payloads are captured in a source-specific shape
- the collector layer is isolated from normalization and ranking

## Phase 3 - Normalization Layer

Deliverables:

- normalized content model
- normalizer interface
- one normalizer per source
- deduplication and canonical field mapping

Exit criteria:

- raw payloads can be transformed into a source-agnostic representation
- downstream layers consume normalized content only

## Phase 4 - Feature Extraction

Deliverables:

- engagement, velocity, freshness, and momentum calculators
- feature extraction pipeline
- deterministic metrics derived from normalized content

Exit criteria:

- features are computed without external API calls
- feature output is repeatable for the same input data

## Phase 5 - Detection Engines

Deliverables:

- gap detection rules
- trend detection rules
- scoring inputs for each detected opportunity

Exit criteria:

- the system can identify candidate gaps and trends from the feature set
- detection is deterministic and explainable

## Phase 6 - Ranking

Deliverables:

- ranking engine
- score normalization
- deduplication of overlapping opportunities

Exit criteria:

- the best opportunities can be ordered consistently
- ranking depends on scores and evidence, not on the LLM

## Phase 7 - Persistence

Deliverables:

- analysis run persistence
- content and observation storage
- opportunity storage
- historical lookup APIs through repositories

Exit criteria:

- analyses can be replayed or inspected later
- expensive raw collection does not need to run again for every request

## Phase 8 - Orchestration And Workers

Deliverables:

- pipeline orchestrator
- background job execution
- retry and failure tracking
- scheduled refresh support

Exit criteria:

- the full analysis pipeline can run asynchronously
- long-running jobs do not block the request path

## Phase 9 - Summarization And Export

Deliverables:

- LLM summarization layer
- structured JSON output
- export formats such as CSV, XLS, and PDF

Exit criteria:

- the LLM explains findings rather than inventing them
- outputs are ready for downstream consumption and reporting

## Phase 10 - API And Productization

Deliverables:

- user-facing API endpoints
- validation and response contracts
- authentication and authorization if needed
- operational monitoring and alerts

Exit criteria:

- the system is usable as a product, not just a pipeline

## Immediate Next Steps

1. finalize the canonical domain terms for v1
2. define the collector contract and raw content shape
3. implement one free collector
4. add unit tests around the collector boundary
5. decide whether MongoDB will store raw payloads only or also the normalized domain objects

## Notes

This roadmap is intentionally layer-first. The orchestration layer comes later because it should coordinate stable stages, not define them.



---
## Todo
1. The topics that we extract from LLM should be passed through autocomplete filter 