/**
 * Default exclusion patterns for documentation scraping.
 * These patterns are always applied unless user explicitly provides their own exclude patterns.
 * Patterns use glob/regex syntax supported by the pattern matcher.
 */

/**
 * Default file exclusion patterns - files commonly found in documentation that should be excluded.
 * These patterns match files anywhere in the path structure.
 */
export const DEFAULT_FILE_EXCLUSIONS = [
  // CHANGELOG files (case variations)
  "**/CHANGELOG.md",
  "**/changelog.md",
  "**/CHANGELOG.mdx",
  "**/changelog.mdx",

  // LICENSE files (case variations)
  "**/LICENSE",
  "**/LICENSE.md",
  "**/license.md",

  // CODE_OF_CONDUCT files (case variations)
  "**/CODE_OF_CONDUCT.md",
  "**/code_of_conduct.md",

  // Test files
  "**/*.test.*",
  "**/*.spec.*",
  "**/*_test.py",
  "**/*_test.go",

  // Package manager lock files
  "**/*.lock",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/go.sum",

  // Build artifacts
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.d.ts",

  // IDE/System files
  "**/.DS_Store",
  "**/Thumbs.db",
  "**/*.swp",
  "**/*.swo",

  // Internal config files (using regex pattern)
  "/.*\\.(ini|cfg|conf|log|pid)$/",
];

/**
 * Default folder/path exclusion patterns - directories commonly found in documentation that should be excluded.
 */
export const DEFAULT_FOLDER_EXCLUSIONS = [
  // Archive and deprecated content (matches anywhere in path)
  "**/archive/**",
  "**/archived/**",
  "**/deprecated/**",
  "**/legacy/**",
  "**/old/**",
  "**/outdated/**",
  "**/previous/**",
  "**/superseded/**",

  // Specific paths that don't follow the general pattern
  "docs/old/**",

  // Test directories
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/spec/**",

  // Build output directories
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/target/**",
  "**/.next/**",
  "**/.nuxt/**",

  // IDE directories
  "**/.vscode/**",
  "**/.idea/**",

  // Internationalization folders - non-English locales
  "**/i18n/ar*/**",
  "**/i18n/de*/**",
  "**/i18n/es*/**",
  "**/i18n/fr*/**",
  "**/i18n/hi*/**",
  "**/i18n/it*/**",
  "**/i18n/ja*/**",
  "**/i18n/ko*/**",
  "**/i18n/nl*/**",
  "**/i18n/pl*/**",
  "**/i18n/pt*/**",
  "**/i18n/ru*/**",
  "**/i18n/sv*/**",
  "**/i18n/th*/**",
  "**/i18n/tr*/**",
  "**/i18n/vi*/**",
  "**/i18n/zh*/**",

  // Common locale folder patterns
  "**/zh-cn/**",
  "**/zh-hk/**",
  "**/zh-mo/**",
  "**/zh-sg/**",
  "**/zh-tw/**",
];

/**
 * Combined default exclusion patterns (files + folders).
 * These are applied when no user-provided exclude patterns are specified.
 */
export const DEFAULT_EXCLUSION_PATTERNS = [
  ...DEFAULT_FILE_EXCLUSIONS,
  ...DEFAULT_FOLDER_EXCLUSIONS,
];

/**
 * Get effective exclusion patterns by merging defaults with user patterns.
 * If user provides patterns, use only theirs (allowing override).
 * If user provides no patterns, use defaults.
 */
export function getEffectiveExclusionPatterns(userPatterns?: string[]): string[] {
  // If user explicitly provides patterns (even empty array), respect their choice
  if (userPatterns !== undefined) {
    return userPatterns;
  }

  // Otherwise, use default patterns
  return DEFAULT_EXCLUSION_PATTERNS;
}
