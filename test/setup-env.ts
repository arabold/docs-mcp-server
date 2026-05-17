import { vi } from 'vitest'

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
