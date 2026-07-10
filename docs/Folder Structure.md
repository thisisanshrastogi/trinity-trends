src/

    app/

    analysis/

    collectors/

    normalization/

    features/

    detection/

    ranking/

    storage/

    llm/

    exports/

    workers/

    lib/

app/

    server.ts

    routes.ts

    plugins.ts

    config.ts

    bootstrap.ts


analysis/

    context/

    pipeline/

    orchestrator/

    stages/


## context/
	
	AnalysisContext.ts
	
	AnalysisRequest.ts
	
	AnalysisResult.ts

Only data.

## stages/
	CreateContextStage
	
	ExpandQueriesStage
	
	CollectStage
	
	NormalizeStage
	
	FeatureStage
	
	GapStage
	
	TrendStage
	
	RankingStage
	
	LLMStage
	
	PersistStage


collectors/

    collector.ts

    registry.ts

    youtube/

    reddit/

    google/

    tiktok/

    instagram/

    quora/

reddit/

    RedditCollector.ts

    RedditNormalizer.ts

    RedditMapper.ts

    RedditClient.ts

normalization/

    Normalizer.ts

    NormalizationEngine.ts

features/

    FeatureExtractor.ts

    calculators/

        velocity.ts

        engagement.ts

        freshness.ts

        momentum.ts


detection/

    gap/

    trend/
gap/

    GapEngine.ts

    rules/

        missing-format.ts

        stale-content.ts

        missing-angle.ts

        unanswered.ts


ranking/

    OpportunityRanker.ts

    OpportunityScore.ts

    Deduplicator.ts
llm/

    provider.ts

    prompts/

    openai/

    anthropic/

    gemini/

topics/

runs/

queries/

content/

opportunities/


exports/

    csv/

    excel/

    pdf/

workers/

    analysis/

    refresh/

    export/

    discovery/
