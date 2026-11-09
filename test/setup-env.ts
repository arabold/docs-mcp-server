import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, vi } from 'vitest'

// Without an explicit store path, the app (and every CLI a test spawns, which
// inherits this environment) opens the developer's real store and migrates it.
// Each test file gets its own throwaway path instead, overriding any value from
// the shell. It is only created if something opens it, and removed after the
// file's last hook. Tests that need a store still pass one of their own.
const fallbackStorePath = path.join(tmpdir(), `docs-mcp-server-test-store-${randomUUID()}`)
process.env.DOCS_MCP_STORE_PATH = fallbackStorePath
afterAll(() => {
  rmSync(fallbackStorePath, { recursive: true, force: true })
})

// Globally auto-mock the logger so all tests get vi.fn() spies for logger.*
// methods (needed for `expect(logger.x).toHaveBeenCalled(...)` assertions).
// Runtime output is already silenced separately by `silent: 'passed-only'`
// in vite.config.ts and the logger's built-in VITEST_WORKER_ID check.
vi.mock('../src/utils/logger')

// Mock localStorage
const localStorageMock = (function() {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString()
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    length: 0,
    key: vi.fn((index: number) => "")
  }
})()

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock
})
