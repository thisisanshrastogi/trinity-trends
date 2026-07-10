


## Entity

This is something in the world.

Examples

```
Claude Code

Cursor

Docker

MCP

Next.js
```

This becomes the center of the system.

Not Topic.

Entity.

---

Entity has

```
id

name

aliases

type

description
```

Type

```
Tool

Framework

Programming Language

Company

Product
```

---

## Query

Queries are different.

```
Claude Code Docker

Claude Code Tutorial

Claude Code Pricing
```

They are search phrases.

Not entities.

A query may reference multiple entities.

Example

```
Claude Code Docker
```

references

```
Claude Code

Docker
```

This relationship is important.

---

## Platform

Simple.

```
YouTube

Reddit

TikTok

Google Trends

PAA
```

---

## Content

This is HUGE.

Content should be universal.

Whether

YouTube

or Reddit

or TikTok

they all become

Content.

```
id

platform

external_id

title

url

author

published_at
```

Notice

No views.

No likes.

---

Why?

Because views change.

---

# This is the biggest change I'd make.

Views

Likes

Comments

Shares

are NOT properties of Content.

They're observations.

---

Imagine

```
Today

100k views

Tomorrow

120k

Next week

500k
```

If views are stored inside Content

you're constantly overwriting.

Instead

---

Observation

```
content_id

captured_at

views

likes

comments

shares

engagement

velocity
```

This is exactly how analytics systems work.

---

Now you have

```
Content

↓

Many Observations
```

Amazing.

---

# Analysis

Represents

```
User searched

Claude Code
```

Nothing else.

```
id

started

finished

status
```

---

Notice

No results inside.

---

# AnalysisResult

Now

Analysis produces

Results.

```
analysis_id

entity_id

score

type

reason

recommendation
```

Type

```
Gap

Trend
```

Now

Gap

is just

```
AnalysisResult.type = GAP
```

No Gap table needed.

---

# This is MUCH cleaner.

---

# Step 4

Relationships

```
Entity

↓

Query

↓

Content

↓

Observation
```

Separately

```
Analysis

↓

AnalysisResult
```

AnalysisResult references

```
Entity

Content

Observation
```

---

# Step 5

Now let's ask

"What queries will we execute?"

This is where database design starts.

Example

---

### Query 1

```
Analyze Claude Code
```

Need

```
Entity

↓

Queries

↓

Content

↓

Latest Observations
```

---

### Query 2

```
Top trending AI tools
```

Need

```
Latest Observations

↓

Sort by velocity
```

---

### Query 3

```
Historical graph
```

Need

```
Observation

ORDER BY captured_at
```

---

### Query 4

```
Show previous analyses
```

Need

```
Analysis

↓

AnalysisResult
```

---

# My criticism of our previous design

I think we mixed

- Pipeline state
    
- Business entities
    
- Cached data
    

into one model.

Those are **three different things**.

I'd separate them.

---

## 1. Business Database

Things that exist.

```
Entity

Query

Platform

Content

Observation

Analysis

AnalysisResult
```

---

## 2. Cache

Things we can recollect.

```
Autocomplete

PAA

Raw API responses

Google Trends
```

Redis.

---

## 3. Runtime

Things inside AnalysisContext.

```
GapCandidates

TrendCandidates

Features

Intermediate scores

Warnings
```

Never touch Postgres.

---

# I think we've reached the point where I'd actually open Excalidraw instead of writing documents.

This system has enough moving parts that **visual modeling becomes more valuable than prose**.

If I were mentoring a junior engineer on this project, the next thing we'd spend a couple of hours on would be:

1. **A complete ER diagram** (business entities only).
    
2. **A sequence diagram** for one analysis request.
    
3. **A component diagram** showing modules and interfaces.
    
4. **A deployment diagram** (Fastify, BullMQ, Redis, Supabase, workers).
    

Those four diagrams would become the blueprint for the entire implementation. In industry, they're often more valuable than another 20 pages of documentation because they make relationships, ownership, and data flow immediately obvious. I think that's the point we've reached with your design.


