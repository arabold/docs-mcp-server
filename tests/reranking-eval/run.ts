import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { EventBusService } from "../../src/events/EventBusService";
import { CircuitBreakingReranker, RerankerUnavailableError } from "../../src/store/CircuitBreakingReranker";
import { DocumentManagementService } from "../../src/store/DocumentManagementService";
import { DocumentStore } from "../../src/store/DocumentStore";
import type { RerankCandidate, Reranker, RerankResult } from "../../src/store/Reranker";
import { VoyageReranker, VoyageRerankerError } from "../../src/store/VoyageReranker";
import { type AppConfig, AppConfigSchema } from "../../src/utils/config";
import { LogLevel, setLogLevel } from "../../src/utils/logger";
import {
  buildModeSummary,
  compareModeOutcomes,
  type EvaluationDataset,
  type EvaluationDatasetEntry,
  type EvaluationMode,
  evaluateReleaseGate,
  loadLockedDataset,
  MATERIAL_BENEFIT_ABSOLUTE,
  type ModeSummary,
  ObservedForcedFailOpenReranker,
  type QueryMeasurement,
  summarizePageEvidence,
} from "./release-gate";

const EXPECTED_DATASET_SHA256 = "6e048569089ec05445f73a1d67975290bc7554357a691e7c0c8d053a802161c5";
const EMBEDDING_MODEL = "openai:baai/bge-m3";
const VECTOR_DIMENSION = 1024;
const RERANKER_MODEL = "rerank-2.5-lite";
const RERANKER_TIMEOUT_MS = 5000;
const VOYAGE_PRICE_PER_MILLION_TOKENS_USD = 0.02;
const RESULT_LIMIT = 30;
const CANDIDATE_LIMITS = [30, 50] as const;

interface ProviderObservation {
  latencyMs: number;
  usageTokens: number | null;
  failureCategory: string | null;
  candidateFiles: string[];
  candidatePageCount: number;
}

interface CandidateEvidence {
  limit30: Map<string, SafePageEvidence>;
  limit50: Map<string, SafePageEvidence>;
}

interface SafePageEvidence {
  files: string[];
  pageCount: number;
}

interface SafeReport {
  schemaVersion: 1;
  generatedAt: string;
  source: {
    datasetSha256: string;
    snapshotSha256: string;
    library: string;
    version: string;
    queryCount: number;
    pageCount: number;
    chunkCount: number;
  };
  configuration: {
    embeddingModel: string;
    vectorDimension: number;
    rerankerModel: string;
    resultLimit: number;
    candidateLimits: number[];
    rerankerTimeoutMs: number;
    pricePerMillionTokensUsd: number;
    materialBenefitAbsolute: number;
  };
  modes: Record<EvaluationMode, ModeSummary>;
  comparisons: {
    rerank30VsBaseline: { wins: number; ties: number; losses: number };
    rerank50VsBaseline: { wins: number; ties: number; losses: number };
  };
  gate: ReturnType<typeof evaluateReleaseGate>;
}

class ObservedReranker implements Reranker {
  readonly observations = new Map<string, ProviderObservation>();

  constructor(private readonly reranker: Reranker) {}

  async rerank(query: string, candidates: readonly RerankCandidate[]): Promise<RerankResult> {
    const startedAt = performance.now();
    const candidateEvidence = summarizePageEvidence(
      candidates.map((candidate) => candidate.sourceUrl ?? ""),
    );
    try {
      const result = await this.reranker.rerank(query, candidates);
      this.observations.set(query, {
        latencyMs: performance.now() - startedAt,
        usageTokens: result.usageTokens ?? null,
        failureCategory: null,
        candidateFiles: candidateEvidence.files,
        candidatePageCount: candidateEvidence.pageCount,
      });
      return result;
    } catch (error) {
      this.observations.set(query, {
        latencyMs: performance.now() - startedAt,
        usageTokens: null,
        failureCategory: safeFailureCategory(error),
        candidateFiles: candidateEvidence.files,
        candidatePageCount: candidateEvidence.pageCount,
      });
      throw error;
    }
  }
}

