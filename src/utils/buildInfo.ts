import packageJson from "../../package.json";

/**
 * Returns the application version from the build or the runtime package metadata.
 */
export function getAppVersion(): string {
  if (typeof __APP_VERSION__ !== "undefined") {
    return __APP_VERSION__;
  }

  return process.env.APP_VERSION || packageJson.version;
}

/**
 * Returns the PostHog API key from the build or the runtime environment.
 */
export function getPostHogApiKey(): string {
  if (typeof __POSTHOG_API_KEY__ !== "undefined") {
    return __POSTHOG_API_KEY__;
  }

  return process.env.POSTHOG_API_KEY ?? "";
}
