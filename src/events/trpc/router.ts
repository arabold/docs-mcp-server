/**
 * tRPC router for event subscriptions.
 * Allows remote processes to subscribe to application events via tRPC.
 */

import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import superjson from "superjson";
import { z } from "zod";
import type { EventBusService } from "../EventBusService";
import { EventType } from "../types";

// Context carries the event bus instance
export interface EventsTrpcContext {
  eventBus: EventBusService;
}

const t = initTRPC.context<EventsTrpcContext>().create({
  transformer: superjson,
});

/**
 * Factory to create an events router from any t instance whose context contains `eventBus`.
 */
export function createEventsRouter(trpc: unknown) {
  const tt = trpc as typeof t;

  return tt.router({
    /**
     * Subscribe to all application events.
     * Clients receive a stream of events as they occur.
     */
    subscribe: tt.procedure
      .input(
        z
          .object({
            events: z.array(z.nativeEnum(EventType)).optional(),
          })
          .optional(),
      )
      .subscription(({ ctx, input }) => {
        // Determine which events to subscribe to (default: all)
        const eventTypes = input?.events ?? Object.values(EventType);

        return observable<{
          type: EventType;
          payload: unknown;
        }>((emit) => {
          const unsubscribers: Array<() => void> = [];

          // Subscribe to each requested event type
          for (const eventType of eventTypes) {
            const unsubscribe = ctx.eventBus.on(eventType, (payload) => {
              // EventBus already emits public types (PipelineJob), no conversion needed
              emit.next({
                type: eventType,
                payload,
              });
            });

            unsubscribers.push(unsubscribe);
          }

          // Cleanup function called when client disconnects
          return () => {
            for (const unsubscribe of unsubscribers) {
              unsubscribe();
            }
          };
        });
      }),
  });
}

// Default router for standalone usage
export const eventsRouter = createEventsRouter(t);
export type EventsRouter = typeof eventsRouter;