async function main(): Promise<void> {
  setLogLevel(LogLevel.ERROR);
  const datasetPath = requiredEnv("DOCS_RERANK_EVAL_DATASET");
  const storePath = requiredEnv("DOCS_RERANK_EVAL_STORE");
  const outputJsonPath = requiredEnv("DOCS_RERANK_EVAL_OUTPUT_JSON");
  const outputMarkdownPath = requiredEnv("DOCS_RERANK_EVAL_OUTPUT_MARKDOWN");
  requiredEnv("OPENAI_API_KEY");
  requiredEnv("OPENAI_API_BASE");
  requiredEnv("VOYAGE_API_KEY");

  const datasetContents = fs.readFileSync(datasetPath, "utf8");
  const dataset = loadLockedDataset(datasetContents, EXPECTED_DATASET_SHA256);
  const databasePath = path.join(storePath, "documents.db");
  const snapshotSha256 = sha256File(databasePath);
  const inventory = readInventory(databasePath, dataset);

  const candidateConfig = createConfig(storePath, false, 50);
  const candidateStore = new DocumentStore(databasePath, candidateConfig);
  await candidateStore.initialize();
  let candidateEvidence: CandidateEvidence;
  try {
    candidateEvidence = await retrieveCandidates(candidateStore, dataset);
  } finally {
    await candidateStore.shutdown();
  }

  const baseline = await runMode(dataset, storePath, "baseline", candidateEvidence.limit30);
  const rerank30 = await runMode(dataset, storePath, "rerank-30", candidateEvidence.limit30);
  const rerank50 = await runMode(dataset, storePath, "rerank-50", candidateEvidence.limit50);
  const failOpen = await runMode(
    dataset,
    storePath,
    "forced-fail-open",
    candidateEvidence.limit30,
  );
  const modes = { baseline, "rerank-30": rerank30, "rerank-50": rerank50, "forced-fail-open": failOpen };
  const report: SafeReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      datasetSha256: EXPECTED_DATASET_SHA256,
      snapshotSha256,
      library: dataset.library,
      version: dataset.version,
      queryCount: dataset.entries.length,
      pageCount: inventory.pageCount,
      chunkCount: inventory.chunkCount,
    },
    configuration: {
      embeddingModel: EMBEDDING_MODEL,
      vectorDimension: VECTOR_DIMENSION,
      rerankerModel: RERANKER_MODEL,
      resultLimit: RESULT_LIMIT,
      candidateLimits: [...CANDIDATE_LIMITS],
      rerankerTimeoutMs: RERANKER_TIMEOUT_MS,
      pricePerMillionTokensUsd: VOYAGE_PRICE_PER_MILLION_TOKENS_USD,
      materialBenefitAbsolute: MATERIAL_BENEFIT_ABSOLUTE,
    },
    modes,
    comparisons: {
      rerank30VsBaseline: compareModeOutcomes(baseline, rerank30),
      rerank50VsBaseline: compareModeOutcomes(baseline, rerank50),
    },
    gate: evaluateReleaseGate({ baseline, rerank30, rerank50, failOpen }),
  };

  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputMarkdownPath), { recursive: true });
  fs.writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(outputMarkdownPath, renderMarkdown(report));
  console.log(
    JSON.stringify({
      pass: report.gate.pass,
      selectedCandidateLimit: report.gate.selectedCandidateLimit,
      failedChecks: report.gate.checks.filter((check) => !check.pass).map((check) => check.name),
      modes: Object.fromEntries(
        Object.entries(report.modes).map(([mode, summary]) => [
          mode,
          {
            mrr: summary.metrics.mrr,
            ndcgAt5: summary.metrics.ndcgAt5,
            recallAt30: summary.metrics.recallAt30,
            tokens: summary.tokens,
            costUsd: summary.costUsd,
            providerFailures: summary.providerFailures.total,
            fallbacks: summary.fallbacks.total,
          },
        ]),
      ),
    }),
  );
  if (!report.gate.pass) process.exitCode = 1;
}

async function retrieveCandidates(
  store: DocumentStore,
  dataset: EvaluationDataset,
): Promise<CandidateEvidence> {
  const limit30 = new Map<string, SafePageEvidence>();
  const limit50 = new Map<string, SafePageEvidence>();
  for (const entry of dataset.entries) {
    const results30 = await store.findByContent(
      dataset.library,
      dataset.version,
      entry.query,
      30,
    );
    const results50 = await store.findByContent(
      dataset.library,
      dataset.version,
      entry.query,
      50,
    );
    limit30.set(
      entry.id,
      summarizePageEvidence(results30.map((result) => result.url)),
    );
    limit50.set(
      entry.id,
      summarizePageEvidence(results50.map((result) => result.url)),
    );
  }
  return { limit30, limit50 };
}

