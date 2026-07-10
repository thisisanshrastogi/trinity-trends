# Current Design

Version: 0.1
Last updated: 2026-07-08

## Purpose

This document captures the latest agreed design context for the Opportunity Discovery Engine. It is intentionally living documentation and should be updated whenever the architecture changes.

## Current Understanding Of The Product

The system helps content creators discover high-value content opportunities by analyzing public platform data across search, discussion, and media sources.

The core outputs are:

- content gaps
- emerging trends
- ranked opportunities
- structured JSON for downstream use

The LLM is a summarization and presentation layer only. It must not be the source of truth for discovery.

## Current Architectural Direction

The project is being built as a modular monolith with a pipeline-based analysis flow.

Proposed flow:

Input
-> Query Expansion
-> Collection
-> Normalization
-> Feature Extraction
-> Gap Detection
-> Trend Detection
-> Ranking
-> Summarization
-> Persistence

The important design rule is that each layer owns one responsibility and communicates through interfaces.

## Layering Strategy

We will develop the system layer by layer rather than starting with the orchestrator.

Recommended order:

1. shared contracts and domain models
2. collector layer
3. normalization layer
4. feature extraction
5. detection engines
6. ranking
7. persistence
8. orchestration and workers
9. API and exports

This keeps the first implementation slice narrow and testable.

## Collector Layer Decision

The first concrete implementation should be a free or public data source so the pipeline can be validated without paid APIs or complex credentials.

Good first candidates are:

- Google Autocomplete
- Google Trends
- Reddit public endpoints

The collector layer should expose a stable interface and hide source-specific details behind collectors and a registry.

## Data Model Direction

The current docs describe a topic-centered system, but the long-term model should remain flexible enough to support entity-centric analysis later.

Current working assumption:

- Topic is the canonical analysis entry point for v1
- Query expansion may reference multiple entities
- Content should be normalized across platforms
- Metrics should be stored as observations or snapshots when they change over time

This is important because engagement metrics are temporal data, not static content attributes.

## Database Direction

MongoDB is acceptable as the initial database if the goal is to move quickly with document-shaped pipeline data.

Why it fits v1:

- analysis runs, raw responses, normalized payloads, and opportunity documents are naturally document-like
- schema evolution is likely during early iteration
- an ORM/repository abstraction can hide the database choice and preserve migration options

Trade-off:

- MongoDB is less convenient than a relational database for complex joins, ad hoc analytics, and strict relational integrity
- if reporting and historical analysis become the center of the product, the persistence layer must stay narrow so migration remains realistic

Recommendation:

- keep the persistence API repository-based
- avoid leaking MongoDB-specific queries into business logic
- model temporal metrics as separate snapshots/observations rather than overwriting content records

## Open Questions

- Should the first free collector be Google Autocomplete, Google Trends, or Reddit?
- Should the canonical domain term remain Topic, or should we rename it to Entity in a later iteration?
- Do we want MongoDB collections for both normalized content and metric snapshots, or a more explicit event/observation model from the start?
- Should orchestration be synchronous for v1, or should the first release already assume queued background execution?

## Near-Term Goal

Build the collector layer first, with a single public/free collector and stable interfaces that the later pipeline layers can consume without redesign.
