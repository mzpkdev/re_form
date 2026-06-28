# VERTEX CORE — design reference

An **isolated, zero-build sandbox** for prototyping the VERTEX CORE design system fast.
Pure HTML + CSS — no dependencies, no bundler, no framework. It is intentionally **not**
part of the `hublinator` app build (that's React + Vite + Tailwind v4); open the `.html`
files straight in a browser.

There will be more than one HTML file. They all share **one design system in `index.css`** —
keep reusable styling there, not inline per page.

## How it's wired

Every page links two stylesheets, in this order:

1. **LiteWind** (CDN) — a stripped-back Tailwind: the generic utilities (`flex`, `grid`,
   spacing scale, `transition-*`, the default palette…). No build, no config.
2. **`index.css`** — the shared design system: the `:root` tokens plus every class
   LiteWind's stripped build doesn't ship.

`index.css` loads **last on purpose** — so the design-system layer wins any conflict
(e.g. our `font-bold`, `transform`, and MD3 colors override LiteWind's).

Paste this `<head>` block into any new page:

```html
<!-- fonts -->
<link href="https://fonts.googleapis.com" rel="preconnect">
<link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet">

<!-- base utilities, then the design system (order matters) -->
<link href="https://cdn.jsdelivr.net/gh/reallygoodsoftware/tailwind-lite@9327a589cd1273e85ed2e609727dd8bca919cd54/dist/2.0.1.css" rel="stylesheet">
<link href="./index.css" rel="stylesheet">
```

## `index.css` is the design system — centralize here

One file, shared by every page. It has two parts:

- **`:root` tokens** — the source of truth: MD3 colors, font stacks, layout rails
  (`--sidebar-width`, `--toolbar-width`…), and component primitives (`--chamfer-size`,
  `--grid-cell`).
- **Custom utility classes** — everything LiteWind omits, built from those tokens: the MD3
  color utilities + opacity modifiers (`bg-surface/80`), named rails (`w-sidebar-width`),
  the type scale (`text-title-md`, `font-mono-data`…), `backdrop-blur-*`, `drop-shadow-2xl`,
  and the cyber bits (`chamfer`, `chamfer-tr`, `bg-3d-grid`).

**Rule of thumb:** a value reused anywhere becomes a `:root` token; a class used on more than
one element or page lives in `index.css`. Keep pages thin — they should *compose* the system,
not redefine it.

## Adding a page

1. Create `your-page.html` and paste the `<head>` block above.
2. Build the UI with LiteWind utilities + the design-system classes.
3. Need a class LiteWind doesn't have? Add it **once** to `index.css`, reusing a token —
   then it's available to every page.

## Preview

Open any `.html` file directly in a browser. No server, no build. Needs network for the
LiteWind CDN, Google Fonts, and the remote mock images.

## The trade-off

LiteWind is a **fixed** utility set — no theme config, no build, no purge step. New custom
classes don't exist until you hand-add them to `index.css`. That's the cost of staying
build-free; the `:root` tokens make each addition a one-liner, and centralizing them keeps
every page consistent as the set grows.
