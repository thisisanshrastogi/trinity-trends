import { SqliteRepository } from '../storage/sqlite/sqlite.repository.js';
import { GeminiFactory } from '../common/llm/gemini.factory.js';
import { LLMIntentAnalyzer } from '../intent/intent.analyzer.js';
import { ExpansionService } from '../expansion/expansion.service.js';
import { GoogleAutocompleteExpander } from '../expansion/autocomplete.expanders.js';
import { LLMSubtopicExpander } from '../expansion/llm.subtopic.expanders.js';
import { TrendsExpander } from '../expansion/trends.expanders.js';
import { SemanticSearchService } from '../semantic/semanticSearch.service.js';
import { GoogleEmbeddingClient } from '../semantic/embedding.client.js';
import { ExpansionScorer } from '../semantic/expansion.scorer.js';
import { RedditCollector } from '../collectors/reddit/reddit.collector.js';
import { YouTubeCollector } from '../collectors/youtube/youtube.collector.js';
import { GoogleTrendsCollector } from '../collectors/googleTrends/googleTrends.collector.js';
import { RedditSort, RedditTime } from '../collectors/reddit/reddit.types.js';
import { FilterSelection } from '../collectors/youtube/youtube.filters.js';
import { GoogleTrendsMethod, GoogleTrendsResolution } from '../collectors/googleTrends/googleTrends.types.js';
import { HackerNewsCollector } from '../collectors/hackerNews/hackerNews.collector.js';
import { HackerNewsTag } from '../collectors/hackerNews/hackerNews.types.js';
import { Tracer, TraceEvent } from '../common/llm/llm.trace.js';

export type PipelineStage = 'intent' | 'expansion' | 'collection' | 'python';

class SessionTokenTracer implements Tracer {
  private currentSessionId: string | null = null;

  constructor(private repo: SqliteRepository) { }

  setSession(sessionId: string) {
    this.currentSessionId = sessionId;
  }

  event(e: TraceEvent) {
    if (e.phase === "ok" && e.raw && (e.raw as any).usage) {
      if (this.currentSessionId) {
        const usage = (e.raw as any).usage;
        this.repo.saveTokenUsage(
          this.currentSessionId,
          e.scope,
          (e.raw as any).model || "gemini",
          usage.promptTokenCount ?? 0,
          usage.candidatesTokenCount ?? 0,
          usage.totalTokenCount ?? 0
        );
      }
    }
  }
}


export interface PipelineCollectionOptions {
  sessionId?: string;
  startStage?: PipelineStage;
  endStage?: PipelineStage;
  pythonStartStage?: number;
  pythonEndStage?: number;
  topK?: number;
  reddit?: {
    limit?: number;
    sort?: RedditSort;
    time?: RedditTime;
  };
  youtube?: {
    limit?: number;
    filters?: FilterSelection[];
    region?: string;
  };
  googleTrends?: {
    methods?: GoogleTrendsMethod[];
    geo?: string;
    hl?: string;
    timezone?: number;
    category?: number;
    startTime?: Date;
    endTime?: Date;
    resolution?: GoogleTrendsResolution;
    trendDate?: Date;
  };
  hackerNews?: {
    limit?: number;
    sort?: "relevance" | "date";
    tags?: HackerNewsTag[];
    author?: string;
    minPoints?: number;
    maxPoints?: number;
    minComments?: number;
    maxComments?: number;
    after?: Date;
    before?: Date;
    exactMatch?: boolean;
    attributesToSearch?: ("title" | "story_text" | "comment_text")[];
  };
}

export class OrchestratorClient {
  private repo = new SqliteRepository();
  private tokenTracer = new SessionTokenTracer(this.repo);
  private llmFactory = new GeminiFactory({ tracer: this.tokenTracer });
  private intentAnalyzer = new LLMIntentAnalyzer(this.llmFactory);

  private autocompleteExpander = new GoogleAutocompleteExpander();
  private llmSubtopicExpander = new LLMSubtopicExpander(this.llmFactory);
  private trendsExpander = new TrendsExpander();

  private expansionService = new ExpansionService([
    this.autocompleteExpander,
    this.llmSubtopicExpander,
    this.trendsExpander
  ]);

  private embeddingClient = new GoogleEmbeddingClient();
  private semanticSearch = new SemanticSearchService(this.embeddingClient);
  private scorer = new ExpansionScorer(this.semanticSearch, this.embeddingClient);

  private redditCollector = new RedditCollector();
  private youtubeCollector = new YouTubeCollector();
  private googleTrendsCollector = new GoogleTrendsCollector();
  private hackerNewsCollector = new HackerNewsCollector();

