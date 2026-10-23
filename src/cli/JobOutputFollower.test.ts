import { beforeEach, describe, expect, it } from "vitest";
import { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import { type PipelineJob, PipelineJobStatus } from "../pipeline/types";
import type { ScraperProgressEvent } from "../scraper/types";
import { JobOutputFollower } from "./JobOutputFollower";

function job(id: string, status = PipelineJobStatus.RUNNING): PipelineJob {
  return { id, library: id, version: null, status } as PipelineJob;
}

const progress = { pagesScraped: 1, totalPages: 3 } as ScraperProgressEvent;

describe("JobOutputFollower", () => {
  let eventBus: EventBusService;
  let seen: string[];
  let follower: JobOutputFollower;

  beforeEach(() => {
    eventBus = new EventBusService();
    seen = [];
    follower = new JobOutputFollower(eventBus, {
      onStatus: (j) => seen.push(`${j.id}:${j.status}`),
      onProgress: (j, p) => seen.push(`${j.id}:${p.pagesScraped}/${p.totalPages}`),
    });
  });

  it("replays the followed job's events that arrived before its id was known, in order", () => {
    eventBus.emit(EventType.JOB_STATUS_CHANGE, job("mine"));
    eventBus.emit(EventType.JOB_PROGRESS, { job: job("mine"), progress });

    follower.follow("mine");

    expect(seen).toEqual(["mine:running", "mine:1/3"]);
  });

  it("delivers nothing after it is disposed", () => {
    follower.follow("mine");
    follower.dispose();
    follower.dispose();

    eventBus.emit(EventType.JOB_STATUS_CHANGE, job("mine"));

    expect(seen).toEqual([]);
  });
});
