// Loaded by every vitest test (configured via vite.config.ts test.setupFiles).
// Brings in @testing-library/jest-dom matchers (toBeInTheDocument,
// toHaveTextContent, etc.) so the existing pure-function tests don't have
// to import them per-file and the new jsdom-using tests can use them
// without ceremony.
import '@testing-library/jest-dom/vitest'
