/**
 * Narrows the job events on a bus to the one job a CLI command submitted.
 */

import type { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import { type PipelineJob, PipelineJobStatus } from "../pipeline/types";
import type { ScraperProgressEvent } from "../scraper/types";
import { logger } from "../utils/logger";

/** What a command does with the events of its own job. */
export interface JobOutputHandlers {
  onStatus(job: PipelineJob): void;
  onProgress(job: PipelineJob, progress: ScraperProgressEvent): void;
}

type JobEvent =
  | { kind: "status"; job: PipelineJob }
  | { kind: "progress"; job: PipelineJob; progress: ScraperProgressEvent };

/**
 * Passes a command the status and progress events of the job it submitted, and
 * no others. A shared worker runs jobs for several clients, and a job can start
 * and report before the command learns its id, so the follower subscribes
 * before the job is submitted, buffers what arrives, and replays that job's
 * events once {@link follow} names it.
 */
export class JobOutputFollower {
  /** Events received before {@link follow} named the job. */
  private buffered: JobEvent[] = [];
  private jobId: string | null = null;
  private readonly unsubscribers: Array<() => void>;

  /**
   * Subscribes right away; create it before submitting the job.
   *
   * @param eventBus The bus the job's events arrive on.
   * @param handlers What to do with the followed job's events.
   */
  constructor(
    eventBus: EventBusService,
    private readonly handlers: JobOutputHandlers,
  ) {
    this.unsubscribers = [
      eventBus.on(EventType.JOB_STATUS_CHANGE, (job) =>
        this.receive({ kind: "status", job }),
      ),
      eventBus.on(EventType.JOB_PROGRESS, ({ job, progress }) =>
        this.receive({ kind: "progress", job, progress }),
      ),
    ];
  }

  /**
   * Follows `jobId`: replays its buffered events in order, drops the rest, and
   * passes on its events from now on.
   *
   * @param jobId The id of the job the command submitted.
   */
  follow(jobId: string): void {
    this.jobId = jobId;
    const buffered = this.buffered;
    this.buffered = [];
    for (const event of buffered) {
      this.deliver(event);
    }
  }

  /** Stops listening. Safe to call more than once. */
  dispose(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
    this.buffered = [];
  }

  private receive(event: JobEvent): void {
    if (this.jobId === null) {
      this.buffered.push(event);
    } else {
      this.deliver(event);
    }
  }

  private deliver(event: JobEvent): void {
    if (event.job.id !== this.jobId) {
      return;
    }
    if (event.kind === "status") {
      this.handlers.onStatus(event.job);
    } else {
      this.handlers.onProgress(event.job, event.progress);
    }
  }
}

/**
 * Follows a command's job and logs its start and progress the way `scrape` and
 * `refresh` report them, e.g. `🚀 Scraping react v18...` and
 * `📄 Scraping react v18: 3/10 pages`.
 *
 * @param eventBus The bus the job's events arrive on.
 * @param verb The activity the lines name.
 * @returns The follower; call `follow()` with the job's id and `dispose()` when done.
 */
export function followJobLogs(
  eventBus: EventBusService,
  verb: "Scraping" | "Refreshing",
): JobOutputFollower {
  const label = (job: PipelineJob) =>
    `${job.library}${job.version ? ` v${job.version}` : ""}`;
  return new JobOutputFollower(eventBus, {
    onStatus: (job) => {
      if (job.status === PipelineJobStatus.RUNNING) {
        logger.info(`🚀 ${verb} ${label(job)}...`);
      }
    },
    onProgress: (job, progress) => {
      logger.info(
        `📄 ${verb} ${label(job)}: ${progress.pagesScraped}/${progress.totalPages} pages`,
      );
    },
  });
}
