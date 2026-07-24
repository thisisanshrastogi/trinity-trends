import { IntentAnalysis, ExpansionResult } from '../intent/intent.types.js';

// ──────────────────────────────────────────────
//  Enums
// ──────────────────────────────────────────────

export type Platform = 'reddit' | 'youtube' | 'googleTrends' | 'hackerNews' | 'instagram';

export type PipelineStage =
  | 'intent_analysis'
  | 'topic_expansion'
  | 'collection'
  | 'python_analysis';

export type PipelineRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

// ──────────────────────────────────────────────
//  SQLite Entities
// ──────────────────────────────────────────────

export interface User {
  id: string;          // UUID
  name: string;
  email?: string;
  createdAt: number;   // Unix timestamp ms
}

export interface CreateUserInput {
  name: string;
  email?: string;
}

export interface Session {
  id: string;          // UUID
  userId: string;
  query: string;       // The original user query
  createdAt: number;
  completedAt?: number;
}

export interface CreateSessionInput {
  userId: string;
  query: string;
}

export interface Topic {
  id: string;          // SHA-256 hash of normalized topic text
  text: string;        // Raw topic string
  sessionId: string;
  source: string;      // Where topic came from: 'intent' | 'expansion'
  createdAt: number;
}

export interface UpsertTopicInput {
  text: string;
  sessionId: string;
  source: string;
}

export interface TopicPlatformId {
  topicId: string;
  platform: Platform;
  platformId: string;
  hashedId: string;    // SHA-256(platform:platformId)
}

export interface PipelineRun {
  id: string;          // UUID
  sessionId: string;
  stage: PipelineStage;
  status: PipelineRunStatus;
  startedAt: number;
  completedAt?: number;
  error?: string;
  /** Optional JSON payload for the stage result summary */
  resultSummary?: string;
}

export interface CreatePipelineRunInput {
  sessionId: string;
  stage: PipelineStage;
}

export interface UpdatePipelineRunInput {
  status?: PipelineRunStatus;
  completedAt?: number;
  error?: string;
  resultSummary?: string;
}

export interface CollectorResultRecord {
  id: string;           // UUID
  topicId: string;
  sessionId: string;
  platform: Platform;
  query: string;        // The actual query sent to the collector
  resultJson: string;   // Raw JSON blob from the collector
  resultCount: number;  // Number of items collected
  collectedAt: number;
}

export interface SaveCollectorResultInput {
  topicId: string;
  sessionId: string;
  platform: Platform;
  query: string;
  resultJson: string;
  resultCount: number;
}

export interface ExpansionResultRecord {
  id: string;            // UUID
  sessionId: string;
  seed: string;
  resultJson: string;    // Full ExpansionResult as JSON
  candidateCount: number;
  createdAt: number;
}

export interface SaveExpansionResultInput {
  sessionId: string;
  seed: string;
  resultJson: string;
  candidateCount: number;
}

export interface IntentResultRecord {
  id: string;
  sessionId: string;
  query: string;
  resultJson: string;   // Full IntentAnalysis as JSON
  createdAt: number;
}

export interface SaveIntentResultInput {
  sessionId: string;
  query: string;
  resultJson: string;
}

export interface PythonResultRecord {
  id: string;
  sessionId: string;
  resultJson: string;   // Full FinalSynthesisOutput as JSON
  createdAt: number;
}

export interface SavePythonResultInput {
  sessionId: string;
  resultJson: string;
}

// ──────────────────────────────────────────────
//  LanceDB Entities
// ──────────────────────────────────────────────

export interface ContentDocument {
  id: string;            // SHA-256 hash of normalized title+description
  title: string;
  description: string;
  platform: Platform;
  sourceUrl?: string;
  metadata?: string;     // Serialized JSON
}

export interface ContentSearchResult {
  document: ContentDocument;
  similarityScore: number;
}

export interface ContentDocumentInput {
  title: string;
  description: string;
  platform: Platform;
  sourceUrl?: string;
  metadata?: Record<string, any>;
}