async function runMode(
  dataset: EvaluationDataset,
  storePath: string,
  mode: EvaluationMode,
  candidateEvidenceByQuery: Map<string, SafePageEvidence>,
): Promise<ModeSummary> {
  const candidateLimit = mode === "rerank-50" ? 50 : 30;
  const enabled = mode !== "baseline";
  const config = createConfig(storePath, enabled, candidateLimit);
  const observed =
    mode === "rerank-30" || mode === "rerank-50"
      ? new ObservedReranker(
          new CircuitBreakingReranker(
            new VoyageReranker({
              apiKey: requiredEnv("VOYAGE_API_KEY"),
              model: config.search.reranker.model,
              requestTimeoutMs: config.search.reranker.requestTimeoutMs,
            }),
          ),
        )
      : null;
  const forced = mode === "forced-fail-open" ? new ObservedForcedFailOpenReranker() : null;
  const reranker: Reranker | undefined = forced ?? observed ?? undefined;
  const service = new DocumentManagementService(new EventBusService(), config, reranker);
  await service.initialize();
  const measurements: QueryMeasurement[] = [];
  try {
    for (const entry of dataset.entries) {
      measurements.push(
        await measureQuery(
          service,
          dataset,
          entry,
          candidateEvidenceByQuery.get(entry.id) ?? { files: [], pageCount: 0 },
        ),
      );
      if (observed) {
        const latest = observed.observations.get(entry.query);
        const measurement = measurements[measurements.length - 1];
        measurement.rerankerLatencyMs = latest?.latencyMs ?? null;
        measurement.usageTokens = latest?.usageTokens ?? null;
        measurement.providerFailure = latest?.failureCategory ?? null;
        measurement.fallbackCategory = latest?.failureCategory ?? null;
        if (latest) {
          measurement.candidateFiles = latest.candidateFiles;
          measurement.candidateCount = latest.candidateFiles.length;
          measurement.candidatePageCount = latest.candidatePageCount;
        }
      }
      if (forced) {
        const latest = forced.observations.get(entry.query);
        if (latest) {
          const evidence = summarizePageEvidence(
            latest.candidates.map((candidate) => candidate.sourceUrl ?? ""),
          );
          const measurement = measurements[measurements.length - 1];
          measurement.candidateFiles = evidence.files;
          measurement.candidateCount = evidence.files.length;
          measurement.candidatePageCount = evidence.pageCount;
          measurement.fallbackCategory = latest.failureCategory;
        }
      }
    }
  } finally {
    await service.shutdown();
  }
  return buildModeSummary(mode, measurements, VOYAGE_PRICE_PER_MILLION_TOKENS_USD);
}

async function measureQuery(
  service: DocumentManagementService,
  dataset: EvaluationDataset,
  entry: EvaluationDatasetEntry,
  candidateEvidence: SafePageEvidence,
): Promise<QueryMeasurement> {
  const startedAt = performance.now();
  const results = await service.searchStore(
    dataset.library,
    dataset.version,
    entry.query,
    RESULT_LIMIT,
  );
  const rankedEvidence = summarizePageEvidence(
    results.map((result) => result.url),
    true,
  );
  return {
    id: entry.id,
    kind: entry.kind,
    qrels: entry.qrels,
    rankedFiles: rankedEvidence.files,
    candidateFiles: candidateEvidence.files,
    candidateCount: candidateEvidence.files.length,
    candidatePageCount: candidateEvidence.pageCount,
    returnedPageCount: rankedEvidence.pageCount,
    searchLatencyMs: performance.now() - startedAt,
    rerankerLatencyMs: null,
    usageTokens: null,
    providerFailure: null,
    fallbackCategory: null,
  };
}

function createConfig(storePath: string, enabled: boolean, candidateLimit: number): AppConfig {
  return AppConfigSchema.parse({
    app: {
      storePath,
      telemetryEnabled: false,
      readOnly: true,
      embeddingModel: EMBEDDING_MODEL,
    },
    embeddings: { vectorDimension: VECTOR_DIMENSION },
    search: {
      overfetchFactor: 2,
      weightVec: 1,
      weightFts: 1,
      vectorMultiplier: 10,
      reranker: {
        enabled,
        provider: "voyage",
        model: RERANKER_MODEL,
        candidateLimit,
        requestTimeoutMs: RERANKER_TIMEOUT_MS,
      },
    },
  }) as AppConfig;
}

