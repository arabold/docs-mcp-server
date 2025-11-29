/**
 * SSE (Server-Sent Events) endpoint for real-time updates.
 * Clients connect to this endpoint to receive live updates about jobs and libraries.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EventBusService } from "../../events/EventBusService";
import {
  type EventPayloads,
  EventType,
  ServerEventName,
  type SseEventPayloads,
} from "../../events/types";
import type { PipelineJob } from "../../pipeline/types";
import type { ScraperProgressEvent } from "../../scraper/types";
import { logger } from "../../utils/logger";

/**
 * Convert internal event payload to SSE payload format.
 */
function convertToSsePayload(
  eventType: EventType,
  payload: EventPayloads[EventType],
): SseEventPayloads[keyof SseEventPayloads] {
  switch (eventType) {
    case EventType.JOB_STATUS_CHANGE: {
      const job = payload as PipelineJob;
      return {
        id: job.id,
        library: job.library,
        version: job.version,
        status: job.status,
        error: job.error,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
        sourceUrl: job.sourceUrl,
      } satisfies SseEventPayloads["job-status-change"];
    }

    case EventType.JOB_PROGRESS: {
      const { job, progress } = payload as {
        job: PipelineJob;
        progress: ScraperProgressEvent;
      };
      return {
        id: job.id,
        library: job.library,
        version: job.version,
        progress: {
          pagesScraped: progress.pagesScraped,
          totalPages: progress.totalPages,
          totalDiscovered: progress.totalDiscovered,
          currentUrl: progress.currentUrl,
          depth: progress.depth,
          maxDepth: progress.maxDepth,
        },
      } satisfies SseEventPayloads["job-progress"];
    }

    case EventType.LIBRARY_CHANGE: {
      return {} satisfies SseEventPayloads["library-change"];
    }

    case EventType.JOB_LIST_CHANGE: {
      return {} satisfies SseEventPayloads["job-list-change"];
    }

    default: {
      // TypeScript ensures this is unreachable if all cases are handled
      const _exhaustive: never = eventType;
      throw new Error(`Unhandled event type: ${_exhaustive}`);
    }
  }
}

/**
 * Send an SSE message to the client.
 */
function sendSseMessage(reply: FastifyReply, eventName: string, data: unknown): boolean {
  try {
    const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    reply.raw.write(message);
    return true;
  } catch (error) {
    logger.error(`❌ Failed to send SSE event: ${error}`);
    return false;
  }
}

/**
 * Registers the SSE events route.
 * @param server - The Fastify instance.
 * @param eventBus - The central event bus service instance.
 */
export function registerEventsRoute(
  server: FastifyInstance,
  eventBus: EventBusService,
): void {
  server.get("/web/events", async (request: FastifyRequest, reply: FastifyReply) => {
    // Set headers for SSE
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable buffering in nginx
    });

    // Send initial connection message
    reply.raw.write("data: connected\n\n");
    logger.debug("SSE client connected");

    // Subscribe to all event types using a generic handler
    const allEventTypes = [
      EventType.JOB_STATUS_CHANGE,
      EventType.JOB_PROGRESS,
      EventType.LIBRARY_CHANGE,
      EventType.JOB_LIST_CHANGE,
    ] as const;

    const unsubscribers: (() => void)[] = [];

    for (const eventType of allEventTypes) {
      const unsubscribe = eventBus.on(eventType, (payload) => {
        try {
          const eventName = ServerEventName[eventType];
          const ssePayload = convertToSsePayload(eventType, payload);
          logger.debug(
            `SSE forwarding event: ${eventName} ${JSON.stringify(ssePayload)}`,
          );
          sendSseMessage(reply, eventName, ssePayload);
        } catch (error) {
          logger.error(`❌ Failed to convert/send SSE event ${eventType}: ${error}`);
        }
      });

      unsubscribers.push(unsubscribe);
      logger.debug(`SSE listener registered for: ${ServerEventName[eventType]}`);
    }

    // Cleanup function to unsubscribe from all events
    const cleanup = () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };

    // Send periodic heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      try {
        reply.raw.write(": heartbeat\n\n");
      } catch (_error) {
        logger.debug("Failed to send heartbeat, client likely disconnected");
        clearInterval(heartbeatInterval);
      }
    }, 30_000); // Every 30 seconds

    // Clean up when client disconnects
    request.raw.on("close", () => {
      logger.debug("SSE client disconnected");
      cleanup();
      clearInterval(heartbeatInterval);
    });

    // Handle errors
    request.raw.on("error", (error) => {
      // This may happen when the client disconnects abruptly, the page is reloaded, etc.
      logger.debug(`SSE connection error: ${error}`);
      cleanup();
      clearInterval(heartbeatInterval);
    });
  });
}