  /**
   * Run the full data collection pipeline.
   * @param userEmail Email of the user initiating the query
   * @param userName Name of the user
   * @param query The core search query
   * @param options Configuration for expansion and collectors
   */
  async runPipeline(userEmail: string, userName: string, query: string, options?: PipelineCollectionOptions): Promise<string> {
    console.log(`[Orchestrator] Starting pipeline for query: "${query}"`);
    const topK = options?.topK ?? 10;

    // 1. Create or get user
    let user = this.repo.getUserByEmail(userEmail);
    if (!user) {
      console.log(`[Orchestrator] Creating new user: ${userName} (${userEmail})`);
      user = this.repo.createUser({ name: userName, email: userEmail });
    } else {
      console.log(`[Orchestrator] Found existing user: ${user.id}`);
    }

    let session = options?.sessionId ? this.repo.getSessionById(options.sessionId) : null;
    if (!session) {
      console.log(`[Orchestrator] Creating new session...`);
      session = this.repo.createSession({ userId: user.id, query });
    } else {
      console.log(`[Orchestrator] Resuming session: ${session.id}`);
    }

    this.tokenTracer.setSession(session.id);

    const stages: PipelineStage[] = ['intent', 'expansion', 'collection', 'python'];
    let startIndex = stages.indexOf(options?.startStage ?? 'intent');
    const endIndex = stages.indexOf(options?.endStage ?? 'python');

    if (!options?.startStage && options?.sessionId) {
      const runs = this.repo.getPipelineRunsBySession(session.id);
      const completedStages = new Set(runs.filter(r => r.status === 'completed').map(r => r.stage));

      if (completedStages.has('intent_analysis')) startIndex = Math.max(startIndex, 1);
      if (completedStages.has('topic_expansion')) startIndex = Math.max(startIndex, 2);
      if (completedStages.has('collection')) startIndex = Math.max(startIndex, 3);
      if (completedStages.has('python_analysis')) startIndex = Math.max(startIndex, 4);
    }

    try {
      let intentResult: any = null;

      // 3. Intent Analysis
      if (startIndex <= 0 && 0 <= endIndex) {
        console.log(`[Orchestrator] Stage 1/4: Intent Analysis`);
        const intentRun = this.repo.createPipelineRun({ sessionId: session.id, stage: 'intent_analysis' });

        intentResult = await this.intentAnalyzer.analyze(query);

        this.repo.saveIntentResult({
          sessionId: session.id,
          query,
          resultJson: JSON.stringify(intentResult)
        });

        for (const topicText of intentResult.topics) {
          this.repo.upsertTopic({
            text: topicText,
            sessionId: session.id,
            source: 'intent'
          });
        }

        this.repo.updatePipelineRun(intentRun.id, {
          status: 'completed',
          resultSummary: JSON.stringify({ intent: intentResult.intent, category: intentResult.category, topics: intentResult.topics.length }),
          completedAt: Date.now()
        });

      }

      // 4. Expansion & Scoring
      let scoredExpansion: any = null;
      if (startIndex <= 1 && 1 <= endIndex) {
        console.log(`[Orchestrator] Stage 2/4: Topic Expansion & Scoring`);
        const expansionRun = this.repo.createPipelineRun({ sessionId: session.id, stage: 'topic_expansion' });

        if (!intentResult) {
          const dbIntent = this.repo.getIntentResult(session.id);
          if (dbIntent) {
            intentResult = JSON.parse(dbIntent.resultJson);
          } else {
            throw new Error("Cannot run expansion without intent analysis result.");
          }
        }

        const rawExpansion = await this.expansionService.expand(query, intentResult);
        scoredExpansion = await this.scorer.score(rawExpansion);

        this.repo.saveExpansionResult({
          sessionId: session.id,
          seed: query,
          resultJson: JSON.stringify(scoredExpansion),
          candidateCount: scoredExpansion.candidates.length
        });

        this.repo.updatePipelineRun(expansionRun.id, {
          status: 'completed',
          resultSummary: JSON.stringify({ candidateCount: scoredExpansion.candidates.length }),
          completedAt: Date.now()
        });
      }

      // 5. Collection
      if (startIndex <= 2 && 2 <= endIndex) {
        console.log(`[Orchestrator] Stage 3/4: Data Collection (Top ${topK} candidates)`);
        const collectionRun = this.repo.createPipelineRun({ sessionId: session.id, stage: 'collection' });

        if (!scoredExpansion) {
          const dbExpansion = this.repo.getExpansionResult(session.id);
          if (dbExpansion) {
            scoredExpansion = JSON.parse(dbExpansion.resultJson);
          }
        }

        if (scoredExpansion) {
          // Get top K candidates sorted by score
          const candidatesToCollect = scoredExpansion.candidates.slice(0, topK);

          for (let i = 0; i < candidatesToCollect.length; i++) {
            const candidate = candidatesToCollect[i];
            console.log(`\n[Orchestrator] Collecting for topic ${i + 1}/${candidatesToCollect.length}: "${candidate.query}"`);

            // Upsert candidate as a topic
            const topic = this.repo.upsertTopic({
              text: candidate.query,
              sessionId: session.id,
              source: 'expansion'
            });

            console.log(`  -> Collecting from Reddit, YouTube, and Hacker News in parallel...`);
            
            const results = await Promise.allSettled([
              this.redditCollector.collect({
                query: candidate.query,
                limit: options?.reddit?.limit ?? 10,
                sort: options?.reddit?.sort ?? "relevance",
                time: options?.reddit?.time ?? "month"
              }),
              this.youtubeCollector.collect({
                query: candidate.query,
                limit: options?.youtube?.limit ?? 10,
                filters: options?.youtube?.filters ?? [
                  { category: "uploadDate", label: "This month" },
                  { category: "type", label: "Video" }
                ],
                region: options?.youtube?.region
              }),
              this.hackerNewsCollector.collect({
                query: candidate.query,
                limit: options?.hackerNews?.limit ?? 10,
                sort: options?.hackerNews?.sort,
                tags: options?.hackerNews?.tags,
                author: options?.hackerNews?.author,
                minPoints: options?.hackerNews?.minPoints ?? 2,
                maxPoints: options?.hackerNews?.maxPoints,
                minComments: options?.hackerNews?.minComments,
                maxComments: options?.hackerNews?.maxComments,
                after: options?.hackerNews?.after ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                before: options?.hackerNews?.before,
                exactMatch: options?.hackerNews?.exactMatch,
                attributesToSearch: options?.hackerNews?.attributesToSearch
              })
            ]);

            const [redditResult, ytResult, hnResult] = results;

            if (redditResult.status === 'fulfilled') {
              this.repo.saveCollectorResult({
                topicId: topic.id,
                sessionId: session.id,
                platform: 'reddit',
                query: candidate.query,
                resultJson: JSON.stringify(redditResult.value),
                resultCount: redditResult.value.length
              });
              console.log(`  -> Reddit: ${redditResult.value.length} items collected.`);
            } else {
              console.error(`  -> Reddit collection failed: ${redditResult.reason}`);
            }

            if (ytResult.status === 'fulfilled') {
              this.repo.saveCollectorResult({
                topicId: topic.id,
                sessionId: session.id,
                platform: 'youtube',
                query: candidate.query,
                resultJson: JSON.stringify(ytResult.value),
                resultCount: ytResult.value.length
              });
              console.log(`  -> YouTube: ${ytResult.value.length} items collected.`);
            } else {
              console.error(`  -> YouTube collection failed: ${ytResult.reason}`);
            }

            if (hnResult.status === 'fulfilled') {
              this.repo.saveCollectorResult({
                topicId: topic.id,
                sessionId: session.id,
                platform: 'hackerNews',
                query: candidate.query,
                resultJson: JSON.stringify(hnResult.value),
                resultCount: hnResult.value.length
              });
              console.log(`  -> Hacker News: ${hnResult.value.length} items collected.`);
            } else {
              console.error(`  -> Hacker News collection failed: ${hnResult.reason}`);
            }

            // // Google Trends
            // try {
            //   console.log(`  -> Collecting from Google Trends...`);
            //   const trendsData = await this.googleTrendsCollector.collect({ 
            //     keyword: [candidate.query], 
            //     methods: options?.googleTrends?.methods ?? ["interestOverTime", "relatedQueries"], 
            //     geo: options?.googleTrends?.geo ?? "US",
            //     hl: options?.googleTrends?.hl,
            //     timezone: options?.googleTrends?.timezone,
            //     category: options?.googleTrends?.category,
            //     startTime: options?.googleTrends?.startTime,
            //     endTime: options?.googleTrends?.endTime,
            //     resolution: options?.googleTrends?.resolution,
            //     trendDate: options?.googleTrends?.trendDate
            //   });
            //   this.repo.saveCollectorResult({
            //     topicId: topic.id,
            //     sessionId: session.id,
            //     platform: 'googleTrends',
            //     query: candidate.query,
            //     resultJson: JSON.stringify(trendsData),
            //     resultCount: trendsData.length
            //   });
            //   console.log(`  -> Google Trends: completed.`);
            // } catch (err: any) {
            //   console.error(`  -> Google Trends collection failed: ${err.message}`);
            // }
          }

          this.repo.updatePipelineRun(collectionRun.id, {
            status: 'completed',
            resultSummary: JSON.stringify({ collectedTopics: candidatesToCollect.length }),
            completedAt: Date.now()
          });
        }
      }

      // 6. Python Pipeline
      if (startIndex <= 3 && 3 <= endIndex) {
        console.log(`\n[Orchestrator] Stage 4/4: Python Pipeline Analysis`);
        const pythonRun = this.repo.createPipelineRun({ sessionId: session.id, stage: 'python_analysis' });

        await this.exportAndRunPython(session.id, query, options?.pythonStartStage, options?.pythonEndStage);

        this.repo.updatePipelineRun(pythonRun.id, {
          status: 'completed',
          resultSummary: JSON.stringify({ pythonStagesRun: true }),
          completedAt: Date.now()
        });
      }

      if (endIndex === stages.length - 1) {
        this.repo.completeSession(session.id);
      }
      console.log(`\n[Orchestrator] Pipeline paused or completed successfully for session ${session.id}`);
      return session.id;

    } catch (err: any) {
      console.error(`\n[Orchestrator] Pipeline failed: ${err.message}`);
      throw err; // rethrow or handle differently
    }
  }

