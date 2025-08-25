/**
 * Session context tracker for telemetry.
 * Manages session context and enriches event properties with session data.
 */

import type { SessionContext } from "./SessionContext";

/**
 * Session context tracker for telemetry
 */
export class SessionTracker {
  private sessionContext?: SessionContext;

  /**
   * Start a new session with context
   */
  startSession(context: SessionContext): void {
    this.sessionContext = context;
  }

  /**
   * End current session and return duration
   */
  endSession(): { duration: number; appInterface?: string } | null {
    if (!this.sessionContext) return null;

    const duration = Date.now() - this.sessionContext.startTime.getTime();
    const sessionInterface = this.sessionContext.appInterface;

    // Clear session context
    this.sessionContext = undefined;

    return { duration, appInterface: sessionInterface };
  }

  /**
   * Get current session context
   */
  getSessionContext(): SessionContext | undefined {
    return this.sessionContext;
  }

  /**
   * Update session context with additional fields
   */
  updateSessionContext(updates: Partial<SessionContext>): void {
    if (this.sessionContext) {
      this.sessionContext = { ...this.sessionContext, ...updates };
    }
  }

  /**
   * Get enriched properties with minimal session context
   * Only includes sessionId and timestamp - other properties are handled explicitly per event
   */
  getEnrichedProperties(
    properties: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      // Only include sessionId for correlation
      ...(this.sessionContext && { sessionId: this.sessionContext.sessionId }),
      ...properties,
      timestamp: new Date().toISOString(),
    };
  }
}
