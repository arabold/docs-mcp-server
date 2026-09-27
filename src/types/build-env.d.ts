/**
 * Build-time environment variable declarations.
 * Vite injects these during builds; Bun source execution uses runtime fallbacks.
 */

declare const __POSTHOG_API_KEY__: string | undefined;
declare const __APP_VERSION__: string | undefined;
