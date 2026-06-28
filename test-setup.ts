import { setDefaultTimeout } from "bun:test"

// Lift the 5s per-test default: the functional e2e manifold builds take ~7-9s
// on CI. Applies to the whole suite, local and CI, via bunfig `preload`.
setDefaultTimeout(20_000)
