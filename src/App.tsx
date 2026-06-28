import { useQuery } from "@tanstack/react-query"
import wasmUrl from "manifold-3d/manifold.wasm?url"
import { useEffect, useRef } from "react"
import * as THREE from "three"
import { Widget } from "./lib/geometry"
import { initManifold } from "./lib/manifold"

type WidgetData = {
    geometry: THREE.BufferGeometry
    volume: number
    surfaceArea: number
}

const useWidget = () => {
    return useQuery<WidgetData>({
        queryKey: ["widget"],
        queryFn: async () => {
            const wasm = await initManifold({ locateFile: () => wasmUrl })
            const widget = Widget.build(wasm)
            return { geometry: widget.toBufferGeometry(), volume: widget.volume, surfaceArea: widget.surfaceArea }
        },
        staleTime: Number.POSITIVE_INFINITY
    })
}

export const App = () => {
    const { data, isPending, isError, error } = useWidget()
    return (
        <main className="mx-auto max-w-page px-4 py-8 font-sans">
            <h1 className="mb-1 text-2xl font-semibold">hublinator</h1>
            <p className="mb-6 text-muted">React + three.js + manifold-3d, wired with TanStack Query.</p>
            {isPending && <p className="text-muted tabular-nums">Compiling geometry…</p>}
            {isError && <p className="text-muted tabular-nums">Failed to build geometry: {String(error)}</p>}
            {data && <Viewport geometry={data.geometry} />}
            {data && (
                <p className="text-muted tabular-nums">
                    volume ≈ {data.volume.toFixed(1)} · surface area ≈ {data.surfaceArea.toFixed(1)}
                </p>
            )}
        </main>
    )
}

const Viewport = ({ geometry }: { geometry: THREE.BufferGeometry }) => {
    const mountRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const mount = mountRef.current
        if (!mount) {
            return
        }
        const width = mount.clientWidth
        const height = mount.clientHeight
        const scene = new THREE.Scene()
        scene.background = new THREE.Color(0x0b0e14)
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
        camera.position.set(34, 34, 34)
        camera.lookAt(0, 0, 0)
        const renderer = new THREE.WebGLRenderer({ antialias: true })
        renderer.setPixelRatio(window.devicePixelRatio)
        renderer.setSize(width, height)
        mount.appendChild(renderer.domElement)
        const material = new THREE.MeshStandardMaterial({
            color: 0x4f9dff,
            metalness: 0.15,
            roughness: 0.4
        })
        const mesh = new THREE.Mesh(geometry, material)
        scene.add(mesh)
        const key = new THREE.DirectionalLight(0xffffff, 2.4)
        key.position.set(1, 1, 1)
        scene.add(key, new THREE.AmbientLight(0xffffff, 0.5))
        let frame = 0
        const renderLoop = () => {
            mesh.rotation.x += 0.004
            mesh.rotation.y += 0.008
            renderer.render(scene, camera)
            frame = requestAnimationFrame(renderLoop)
        }
        renderLoop()
        const onResize = () => {
            const w = mount.clientWidth
            const h = mount.clientHeight
            camera.aspect = w / h
            camera.updateProjectionMatrix()
            renderer.setSize(w, h)
        }
        window.addEventListener("resize", onResize)
        return () => {
            cancelAnimationFrame(frame)
            window.removeEventListener("resize", onResize)
            renderer.dispose()
            material.dispose()
            renderer.domElement.remove()
        }
    }, [geometry])
    return <div className="h-viewport w-full overflow-hidden rounded-xl border border-border" ref={mountRef} />
}
