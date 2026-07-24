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
import { InstagramCollector } from '../collectors/instagram/instagram.collector.js';
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
  onLog?: (msg: string) => void;
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
  instagram?: {
    limit?: number;
    searchType?: "keyword" | "hashtag";
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
  private instagramCollector = new InstagramCollector();

  /**
   * Run the full data collection pipeline.
   * @param userEmail Email of the user initiating the query
   * @param userName Name of the user
   * @param query The core search query
   * @param options Configuration for expansion and collectors
   */
  async runPipeline(userEmail: string, userName: string, query: string, options?: PipelineCollectionOptions): Promise<string> {
    const log = (msg: string) => {
      if (options?.onLog) options.onLog(msg);
      else console.log(msg);
    };

    log(`Starting pipeline for query: "${query}"`);
    const topK = options?.topK ?? 10;

    // 1. Create or get user
    let user = this.repo.getUserByEmail(userEmail);
    if (!user) {
      log(`Creating new user: ${userName} (${userEmail})`);
      user = this.repo.createUser({ name: userName, email: userEmail });
    } else {
      log(`Found existing user: ${user.id}`);
    }

    let session = options?.sessionId ? this.repo.getSessionById(options.sessionId) : null;
    if (!session) {
      log(`Creating new session...`);
      session = this.repo.createSession({ userId: user.id, query });
    } else {
      log(`Resuming session: ${session.id}`);
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
        log(`Stage 1/4: Intent Analysis`);
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
        log(`Stage 2/4: Topic Expansion & Scoring`);
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
        log(`Stage 3/4: Data Collection (Top ${topK} candidates)`);
        const collectionRun = this.repo.createPipelineRun({ sessionId: session.id, stage: 'collection' });

        if (!scoredExpansion) {
          const dbExpansion = this.repo.getExpansionResult(session.id);
          if (dbExpansion) {
            scoredExpansion = JSON.parse(dbExpansion.resultJson);
          }
        }
        if (!intentResult) {
          const dbIntent = this.repo.getIntentResult(session.id);
          if (dbIntent) {
            intentResult = JSON.parse(dbIntent.resultJson);
          }
        }

        if (scoredExpansion) {
          // Get top K candidates sorted by score
          const candidatesToCollect = scoredExpansion.candidates.slice(0, topK);

          const candidatePromises = candidatesToCollect.map(async (candidate: any, i: number) => {
            log(`Collecting topic ${i + 1}/${candidatesToCollect.length}: "${candidate.query}"`);

            // Upsert candidate as a topic
            const topic = this.repo.upsertTopic({
              text: candidate.query,
              sessionId: session.id,
              source: 'expansion'
            });

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
              log(`Reddit: ${redditResult.value.length} items`);
            } else {
              log(`Reddit collection failed: ${redditResult.reason}`);
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
              log(`YouTube: ${ytResult.value.length} items`);
            } else {
              log(`YouTube collection failed: ${ytResult.reason}`);
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
              log(`Hacker News: ${hnResult.value.length} items`);
            } else {
              log(`Hacker News collection failed: ${hnResult.reason}`);
            }
          });

          const intentTopics = intentResult?.topics || [];
          const intentPromiseChain = (async () => {
            for (let i = 0; i < intentTopics.length; i++) {
              const topicText = intentTopics[i];
              log(`Collecting Instagram topic ${i + 1}/${intentTopics.length}: "${topicText}"`);

              const topic = this.repo.upsertTopic({
                text: topicText,
                sessionId: session.id,
                source: 'intent'
              });

              try {
                const igResult = await this.instagramCollector.collect({
                  query: topicText,
                  limit: options?.instagram?.limit ?? 10,
                  searchType: options?.instagram?.searchType ?? "keyword"
                });
                this.repo.saveCollectorResult({
                  topicId: topic.id,
                  sessionId: session.id,
                  platform: 'instagram',
                  query: topicText,
                  resultJson: JSON.stringify(igResult),
                  resultCount: igResult.length
                });
                log(`Instagram: ${igResult.length} items`);
              } catch (err: any) {
                log(`Instagram collection failed: ${err.message}`);
              }
            }
          })();

          await Promise.all([...candidatePromises, intentPromiseChain]);

          this.repo.updatePipelineRun(collectionRun.id, {
            status: 'completed',
            resultSummary: JSON.stringify({ collectedTopics: candidatesToCollect.length }),
            completedAt: Date.now()
          });
        }
      }

      // 6. Python Pipeline
      if (startIndex <= 3 && 3 <= endIndex) {
        log(`Stage 4/4: Python Pipeline Analysis`);
        const pythonRun = this.repo.createPipelineRun({ sessionId: session.id, stage: 'python_analysis' });

        await this.exportAndRunPython(session.id, query, options?.pythonStartStage, options?.pythonEndStage, options);

        this.repo.updatePipelineRun(pythonRun.id, {
          status: 'completed',
          resultSummary: JSON.stringify({ pythonStagesRun: true }),
          completedAt: Date.now()
        });
      }

      if (endIndex === stages.length - 1) {
        this.repo.completeSession(session.id);
      }
      log(`Pipeline paused or completed successfully for session ${session.id}`);
      return session.id;

    } catch (err: any) {
      if (options?.onLog) options.onLog(`Pipeline failed: ${err.message}`);
      throw err; // rethrow or handle differently
    }
  }

  private async exportAndRunPython(sessionId: string, seedQuery: string, startStage = 0, endStage = 9, options?: PipelineCollectionOptions) {
    const fs = await import('fs');
    const path = await import('path');
    const { spawn } = await import('child_process');

    const log = (msg: string) => {
      if (options?.onLog) options.onLog(msg);
      else console.log(msg);
    };

    log(`Formatting collection data for Python...`);
    const collectorResults = this.repo.getCollectorResultsBySession(sessionId);

    // Group by query
    const resultsMap = new Map<string, any>();
    for (const res of collectorResults) {
      if (!resultsMap.has(res.query)) {
        resultsMap.set(res.query, { query: res.query, candidateSource: 'db', errors: {}, reddit: [], youtube: [], googleTrends: [], hackerNews: [], instagram: [] });
      }
      const entry = resultsMap.get(res.query);
      const data = JSON.parse(res.resultJson);

      if (res.platform === 'reddit') entry.reddit = data;
      else if (res.platform === 'youtube') entry.youtube = data;
      else if (res.platform === 'googleTrends') entry.googleTrends = data;
      else if (res.platform === 'hackerNews') entry.hackerNews = data;
      else if (res.platform === 'instagram') entry.instagram = data;
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

    log(`Exported to JSON. Running python pipeline...`);
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

      // Run from installRoot so `-m pipeline.run` finds the python module
      await new Promise<void>((resolve, reject) => {
        let stderrBuffer = '';
        const proc = spawn(pythonExec, [
          '-m', 'pipeline.run',
          '--input', absoluteInputPath,
          '--output', absoluteOutputPath,
          '--start-stage', startStage.toString(),
          '--end-stage', endStage.toString(),
          '--state-file', absoluteStateFile
        ], {
          cwd: installRoot,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });

        proc.stdout.on('data', (data) => {
          const lines = data.toString().trim().split('\n');
          for (const line of lines) {
            if (line) log(line);
          }
        });

        proc.stderr.on('data', (data) => {
          stderrBuffer += data.toString();
          const lines = data.toString().trim().split('\n');
          for (const line of lines) {
            if (line) log(line);
          }
        });

        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Python process exited with code ${code}\nStderr:\n${stderrBuffer.trim()}`));
        });
      });
      log(`Python pipeline finished.`);

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
        log(`Saved Python result to database.`);
      }
    } catch (err: any) {
      log(`Python pipeline execution failed.`);
      throw err;
    }
  }
}
