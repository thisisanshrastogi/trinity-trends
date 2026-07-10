## High-Level Architecture

Version 0.1

---

# 1. Overview

The Opportunity Discovery Engine is designed as a modular pipeline-based system.

Each subsystem performs exactly one responsibility and communicates through well-defined interfaces.

The system follows:

- Modular Monolith Architecture
    
- Pipeline Processing
    
- Event-driven Background Jobs
    
- Dependency Inversion
    
- Interface-first Design
    

The system is intentionally designed so individual modules can later be extracted into independent services if required.

---

# 2. Architectural Principles

## Principle 1 — Separation of Responsibilities

Each module solves one problem only.

Examples:

- Query Expansion expands queries.
    
- Collectors collect data.
    
- Gap Engine finds gaps.
    
- Trend Engine finds trends.
    

No module should perform responsibilities outside its domain.

---

## Principle 2 — Pipeline Processing

Every analysis follows the same ordered pipeline.

Input

↓

Query Expansion

↓

Collection

↓

Normalization

↓

Feature Extraction

↓

Gap Detection

↓

Trend Detection

↓

Ranking

↓

Summarization

↓

Persistence

Each stage receives an immutable context and produces data for the next stage.

---

## Principle 3 — Interface-Based Communication

Modules communicate through interfaces instead of concrete implementations.

Examples:

Collector

Repository

LLM Provider

Cache Provider

Storage Provider

The pipeline depends on contracts rather than implementations.

---

## Principle 4 — Infrastructure Independence

Business logic shall not depend directly on:

- PostgreSQL
    
- Supabase
    
- Redis
    
- OpenAI
    
- Gemini
    
- Anthropic
    

Infrastructure components remain replaceable.

---

# 3. System Overview

```
            Client
               │
               ▼
          Fastify API
               │
               ▼
      Analysis Orchestrator
               │
    ┌──────────┴──────────┐
    ▼                     ▼
```

Pipeline Runner Background Jobs  
│  
▼  
Query Expansion  
▼  
Source Collectors  
▼  
Normalization  
▼  
Feature Extraction  
▼  
Gap Engine  
▼  
Trend Engine  
▼  
Ranking Engine  
▼  
LLM Summarizer  
▼  
Persistence Layer  
▼  
PostgreSQL  
│  
▼  
API Response

---

# 4. Core Modules

## 4.1 API Module

Responsibilities

- Accept requests
    
- Validate input
    
- Authenticate users (future)
    
- Start analysis
    
- Return results
    

The API contains no business logic.

---

## 4.2 Analysis Orchestrator

The orchestrator coordinates the complete workflow.

Responsibilities

- Create analysis context
    
- Execute pipeline
    
- Handle failures
    
- Coordinate parallel stages
    

The orchestrator does not perform analysis.

It only coordinates.

---

## 4.3 Query Expansion Module

Input

Topic

Output

Expanded Queries

Responsibilities

- Google Autocomplete
    
- People Also Ask
    
- Related Reddit terms
    
- Query deduplication
    

---

## 4.4 Collector Module

Responsibilities

Collect raw information from external platforms.

Each platform has its own implementation.

Examples

YouTube Collector

Reddit Collector

Google Trends Collector

TikTok Collector

Instagram Collector

Collectors never communicate with one another.

---

## 4.5 Normalization Module

Responsibilities

Convert every platform response into one unified internal representation.

Everything downstream depends on normalized content only.

---

## 4.6 Feature Extraction Module

Responsibilities

Compute derived metrics.

Examples

Engagement Rate

Velocity

Freshness

Momentum

Comment Activity

Search Growth

No ranking occurs here.

Only metric computation.

---

## 4.7 Gap Engine

Responsibilities

Identify missing opportunities.

Produces

Gap Candidates

The Gap Engine knows nothing about trends.

---

## 4.8 Trend Engine

Responsibilities

Identify rapidly growing opportunities.

Produces

Trend Candidates

Trend Engine knows nothing about gaps.

---

## 4.9 Ranking Engine

Responsibilities

Merge

Gap Candidates

Trend Candidates

Compute Opportunity Scores

Return ranked opportunities.

---

## 4.10 LLM Module

Responsibilities

Generate explanations.

Suggest content ideas.

Generate output JSON.

The LLM never decides rankings.

---

## 4.11 Persistence Module

Responsibilities

Store

Runs

Topics

Queries

Content

Metrics

Gap Results

Trend Results

---

## 4.12 Export Module

Responsibilities

Generate

CSV

Excel

PDF

Exports operate only on stored analysis results.

---

# 5. Background Workers

Workers execute asynchronous tasks.

Examples

Analysis Worker

Refresh Worker

Discovery Worker

Export Worker

Workers communicate through BullMQ.

---

# 6. External Systems

Google

Google Trends

YouTube

Reddit

TikTok

Instagram

Quora

Product Hunt

Hacker News

LLM Provider

Supabase

Redis

---

# 7. Dependency Rules

Allowed

API

↓

Analysis

↓

Pipeline

↓

Interfaces

↓

Infrastructure

Forbidden

Infrastructure

↓

Business Logic

Collectors

↓

Gap Engine

Gap Engine

↓

Collectors

Trend Engine

↓

Collectors

Business logic must never directly depend on implementation details.

---

# 8. Error Handling

Collector failure shall not terminate analysis.

Instead

Collector fails

↓

Warning stored

↓

Remaining collectors continue

↓

Partial analysis generated

Only catastrophic failures terminate analysis.

---

# 9. Future Scalability

Every major module may later become an independent service.

Likely extraction order

Collectors

↓

LLM

↓

Trend Engine

↓

Export Service

The public interfaces should remain unchanged after extraction.