  private async exportAndRunPython(sessionId: string, seedQuery: string, startStage = 0, endStage = 9) {
    const fs = await import('fs');
    const path = await import('path');
    const { execSync } = await import('child_process');

    console.log(`[Orchestrator] Formatting collection data for Python...`);
    const collectorResults = this.repo.getCollectorResultsBySession(sessionId);

    // Group by query
    const resultsMap = new Map<string, any>();
    for (const res of collectorResults) {
      if (!resultsMap.has(res.query)) {
        resultsMap.set(res.query, { query: res.query, candidateSource: 'db', errors: {}, reddit: [], youtube: [], googleTrends: [], hackerNews: [] });
      }
      const entry = resultsMap.get(res.query);
      const data = JSON.parse(res.resultJson);

      if (res.platform === 'reddit') entry.reddit = data;
      else if (res.platform === 'youtube') entry.youtube = data;
      else if (res.platform === 'googleTrends') entry.googleTrends = data;
      else if (res.platform === 'hackerNews') entry.hackerNews = data;
    }

    const finalOutput = {
      seed: seedQuery,
      rateLimitFailures: [],
      results: Array.from(resultsMap.values())
    };

    const os = await import('os');
    const outputDir = path.join(os.homedir(), '.trinity_trends', 'output', sessionId);
    fs.mkdirSync(outputDir, { recursive: true });

    const inputPath = path.join(outputDir, 'collection-scored.json');
    const outputPath = path.join(outputDir, 'analysis-result.json');
    const stateFile = path.join(outputDir, 'pipeline_state.pkl');

    fs.writeFileSync(inputPath, JSON.stringify(finalOutput, null, 2), 'utf8');

    console.log(`[Orchestrator] Exported to ${inputPath}. Running python pipeline...`);
    try {
      const { fileURLToPath } = await import('url');
      const { dirname } = await import('path');
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);

      // Find the root directory of the installation (where package.json lives)
      let installRoot = __dirname;
      while (!fs.existsSync(path.join(installRoot, 'package.json')) && installRoot !== '/') {
        installRoot = path.dirname(installRoot);
      }

      const pythonExecPath = path.join(installRoot, 'pipeline', '.venv', 'bin', 'python3');
      const pythonExec = fs.existsSync(pythonExecPath) ? pythonExecPath : 'python3';

      // Python needs absolute paths because we are about to change the cwd to installRoot
      const absoluteInputPath = path.resolve(process.cwd(), inputPath);
      const absoluteOutputPath = path.resolve(process.cwd(), outputPath);
      const absoluteStateFile = path.resolve(process.cwd(), stateFile);

      const cmd = `"${pythonExec}" -m pipeline.run --input "${absoluteInputPath}" --output "${absoluteOutputPath}" --start-stage ${startStage} --end-stage ${endStage} --state-file "${absoluteStateFile}"`;
      console.log(`[Orchestrator] Executing: ${cmd}`);

      // Run from installRoot so `-m pipeline.run` finds the python module
      execSync(cmd, { stdio: 'inherit', cwd: installRoot });
      console.log(`[Orchestrator] Python pipeline finished.`);

      if (fs.existsSync(outputPath)) {
        const pythonResultJson = fs.readFileSync(outputPath, 'utf8');

        try {
          const parsed = JSON.parse(pythonResultJson);
          if (parsed.token_usage && Array.isArray(parsed.token_usage)) {
            for (const usage of parsed.token_usage) {
              this.repo.saveTokenUsage(
                sessionId,
                usage.stage,
                usage.model,
                usage.prompt_tokens,
                usage.output_tokens,
                usage.total_tokens
              );
            }
          }
        } catch (e) {
          console.error("[Orchestrator] Failed to parse Python result for token usage", e);
        }

        this.repo.savePythonResult({
          sessionId,
          resultJson: pythonResultJson
        });
        console.log(`[Orchestrator] Saved Python result to database.`);
      }
    } catch (err: any) {
      console.error(`[Orchestrator] Python pipeline execution failed.`);
      throw err;
    }
  }
}