function readInventory(
  databasePath: string,
  dataset: EvaluationDataset,
): { pageCount: number; chunkCount: number } {
  const store = new Database(databasePath, { readonly: true });
  try {
    const row = store
      .prepare(
        "select count(distinct p.id) pageCount, count(d.id) chunkCount from libraries l join versions v on v.library_id=l.id join pages p on p.version_id=v.id join documents d on d.page_id=p.id where lower(l.name)=lower(?) and lower(coalesce(v.name,''))=lower(?)",
      )
      .get(dataset.library, dataset.version) as { pageCount: number; chunkCount: number };
    if (row.pageCount !== 82 || row.chunkCount !== 312) {
      throw new Error("Live snapshot inventory does not match the locked benchmark corpus");
    }
    return row;
  } finally {
    store.close();
  }
}

function renderMarkdown(report: SafeReport): string {
  const modeRows = Object.values(report.modes)
    .map(
      (mode) =>
        `| ${mode.mode} | ${format(mode.metrics.mrr)} | ${format(mode.metrics.ndcgAt5)} | ${format(mode.metrics.recallAt30)} | ${mode.tokens} | $${mode.costUsd.toFixed(6)} | ${formatLatency(mode.latencyMs)} | ${mode.providerFailures.total} | ${mode.fallbacks.total} |`,
    )
    .join("\n");
  const checks = report.gate.checks
    .map((check) => `- [${check.pass ? "x" : " "}] ${check.name}`)
    .join("\n");
  const q30Rows = Object.values(report.modes)
    .map((mode) => {
      const ranks = mode.queryRanks.Q30;
      return `| ${mode.mode} | ${ranks?.candidateRank ?? "missing"} | ${ranks?.resultRank ?? "missing"} |`;
    })
    .join("\n");
  return `# Voyage reranking release gate for ONEC_ERP_IMPLEMENTATION\n\nGenerated: ${report.generatedAt}\n\n## Decision\n\n**${report.gate.pass ? "PASS" : "FAIL"}.** Selected Search Candidate limit: **${report.gate.selectedCandidateLimit}** (${report.gate.selectionReason}).\n\n## Immutable inputs\n\n- Dataset SHA-256: \`${report.source.datasetSha256}\`\n- Live snapshot SHA-256: \`${report.source.snapshotSha256}\`\n- Corpus: \`${report.source.library}@${report.source.version}\`, ${report.source.queryCount} queries, ${report.source.pageCount} pages, ${report.source.chunkCount} chunks\n- Retrieval: \`${report.configuration.embeddingModel}\`, ${report.configuration.vectorDimension} dimensions\n- Reranker: \`${report.configuration.rerankerModel}\`, ${report.configuration.rerankerTimeoutMs} ms deadline\n- Cost basis: $${report.configuration.pricePerMillionTokensUsd.toFixed(2)} per million processed tokens\n\n## Headline and operational evidence\n\n| Mode | MRR | nDCG@5 | Recall@30 | Tokens | Tariff cost | Search latency min/mean/p50/p95/max ms | Provider failures | Fallbacks |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${modeRows}\n\n30 vs Baseline nDCG@5: ${formatComparison(report.comparisons.rerank30VsBaseline)}.\n\n50 vs Baseline nDCG@5: ${formatComparison(report.comparisons.rerank50VsBaseline)}.\n\n## Q30 ranks\n\n| Mode | Search Candidate rank | Search Result rank |\n|---|---:|---:|\n${q30Rows}\n\n## Gate checks\n\n${checks}\n\n## Full evidence\n\nThe sibling JSON report contains every per-query deterministic metric input, intent breakdown, candidate/page count, latency, provider/fallback category, and token total. The evidence uses sanitized categories and aggregate operational data suitable for repository review.\n`;
}

function formatComparison(value: { wins: number; ties: number; losses: number }): string {
  return `${value.wins} wins / ${value.ties} ties / ${value.losses} losses`;
}

function formatLatency(value: {
  min: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}): string {
  return [value.min, value.mean, value.p50, value.p95, value.max]
    .map((item) => Math.round(item))
    .join("/");
}

function format(value: number): string {
  return value.toFixed(6);
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function safeFailureCategory(error: unknown): string {
  if (error instanceof RerankerUnavailableError || error instanceof VoyageRerankerError) {
    return error.category;
  }
  return "request_failed";
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  console.error(`❌ Release gate failed: ${message}`);
  process.exitCode = 1;
});
