import type { ManifoldToplevel } from "manifold-3d"
import Module from "manifold-3d"

type ManifoldInitOptions = Parameters<typeof Module>[0]

let instance: Promise<ManifoldToplevel> | undefined

export const initManifold = (options?: ManifoldInitOptions): Promise<ManifoldToplevel> => {
    if (!instance) {
        instance = Module(options).then((wasm) => {
            wasm.setup()
            return wasm
        })
    }
    return instance
}
