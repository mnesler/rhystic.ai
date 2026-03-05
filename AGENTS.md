# AGENTS.md - Rhystic AI Development Guide

This file provides guidelines for agentic coding agents working on this codebase.

## Project Overview

- **Type**: MTG Commander AI Assistant (web application)
- **Stack**: Express + TypeScript (backend), SolidJS + Vite (frontend in separate repo)
- **Database**: PostgreSQL (Cloud SQL) with pg driver
- **Testing**: Vitest
- **Deployment**: Google Cloud Run

## Build & Test Commands

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build              # Runs: tsc -p backend/tsconfig.json

# Run all tests
npm test                  # Runs: vitest run

# Run tests in watch mode
npm run test:watch        # Runs: vitest

# Run a single test file
npx vitest run backend/src/assistant/auth.test.ts

# Run tests matching a pattern
npx vitest run --testNamePattern "JWT Token"

# Type check only (without building)
npx tsc --noEmit
```

## Code Style Guidelines

### General Principles
- Write clean, readable code with descriptive names
- Keep functions small and focused (single responsibility)
- Use TypeScript strict mode - no `any` without explanation
- Prefer explicit over implicit

### TypeScript Configuration
- Target: ES2022
- Module system: NodeNext (ES modules)
- Strict mode enabled
- Always use explicit return types for exported functions

### Naming Conventions
```typescript
// Variables and functions: camelCase
const userName = "test";
function getUserById(id: string): User | null { ... }

// Types and interfaces: PascalCase
interface UserProfile { ... }
type ResponseMode = "succinct" | "verbose" | "gooper";

// Constants: SCREAMING_SNAKE_CASE
const MAX_RETRY_COUNT = 3;
const DEFAULT_PORT = 3002;

// Files: kebab-case (e.g., auth.test.ts, moxfield.ts)
```

### Imports & Exports
- Use `.js` extension in imports (required for NodeNext module resolution)
- Use named exports for public APIs
- Group imports: external libs → internal modules → types

```typescript
// ✓ Correct
import express from "express";
import cors from "cors";
import { initDatabase, query } from "../db/client.js";
import type { Intent } from "./intent.js";

// ✗ Avoid
import * as db from "../db/client.js";
```

### Error Handling
- Use try/catch for async operations
- Throw descriptive errors
- Handle errors at appropriate levels

```typescript
// ✓ Correct
try {
  await _pool.query("SELECT 1");
} catch (err) {
  console.error("Failed to connect to PostgreSQL:", err);
  throw err;
}

// ✓ With null coalescing
const port = parseInt(process.env.PORT ?? "3002");

// ✗ Avoid silent failures
if (result.rows[0]) return result.rows[0];
return null; // Should use explicit return type
```

### Comments & Documentation
- Use JSDoc for public APIs and complex functions
- File-level comments explaining purpose
- Inline comments for non-obvious decisions

```typescript
/**
 * Multi-turn conversation session management.
 *
 * Sessions are held in memory — they don't survive server restarts.
 * Each session stores the full message history so the LLM has context
 * for follow-up questions.
 */
export interface Session { ... }
```

### Code Organization
- One export per line in grouped exports
- Use separator comments for logical sections
- Keep related code together

```typescript
// ── Types ─────────────────────────────────────────────────────────────────────
export interface Session { ... }

// ── Store ─────────────────────────────────────────────────────────────────────
const sessions = new Map<string, Session>();

// ── Main ──────────────────────────────────────────────────────────────────────
export async function main(): Promise<void> { ... }
```

## Testing Guidelines

- Test files: `*.test.ts` in same directory as source
- Use Vitest with `describe`/`it` blocks
- Include descriptive test names: "should <expected behavior>"
- Mock external dependencies

```typescript
describe("Auth", () => {
  describe("JWT Token", () => {
    it("should generate a valid JWT token", () => { ... });
  });
});
```

## Environment & Configuration

- Use `dotenv` for local development
- Environment variables in `backend/.env`
- Required env vars documented in `backend/.env.example`

```bash
NODE_ENV=development  # or production
PORT=3002
DATABASE_URL=postgresql://...
```

## Git Conventions

- Use conventional commits: `feat(core): add new feature`
- Branch naming: `feature/description` or `fix/description`
- All changes via PRs to main

## Common Development Tasks

```bash
# Run dev server
npm run dev

# Run backend CLI
npm run assistant "Your question here"

# Start backend with specific port
PORT=3002 npm run dev

# Run specific ingest script
npm run ingest:scryfall
```

## Cloud & Deployment

- Deployment via GitHub Actions (see `.github/workflows/`)
- Backend: `mtg-backend` / `mtg-backend-preprod`
- Frontend: `mtg-frontend` / `mtg-frontend-preprod`
- Database: Cloud SQL PostgreSQL `maxtory-db`
- Never deploy from local machine - use CI/CD pipelines
