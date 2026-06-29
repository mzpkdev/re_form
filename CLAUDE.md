# hublinator

React 19 + Vite app that builds a 3D widget via manifold-3d (CSG over WASM) and renders it with three.js. TanStack Query drives the async geometry build.

## Commands

- `bun run dev` — Vite dev server
- `bun run build` — typecheck (`tsgo`) then production build
- `bun run typecheck` — types only
- `bun test` — test runner (`*.spec.ts`)
- `bun run lint:fix` — Biome lint + format; it owns all formatting, so don't hand-format

## Structure

- **Feature modules live in `src/modules/<feature>`** — one folder per chunk of functionality (`assistant`, `shuffle`, `viewer`), each a vertical slice owning its UI *and* its feature-specific logic (e.g. `assistant` owns `openrouter` + `useApiConfig`). Each module has an `index.ts` barrel as its public entry point — scan those to see what a module exposes. Cross-module and shell code import from the barrel (`modules/assistant`), never deep paths.
- **`src/lib`** — *shared* React-free domain logic used across modules (the manifold pipeline: `manifold`, `model`, `modelStore`, `stl`, `validate`, `geometry`). If logic is used by only one module, it belongs in that module, not here.
- **`src/components`** — app-shell chrome shared across views (`TopBar`, `Sidebar`); `src/design` — headless UI kit (`cn`, Ark UI wrappers). `App.tsx`/`main.tsx` wire the shell to the modules.

## Conventions

- **Components**: arrow functions, named exports only (no `default`). Type props inline. Data hooks are `useX` wrapping `useQuery`.
- **Domain logic is React-free** — three.js types are the interop boundary (`toBufferGeometry`). Classes use a `private constructor` + static factory (see `Widget.build`).
- **Imports**: `import type` for type-only imports (`verbatimModuleSyntax` is on — mixed imports won't compile). `import * as THREE from "three"`.
- **Free what you allocate** — the easy bug in this codebase:
  - manifold: `.delete()` every intermediate `Manifold`/`CrossSection`; `Widget.build` deletes all handles before returning.
  - three.js: dispose renderer/geometry/material and cancel the RAF in `useEffect` cleanup.
- **Styling**: Tailwind v4 utilities inline in JSX. No arbitrary values (`bg-[#0b0e14]`) — define design tokens in the `@theme` block of `src/index.css` and use the generated utilities (`bg-surface`). Ark UI is headless — style its parts with those tokens. Use `react-virtuoso` for long/scrolling lists.
- **Tests**: colocated `*.spec.ts`, `bun:test`, `describe`/`context`/`it`; assert behavior, not internals.
