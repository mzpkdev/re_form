# hublinator

React 19 + Vite app that builds a 3D widget via manifold-3d (CSG over WASM) and renders it with three.js. TanStack Query drives the async geometry build.

## Commands

- `bun run dev` — Vite dev server
- `bun run build` — typecheck (`tsgo`) then production build
- `bun run typecheck` — types only
- `bun test` — test runner (`*.spec.ts`)
- `bun run lint:fix` — Biome lint + format; it owns all formatting, so don't hand-format

## Conventions

- **Components**: arrow functions, named exports only (no `default`). Type props inline. Data hooks are `useX` wrapping `useQuery`.
- **Domain logic lives in `src/lib`** — React-free; three.js types are the interop boundary (`toBufferGeometry`). Classes use a `private constructor` + static factory (see `Widget.build`).
- **Imports**: `import type` for type-only imports (`verbatimModuleSyntax` is on — mixed imports won't compile). `import * as THREE from "three"`.
- **Free what you allocate** — the easy bug in this codebase:
  - manifold: `.delete()` every intermediate `Manifold`/`CrossSection`; `Widget.build` deletes all handles before returning.
  - three.js: dispose renderer/geometry/material and cancel the RAF in `useEffect` cleanup.
- **Styling**: Tailwind v4 utilities inline in JSX. No arbitrary values (`bg-[#0b0e14]`) — define design tokens in the `@theme` block of `src/index.css` and use the generated utilities (`bg-surface`). Ark UI is headless — style its parts with those tokens. Use `react-virtuoso` for long/scrolling lists.
- **Tests**: colocated `*.spec.ts`, `bun:test`, `describe`/`context`/`it`; assert behavior, not internals.
