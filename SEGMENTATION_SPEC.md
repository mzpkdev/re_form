# Shape Segmentation — Technical Spec

Split an imported CAD-like STL mesh into editable **shape groups** (faces, holes,
bodies) so a user can select, recolor, rename, delete, and eventually
parametrically edit each one. This document defines the expected behaviours, the
chosen approach, the data model, and a phased implementation plan.

Status: **proposed**. Author: segmentation feature spike. Audience: implementers.

---

## 1. Problem & motivation

An STL file is a **triangle soup**: a flat list of triangles with no topology, no
layers, no named features, and no record of the CAD feature tree that produced it.
`parseStl` (`src/lib/stl.ts:72`) returns exactly that — a non-indexed
`THREE.BufferGeometry` with duplicated vertices at shared edges. There is **no
stored "logical group"** to read. The only per-triangle metadata slot in binary STL
is a 16-bit attribute word that `STLLoader` discards and that is almost always zero.

Therefore every logical group must be **re-derived from geometry**. This spec covers
how, and what the user gets at each level of effort.

### 1.1 Goals

**Primary use case (confirmed):** input is **clean machined CAD-export STL**; the user
wants to **split the part into shape groups and export each group as its own STL file.**
Parametric dimensional editing is *not* a goal.

- Turn one imported STL into a set of **selectable, nameable, colorable groups**.
- Guarantee **complete coverage**: every triangle belongs to exactly one group.
- **Export** any group (or a multi-selection of groups) as its own binary STL via the
  existing `exportStl` (`src/lib/stl.ts:99`).
- Keep all segmentation logic **React-free** (three.js / manifold types are the only
  interop boundary), matching the project's domain-logic convention.

### 1.2 Non-goals

- **Parametric dimensional editing** (change a hole's radius and rebuild the solid).
  Explicitly out of scope per the confirmed use case — the goal is splitting/export,
  not feature editing.
- Full STL→parametric-CAD reconstruction (BREP rebuild). The hard reverse-engineering
  problem desktop tools (Geomagic, QUICKSURFACE) solve with a human in the loop.
- Organic / freeform / scanned meshes. This targets **non-organic, prismatic CAD-like
  parts** (planes, holes, bosses, chamfers).
- Watertight per-shape solids. Exported region patches are **open surfaces** (valid STL,
  not sealed bodies); capping into solids is out of scope (see §9 M2 caveat). Bodies from
  Tier 1 `decompose` *are* closed solids.

### 1.3 User stories / expected behaviours

1. *Import an STL → it splits into separate bodies I can click and isolate.* (M1)
2. *I export a selected body as its own STL file.* (M1)
3. *Within one body, each face/region is its own selectable group; clicking a face
   highlights just that face; I can multi-select regions, rename, and recolor.* (M2)
4. *I export a face region — or a multi-selection of regions — as one STL file.* (M2)
5. *Primitive recognition labels groups as "cylinder"/"plane" and merges a cylinder
   wall+cap into one logical shape (optional convenience).* (M3, optional)

---

## 2. Approach overview

A **layered (tiered)** pipeline. Cheap, dependency-free tiers ship first and already
deliver selectable groups; parametric primitive fitting is layered on top.

```
Imported STL  ──parseStl──▶  BufferGeometry (triangle soup)
                                   │
   ┌───────────────────────────────┼─────────────────────────────────────┐
   │ TIER 1  Bodies                 │  separate connected solids           │
   │   Manifold.decompose() (if manifold) OR mesh union-find (fallback)    │
   ├───────────────────────────────┼─────────────────────────────────────┤
   │ TIER 2  Faces / patches        │  dihedral-angle region growing       │
   │   split a body into smooth regions bounded by sharp creases           │
   ├───────────────────────────────┼─────────────────────────────────────┤
   │ TIER 3  Parametric primitives  │  own normal-based RANSAC             │
   │   plane / cylinder / sphere / cone  + fitted parameters               │
   └───────────────────────────────┴─────────────────────────────────────┘
                                   │
                          ShapeGroup[]  (every triangle in exactly one group)
                                   │
                          Parametric rebuild via manifold-3d (TIER 3 params)
```

Each tier is **independently useful**:

| Tier | What the user gets | Editing power | Deps |
|---|---|---|---|
| 1 Bodies | separate solids, selectable | move/recolor/delete a whole body | none (native `decompose`) |
| 2 Faces/patches | every face a selectable region | move/recolor/delete a face region | none (pure TS) |
| 3 Primitives | named shapes with radius/axis/normal | **change radius, offset a plane** | none (own RANSAC) |

---

## 3. Library decision (and why not pcl.js for the core)

We evaluated `pcl.js` (WASM port of the Point Cloud Library) as the primitive-fitting
engine. **It is insufficient as the core engine**, for one decisive reason and several
practical ones:

- **Decisive: no cylinder/cone fitting.** `pcl.js`'s `SACSegmentation` is `PointXYZ`-only
  and **force-drops normals** (`setInputCloud` → `toXYZPointCloud`). There is **no
  `SACSegmentationFromNormals`** and **no `setNormalDistanceWeight`** in the shipped
  API. Cylinder and cone fits in PCL require the normals path, so they are **not
  usable**. Reliable models are limited to **plane and sphere**. Holes — the single
  most important CAD feature — are cylinders, so this disqualifies pcl.js as the core.
- No `ExtractIndices` → the extract-inliers-and-repeat loop must be hand-rolled in JS.
- No `EuclideanClusterExtraction` → no built-in connected-components on points.
- ~2.93 MiB `pcl-core.wasm`, single-threaded (must run in a Web Worker to avoid
  blocking the UI), manual `.manager.delete()` on every wrapper, per-point `addPoint`
  ingest (N embind crossings).
- The upstream repo is **archived / read-only since 2023** — frozen forever.

**Decision:** implement a small, focused **own RANSAC** in TypeScript (Tier 3). With
oriented points (positions + normals) the closed-form primitive constructions are
compact (plane = 1 oriented point, cylinder = 2 via axis `n₁ × n₂`, sphere = 2,
cone = 3; Schnabel et al. 2007). This gives us cylinders and cones, the
normal-deviation inlier test, no 2.93 MiB wasm, and no archived dependency.

- **Tier 1** uses **`Manifold.decompose()`** (`manifold.d.ts:1042`) — already in the
  bundle — for the body split, with a mesh-topology union-find fallback for
  non-manifold STLs.
- **Least-squares refit** of fitted primitives uses `ml-levenberg-marquardt`
  (maintained, MIT) for sphere/cylinder/cone, and PCA (covariance eigenvector) for
  planes. `ml-matrix` (MIT) supplies the SVD/eigendecomposition.
- **pcl.js is optional** (M5): a plane/sphere cross-check or alternative backend, never
  on the critical path. If added, it loads in a Web Worker with an explicit Vite
  `?url` wasm asset.

> If a future need for editable fillets (tori) or very large point clouds arises and
> own RANSAC proves inadequate, the fallback is a server-side CGAL/Open3D microservice
> (best quality, full primitive set) — explicitly out of scope here.

---

## 4. Architecture & integration

New feature module **`src/modules/segment`** (one-folder-per-feature rule), with an
`index.ts` barrel as its public entry. Wiring mirrors the existing `mesh-tools`
module exactly.

### 4.1 Files (proposed)

```
src/modules/segment/
  index.ts              # barrel: SegmentPanel, useSegmentation, types
  mesh.ts               # React-free: weld, adjacency, face normals, bbox diagonal D
  sample.ts             # React-free: oriented point cloud + point→triangle backmap
  ransac.ts             # React-free: own Efficient-RANSAC (plane/cyl/sphere/cone)
  fit.ts                # React-free: closed-form constructors + LS refit
  regionGrow.ts         # React-free: tier-2 dihedral region growing
  decompose.ts          # React-free: Manifold.decompose + union-find fallback
  segment.ts            # React-free: orchestrates tiers → Segmentation
  rebuild.ts            # React-free: ShapeGroup params → manifold-3d geometry
  groupsStore.ts        # store: ShapeGroup[] + disposal discipline
  selectionStore.ts     # store: selection: string[] (copy of editorStore idiom)
  SegmentPanel.tsx      # UI: groups list (react-virtuoso) + tuning sliders
  *.spec.ts             # colocated bun:test specs
```

### 4.2 What it depends on (shared `src/lib`)

- `manifold` — `initManifold()` (`src/lib/manifold.ts:8`), memoized WASM singleton.
- `modelStore` — `getManifold()` / `useModelVersion()` as the source solid
  (`src/lib/modelStore.ts`); it is the single owner of the live handle's lifetime
  (delete-on-replace + version counter).
- `model` — `meshToBufferGeometry` (`src/lib/model.ts:13`) to bake each group's
  geometry; `geometryToManifold` (`:37`) which welds **by position only** and throws
  `"mesh is not manifold"` on failure (drives the Tier-1 fallback decision).
- `validate` — `assertValidSolid` for rebuilt primitives.

### 4.3 Where each piece plugs in

- **Source geometry.** The user STL import path already exists and is separate from the
  generated `Widget`: `TopBar.tsx` hidden file input (⌘I) → `App.tsx` `setStlFile` →
  `<Viewport file={stlFile}>`. Segmentation consumes either the parsed
  `BufferGeometry` (non-manifold fallback) or the `Manifold` in `modelStore`.
- **Rendering N selectable groups.** Today `Viewport.tsx` renders a **single** `meshRef`
  and has **no raycaster**. This is the one piece with no existing 3D analog and must be
  built: render an array of meshes (one per visible group, baked via
  `meshToBufferGeometry`), each with its own material (group color; highlight via the
  established selection hue). Add a `THREE.Raycaster` for click-picking → set selection.
  The N-item *render + click-select + key-delete* loop already exists in 2D in
  `src/modules/drawing/DrawingCanvas.tsx` — port its contract (return id, set
  selection set, Delete removes), not its SVG specifics.
- **Selection & groups state.** Copy the `useSyncExternalStore` singleton idiom from
  `src/modules/drawing/editorStore.ts` (`selection: string[]`, `setSelection` stores a
  fresh copy, `clearSelection`, `useSelection`). The groups store follows the
  `modelStore` idiom **including delete-on-replace discipline** because group rebuilds
  own disposable `Manifold` handles. If undo/redo on grouping is wanted, mirror
  `drawing/documentStore.ts` (immutable `present`, `commit` funnel, history cap 100).
- **Panel UI.** New `SegmentPanel.tsx` modeled on `mesh-tools/MeshToolsPanel.tsx`: a
  slide-in `<aside class="w-panel">` (360px) with header + `lucide-react` icon, an empty
  state keyed on `useModelVersion()`/`getManifold()`, a **`react-virtuoso`** groups list
  (dependency present, not yet used anywhere — this is its first use), and tuning
  controls. Add a `Sidebar.tsx` `NavItem` and extend the `App.tsx` `activePanel` union
  + the `Sidebar` `Panel` type with the new value.
- **Design kit.** Ark UI ships `slider`, `number-input`, and `color-picker` (installed,
  imported via `@ark-ui/react/<component>`), but none are wrapped yet. Add
  `src/design/slider.tsx` and `src/design/color-picker.tsx` following the 1:1-styled
  pattern of `dialog.tsx`/`checkbox.tsx`, and export from `src/design/index.ts`.
  Highlight color: reuse the existing selection token `--color-drawing-selected`
  (`#2f7fff`, `src/index.css:37`). Per-group swatch hues that need new colors go in the
  `@theme` block as `--color-*` tokens — **never** arbitrary `bg-[#…]`.

### 4.4 Boundaries & conventions

- All of `mesh/sample/ransac/fit/regionGrow/decompose/segment/rebuild` are **React-free**
  and pure; `THREE.BufferGeometry` and `Manifold`/`Mesh` are the only interop types.
- **Free what you allocate.** Every intermediate `Manifold`/`CrossSection` is
  `.delete()`d; the groups store deletes replaced/removed group handles. three.js
  geometries/materials are disposed when a group mesh is removed or the panel unmounts,
  and the RAF is cancelled in cleanup.
- `import type` for type-only imports; `import * as THREE from "three"`.

---

## 5. Data model

```ts
import type * as THREE from "three";

/** Discriminated by `kind`; only the matching params field is populated. */
export type ShapeKind =
  | "plane" | "cylinder" | "sphere" | "cone"
  | "patch"     // smooth region-grown surface, non-parametric (e.g. a fillet)
  | "body"      // whole-solid grouping from Tier 1 (optional container)
  | "unknown";  // leftover bucket — guarantees completeness

export interface PlaneParams {
  kind: "plane";
  normal: [number, number, number]; // unit
  offset: number;                   // d, with normal·x = offset
}
export interface CylinderParams {
  kind: "cylinder";
  axis: [number, number, number];   // unit direction
  point: [number, number, number];  // a point on the axis
  radius: number;
  axialRange?: [number, number];    // min/max inlier projection onto axis (extent)
}
export interface SphereParams {
  kind: "sphere";
  center: [number, number, number];
  radius: number;
}
export interface ConeParams {
  kind: "cone";
  apex: [number, number, number];
  axis: [number, number, number];   // unit, apex→base
  halfAngle: number;                // radians
  axialRange?: [number, number];
}
export type ShapeParams =
  | PlaneParams | CylinderParams | SphereParams | ConeParams
  | { kind: "patch" } | { kind: "body" } | { kind: "unknown" };

export interface ShapeGroup {
  id: string;                       // stable uuid
  kind: ShapeKind;
  label: string;                    // user-editable ("Top face", "Bore Ø8")
  color: [number, number, number];  // highlight rendering; assign distinct hues

  /** SOURCE OF TRUTH for membership; disjoint across groups; union = all faces. */
  triangleIndices: Int32Array;

  params: ShapeParams;               // fitted primitive, or patch/body/unknown
  fitRms?: number;                   // RMS point-to-surface distance over inliers
  inlierCount?: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  centroid?: [number, number, number];
  parentId?: string | null;          // body→feature hierarchy (optional)
}

export interface SegmentationParams {
  epsilon: number;        // distance inlier tolerance (absolute; derived from D)
  cosNormal: number;      // normal-deviation threshold, cos(α)
  minPoints: number;      // smallest acceptable primitive (inlier floor)
  probability: number;    // RANSAC miss-probability
  thetaCrease: number;    // sharp-edge dihedral threshold (rad)
  thetaGrow: number;      // region-grow smoothness threshold (rad)
  enabled: { plane: boolean; cylinder: boolean; sphere: boolean; cone: boolean };
  seed: number;           // RNG seed → deterministic results
}

export interface Segmentation {
  groups: ShapeGroup[];
  triangleCount: number;  // F; invariant: Σ group.triangleIndices.length === F
  params: SegmentationParams;
}
```

**Invariant (asserted in code and tests):** `triangleIndices` is the single membership
source of truth — disjoint across groups, union = `[0, F)`. Do **not** store an
authoritative point-index list; points are an internal RANSAC artifact that would
desync on edit.

---

## 6. Pipeline detail

### 6.0 Mesh preparation (`mesh.ts`)

1. **Weld** by position: `BufferGeometryUtils.mergeVertices(geometry, 1e-4 · D)` →
   indexed geometry (required for adjacency and area sampling). STL has split vertices.
2. **Face normals** `n_f = normalize((b−a) × (c−a))` per triangle. Use **flat face
   normals** (not smoothed vertex normals) everywhere downstream — the normal test must
   distinguish a flat face from a curved one.
3. **Bounding-box diagonal `D`** — the one scale-invariant length all tolerances are
   expressed against.
4. **Adjacency.** Build `edge→faces` then `face→faces`:
   - `edgeKey = min(v0,v1) · V + max(v0,v1)` (V = vertex count) into a `Map<number, …>`.
   - Manifold meshes give exactly 2 faces per edge; 1 or >2 = treat as a hard boundary.
   - O(F) time and space.
5. **Dihedral** across a shared edge: `θ = acos(clamp(n₁ · n₂, −1, 1))`. Edge is a
   **crease** iff `θ > thetaCrease`.

### 6.1 Point sampling (`sample.ts`)

Produce an oriented cloud `{ position[], normal[], pointToTri: Int32Array }`.

- **Default: triangle centroids**, 1 per triangle, with the exact face normal. The
  backmap is the identity (`pointToTri[i] = i`) — lossless and deterministic.
- **Supplement** big faces with extra **area-weighted** samples so a large flat face
  clears `minPoints`; target **1–3× triangle count**, capped at **~50–100k points**
  (subsample larger meshes).
- Use a **custom area-weighted sampler that returns the source triangle index** — the
  stock three.js `MeshSurfaceSampler` discards which face it sampled, and we need the
  backmap. (Cumulative-area CDF over faces; pick face ∝ area; uniform barycentric point.)

### 6.2 Tier 1 — bodies (`decompose.ts`)

- If the STL is manifold (`geometryToManifold` succeeds), `Manifold.decompose()` returns
  topologically-disconnected sub-manifolds → one `body` group each, bakeable via
  `meshToBufferGeometry`.
- **Fallback (non-manifold):** union-find over the welded mesh adjacency — flood across
  shared edges, one component per connected triangle set. (`Viewport` already renders
  raw parsed geometry when `geometryToManifold` throws, so the fallback is reachable.)
- A single welded part is one body; finer structure comes from Tiers 2–3.

### 6.3 Tier 3 — own RANSAC (`ransac.ts`, `fit.ts`)

Efficient-RANSAC (Schnabel, Wahl & Klein 2007), sequential extract-largest-then-remove:

```
remaining ← all points;  detected ← []
loop:
  best ← null
  repeat T times (T from probability bound):
    S ← localized minimal sample of oriented points (octree/voxel cell + neighbors)
    for each enabled primitive type:
      m ← constructCandidate(type, S)         // closed-form, uses normals
      inliers ← score(m, remaining)           // dual test below
      if |inliers| > |best.inliers|: best ← m
  if best == null or |best.inliers| < minPoints: break
  refit best by least squares over its inliers // PCA (plane) / LM (sphere/cyl/cone)
  detected.push(best);  remaining ← remaining \ best.inliers
return detected, remaining                     // remaining → Tier 2
```

**Minimal constructions from oriented points** (`fit.ts`):

| Primitive | Min pts | Construction |
|---|---|---|
| Plane | 1 | normal = sample normal; `d = n·p`. |
| Sphere | 2 | center minimizes distance to oriented lines `p_i + t·n_i`; `r = mean‖center−p_i‖`. |
| Cylinder | 2 | **axis `a = normalize(n₁ × n₂)`**; project onto plane ⟂ a, fit 2D center; `r` = dist. |
| Cone | 3 | apex = intersection of 3 tangent planes `n_i·(x−p_i)=0`; axis & half-angle from apex→point dirs. |

**Inlier test (dual):** point `p` with normal `n_p` is an inlier of shape `S` iff
**both** `dist(p, S) ≤ epsilon` **and** `|n_p · n_S(p)| ≥ cosNormal`. The normal test is
what prevents two perpendicular faces at the same distance from merging.

**Localized sampling** from a voxel cell (key `floor(p / cell)`) + its 26 neighbors —
real primitives are spatially compact, so this massively raises the all-inlier sample
rate for small features.

**Refit** after commit: plane = PCA (smallest-eigenvalue eigenvector of the covariance);
sphere/cylinder/cone = `ml-levenberg-marquardt` from the minimal-set fit as the
initial guess.

**Determinism:** inject a seeded PRNG (e.g. mulberry32) so results are reproducible.

### 6.4 Tier 2 — region growing (`regionGrow.ts`)

Segments **leftover** (RANSAC-unassigned) triangles into smooth patches bounded by
sharp creases:

```
for each unlabeled seed (largest-area first):
  grow across edge u→v iff v unlabeled AND dihedral(u,v) ≤ thetaGrow
  hard-stop at edges with dihedral > thetaCrease
  emit region as kind="patch" if |region| ≥ minPatchFaces else → unknown bucket
```

Two thresholds (`thetaGrow < thetaCrease`) give hysteresis. Optionally compare each
candidate's normal to the **seed** normal (not just its neighbor) to stop slow drift
wrapping a cylinder into one giant region. O(F) with adjacency precomputed.

### 6.5 Known failure modes & fixes

- **(a) Infinite-plane merges coplanar but separate faces.** RANSAC's plane is
  unbounded, so a top face and a recessed shelf at the same height become one shape.
  **Fix:** after fitting, map the plane's inlier points → triangles and run **connected
  components on that triangle set** over mesh adjacency; emit one group per component,
  all sharing the plane params but disjoint triangle lists. (Mesh-topology CC is sharper
  than point-space clustering.)
- **(b) Fillets (toroidal) / countersinks (conical) missed.** Enable **cone** (cheap,
  3-point) for countersinks/tapers; treat **fillets as `patch` groups** via Tier 2 by
  default rather than fitting tori (torus fitting is failure-prone and rarely worth it).
- **(c) Fuzzy borders from point-based labels.** (i) A triangle is claimed by a
  primitive only if a **majority of its sample points** are inliers. (ii) One-ring
  majority smoothing of boundary triangles, **never relabeling across a crease**.
  (iii) Optionally snap region borders onto the nearest crease edge (highest quality).

### 6.6 Completeness (`segment.ts`)

Maintain `assignment: Int32Array(F)` initialized to `-1`. After the full pipeline:

1. RANSAC primitives (largest-first) → triangle votes (majority rule §6.5c).
2. **Conflict resolution** when a triangle matches two primitives: (i) higher inlier
   fraction wins; (ii) tie → lower combined residual (distance + normal deviation);
   (iii) still tied → the earlier (larger) shape.
3. Connected-components split (fix a) → final primitive groups.
4. Boundary cleanup (fix c) — only *moves* labels, never creates/loses them.
5. Tier-2 region grow over remaining `-1` → `patch` groups.
6. Any triangle still `-1` → one `unknown` group.

**Asserted invariant:** `Σ group.triangleIndices.length === F` and the union of all
indices has size `F` (no gap, no duplicate).

### 6.7 Parametric rebuild (`rebuild.ts`)

The fitted `params` are the inputs to a manifold-3d generator, so a group becomes a
feature:

- **cylinder → bore:** `Manifold.cylinder(height, r, r, segments)` oriented to
  `axis`/`point` over `axialRange`; editing `radius` regenerates it (and re-runs the
  boolean subtraction if it is a hole).
- **plane → cut/offset:** half-space `normal·x = offset`; editing `offset` moves the cut.
- **sphere/cone:** `Manifold.sphere` / a revolved cone profile.
- **patch/unknown:** no params → ride along as fixed geometry; not parametrically editable.

`.delete()` every intermediate handle; `assertValidSolid` on the result.

---

## 7. Tuning knobs & defaults

All length knobs are **fractions of the bbox diagonal `D`** (scale-invariant).

| Knob | Meaning | Default | User-facing |
|---|---|---|---|
| `epsilon` | max point↔surface distance for inlier | **0.004·D** | **Yes** — "Detail / tolerance" slider |
| `cosNormal` | normal-deviation threshold, cos(α) | **cos 20° ≈ 0.94** | **Yes** — "Angle tolerance" slider |
| `minPoints` | smallest acceptable primitive | **max(50, 0.2%·N)** | **Yes** — "Min feature size" |
| `probability` | RANSAC thoroughness (miss prob) | **0.02** | Advanced |
| `thetaCrease` | sharp-edge / hard boundary | **35–40°** | Advanced |
| `thetaGrow` | tier-2 region-grow smoothness | **15–20°** | Advanced |
| `enabled.*` | which primitive types RANSAC tries | all four on | **Yes** — checkboxes |
| sample density | pts/triangle, total cap | 1–3×, cap ~50–100k | Advanced |

Primary controls: `epsilon`, `cosNormal`, min-feature-size, primitive checkboxes.
Everything else behind "Advanced". Sliders drive a **debounced re-run** through the
existing TanStack Query async-geometry pattern. Persist `SegmentationParams` with the
result for reproducibility.

---

## 8. Performance & memory

- **Run segmentation in a Web Worker.** RANSAC on tens of thousands of points is
  single-threaded and would block the UI. Transfer the position/normal/index buffers
  (transferable `ArrayBuffer`s); return `ShapeGroup` triangle-index arrays.
- **Cap the cloud** at ~50–100k points; subsample (voxel grid) larger meshes before
  RANSAC.
- **three.js:** dispose each group mesh's geometry+material on removal; share one
  material template where possible; cancel the RAF in cleanup.
- **manifold-3d:** delete every intermediate; the groups store deletes replaced/removed
  group handles (delete-on-replace, like `modelStore`).
- If pcl.js is ever added (M5): explicit Vite `?url` wasm asset (never rely on
  Emscripten `locateFile` under hashed assets), `.manager.delete()` on every wrapper,
  worker-hosted.

---

## 9. Milestones (phased)

Each milestone is independently shippable, behind the new `Segment` panel, and lands
with colocated `*.spec.ts`. Effort estimates are rough engineering days.

### M0 — Foundations (≈2–3 d)
**Deliver:** the module skeleton + React-free mesh prep and sampling, no UI yet.
- `src/modules/segment` scaffold + barrel; `Segment` `NavItem` + `activePanel` wiring
  (empty panel).
- `mesh.ts`: weld, face normals, bbox `D`, edge/face adjacency, dihedral.
- `sample.ts`: oriented cloud + `pointToTri` backmap (centroids + area-weighted).
- `groupsStore.ts` / `selectionStore.ts` (copy `editorStore`/`modelStore` idioms).
**Acceptance:** adjacency, dihedral, and sampler unit-tested; panel opens with an empty
state; no behaviour change elsewhere.
**Tests:** `dihedral` on 0/90/180°; adjacency on a 2-triangle quad; sampler backmap
indices all in `[0, F)`; store subscribe/notify + delete-on-replace.

### M1 — Bodies + selection + export (first user-visible slice) (≈3–4 d)
**Deliver:** *Import an STL → split into separately selectable bodies; click to select,
recolor, rename, delete; **export a selected body as its own STL.*** **Zero new deps.**
- `decompose.ts`: `Manifold.decompose()` + union-find fallback.
- Viewport: render **N group meshes**, add `THREE.Raycaster` click-picking → selection
  store; highlight selected with the `drawing-selected` hue; Delete removes (guard
  focused inputs, per `DrawingCanvas`).
- `SegmentPanel.tsx`: `react-virtuoso` groups list, color swatch, rename, delete,
  **Export button** per group → `exportStl` (existing) → download.
**Acceptance:** a multi-body STL shows one group per body; selecting one isolates/
highlights it; delete and rename persist; **exporting a body produces a valid STL of
just that solid** (round-trips through `parseStl`); no leaks.
**Tests:** `decompose` on a known two-body solid → 2 groups with expected volumes;
union-find fallback on a non-manifold fixture; completeness (Σ tris == F); a body's
exported STL re-parses to the expected triangle count / bounds.

### M2 — Faces / patches + multi-select export (≈3–4 d)
**Deliver:** every face/region of a single welded body is its own selectable group;
**multi-select regions and export them together as one STL.** This completes the
confirmed use case for single-solid parts.
- `regionGrow.ts` (Tier 2) + the completeness machinery (`assignment`, unknown bucket).
- Panel groups the patches under their parent body (`parentId`); shift/ctrl multi-select.
- Export a single group or a multi-selection → merge their triangles into one
  `BufferGeometry` → `exportStl` → download.
**Acceptance:** a single cube imported as one body splits into selectable face regions;
**completeness invariant holds** (no triangle lost or double-counted); creases respected;
**exporting a multi-selection yields one STL containing exactly those triangles.**
**Caveat (documented, not blocking):** a patch is an **open surface**; its STL is valid
but not watertight. Surface against a stated need for sealed solids before adding capping.
**Tests:** cube → 6 patch regions; completeness + disjointness on every fixture; a
slot/pocket part keeps walls and floor as separate patches; multi-select export triangle
count == sum of selected groups.

### M3 — Primitive recognition (own RANSAC), OPTIONAL polish (≈5–7 d)
> **Not required for the confirmed export use case** — M1+M2 already split and export.
> M3 buys *smarter, more logical* grouping: recognising a cylinder wall+cap as one
> "cylinder" instead of two patches, and semantic labels ("Bore", "Top face"). Build only
> if region-grow grouping proves too fine for how users want to slice the part. **Gate it
> on a real-file trial first** (see §11) — this is the one tier whose value/reliability is
> input-dependent.
- `fit.ts` (closed-form constructors + LM/PCA refit), `ransac.ts` (sequential SAC,
  localized sampling, dual inlier test, seeded RNG). **Runs in a Web Worker** (see §8) —
  RANSAC is CPU-heavy and must not block the UI.
- Failure-mode fixes (coplanar CC split, cone for countersinks, boundary cleanup).
- `ml-matrix` + `ml-levenberg-marquardt` deps; `epsilon`/`cosNormal`/min-feature sliders
  + primitive checkboxes (Ark `slider`/`number-input`/`checkbox`).
- Groups carry primitive params/labels purely for **display + better export grouping** —
  **no rebuild from params** (that was the dropped parametric-edit goal).
**Acceptance:** plate-with-hole → planes + 1 cylinder; chamfer is its own plane;
countersink is a cone (when enabled) or a patch (never lost); **the worker keeps the main
thread responsive** (no frame drop during a re-run); export still works per group.
**Tests (seeded):** cube → 6 planes; plate+hole → cylinder radius/axis within tol; two
coplanar squares at different heights → 2 separate plane groups (proves CC split);
sphere → 1 sphere radius within ε; determinism (same seed ⇒ same group count + params).

### M4 — Optional / advanced (backlog)
- **Watertight per-shape solids:** cap open patches into closed solids before export
  (only if users need sealed bodies, not just surface shells).
- pcl.js as an optional plane/sphere cross-check backend (worker, Vite `?url` wasm).
- Boundary-snap-to-crease refinement; body→feature hierarchy UI; group merge/split UI.
- Batch export: download all groups at once as a zip.
- Server-side CGAL/Open3D microservice for Schnabel-quality full-primitive fits on large
  or noisy meshes.

> **Dropped:** the former "M4 — parametric editing & rebuild" (change radius → rebuild
> solid). Removed because the confirmed goal is splitting/export, not feature editing;
> rebuilding a solid from recovered mesh primitives is the out-of-scope BREP problem.

---

## 10. Test strategy

Colocated `*.spec.ts`, `bun:test`, `const context = describe` aliasing, asserting
**behaviour not internals** (house style — see `src/modules/drawing/hitTest.spec.ts`).
For manifold-touching logic, `await initManifold()`, assert on outputs, then `.delete()`
(see `drawing/extrude.spec.ts`, `mesh-tools/mesh.spec.ts`).

- **Seed the RNG** so RANSAC tests are reproducible; assert on **counts and parameters
  within tolerance**, not exact point membership.
- **Synthetic fixtures built in-code** (no files): cube (6 planes); plate+hole
  (planes + 1 cylinder); two coplanar squares at different heights (CC split);
  cylinder (1 cylinder + 2 caps); sphere; countersunk hole (cone or patch); chamfered
  cube; degenerate (single/zero-area triangle → unknown, no crash).
- **Invariant tests on every fixture:** completeness (`Σ tris == F`), disjointness,
  backmap sanity (`pointToTri[i] ∈ [0,F)`), determinism (same seed+params ⇒ identical
  group count + sorted params).
- **Unit the pieces in isolation** (no randomness): `dihedral`, adjacency builder,
  connected-components, each closed-form fitter on exact synthetic inputs, conflict
  resolution (60/40 point split lands in the 60 group).

---

## 11. Risks & open questions

- **RANSAC robustness on real exports** is the main unknown — tolerances may need
  per-model tuning; mitigated by the live sliders and `patch`/`unknown` fallbacks so the
  tool degrades gracefully rather than losing geometry.
- **Performance on large meshes** (>100k triangles): rely on point caps + worker; revisit
  if interactivity suffers.
- **Cylinder fit quality** with own RANSAC + LM vs a mature library — validate against the
  plate-with-hole fixture early in M3; pcl.js is *not* a fallback here (no cylinders).
- **Non-manifold / dirty STLs**: Tier-1 union-find fallback covers bodies; Tiers 2–3 work
  on the welded mesh regardless, but degenerate triangles route to `unknown`.
- **Open:** do we need undo/redo on grouping edits (documentStore-style) in M1/M2, or only
  once parametric editing lands in M4? Default: defer history to M4.

---

## 12. References

- Schnabel, Wahl, Klein — *Efficient RANSAC for Point-Cloud Shape Detection*, CGF 26(2),
  2007. https://cg.cs.uni-bonn.de/publication/schnabel-2007-efficient
- CGAL Shape Detection (Efficient-RANSAC + Region Growing), parameter semantics &
  example values. https://doc.cgal.org/latest/Shape_detection/index.html
- Lukács, Marshall, Martin — *Faithful Least-Squares Fitting of Spheres, Cylinders, Cones
  and Tori*, ECCV 1998. https://link.springer.com/content/pdf/10.1007/BFb0055697.pdf
- three.js `MeshSurfaceSampler`, `computeVertexNormals`.
  https://threejs.org/docs/examples/en/math/MeshSurfaceSampler.html
- CAD mesh segmentation via dihedral-angle region growing — CAD Journal 4(6), 2007.
  https://www.cad-journal.net/files/vol_4/CAD_4(6)_2007_827-841.pdf
- `pcl.js` (evaluated, limited to plane+sphere; archived 2023). https://pcl.js.org
- manifold-3d: `decompose()` (`manifold.d.ts:1042`), `split()` (`:938`).
