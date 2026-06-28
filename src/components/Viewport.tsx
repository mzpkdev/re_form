import type { Manifold } from "manifold-3d"
import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { initManifold } from "../lib/manifold"
import { geometryToManifold, type Transform, transformedGeometry } from "../lib/model"
import { parseStl } from "../lib/stl"

export const Viewport = ({ file, transform }: { file: File | null; transform: Transform }) => {
    const sectionRef = useRef<HTMLElement>(null)
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
    const sceneRef = useRef<THREE.Scene | null>(null)
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
    const controlsRef = useRef<OrbitControls | null>(null)
    // The displayed mesh and the source Manifold the transform effect transforms.
    // Shared across the [file] and [transform] effects, so they live in refs.
    const meshRef = useRef<THREE.Mesh | null>(null)
    const sourceManifoldRef = useRef<Manifold | null>(null)
    // Mirrors the latest transform so the async [file] load can bake it in
    // without depending on `transform` — that would re-load + re-frame on every
    // edit. The [transform] effect owns subsequent re-bakes.
    const transformRef = useRef(transform)
    transformRef.current = transform
    const [nonManifold, setNonManifold] = useState(false)

    // Mount: own the renderer / scene / camera / controls / loop for the
    // section's lifetime. StrictMode double-mounts effects in dev, so cleanup
    // must fully tear down — no orphaned canvas or renderer.
    useEffect(() => {
        const section = sectionRef.current
        if (!section) {
            return
        }

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(window.devicePixelRatio)
        renderer.setClearAlpha(0)
        renderer.domElement.className = "absolute inset-0 size-full"
        section.appendChild(renderer.domElement)

        const scene = new THREE.Scene()

        const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)
        camera.position.set(40, 40, 40)

        const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.2)
        const dir = new THREE.DirectionalLight(0xffffff, 1.5)
        dir.position.set(1, 2, 3)
        scene.add(hemi, dir)

        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true

        rendererRef.current = renderer
        sceneRef.current = scene
        cameraRef.current = camera
        controlsRef.current = controls

        let frame = 0
        const renderLoop = () => {
            frame = requestAnimationFrame(renderLoop)
            controls.update()
            renderer.render(scene, camera)
        }
        renderLoop()

        const resize = () => {
            const { clientWidth, clientHeight } = section
            if (clientWidth === 0 || clientHeight === 0) {
                return
            }
            renderer.setSize(clientWidth, clientHeight, false)
            camera.aspect = clientWidth / clientHeight
            camera.updateProjectionMatrix()
        }
        resize()
        const observer = new ResizeObserver(resize)
        observer.observe(section)

        return () => {
            cancelAnimationFrame(frame)
            observer.disconnect()
            controls.dispose()
            renderer.dispose()
            renderer.domElement.remove()
            rendererRef.current = null
            sceneRef.current = null
            cameraRef.current = null
            controlsRef.current = null
        }
    }, [])

    // Load the picked STL, build a source Manifold from it, render the identity
    // geometry and frame the camera. The Manifold is the master copy the
    // transform effect derives baked geometry from. A stale async result is
    // dropped via `aborted` when `file` changes mid-load. If the mesh is not
    // manifold we fall back to rendering the raw parsed STL (untransformed) and
    // surface a notice rather than crashing. Cleanup disposes the GPU geometry/
    // material and the Manifold handle — all resources the Viewport owns.
    useEffect(() => {
        const scene = sceneRef.current
        const camera = cameraRef.current
        const controls = controlsRef.current
        if (!file || !scene || !camera || !controls) {
            return
        }

        let aborted = false
        setNonManifold(false)

        const material = new THREE.MeshStandardMaterial({
            color: 0xec6530,
            roughness: 0.55,
            metalness: 0.1
        })

        file.arrayBuffer()
            .then(async (data) => {
                if (aborted) {
                    return
                }
                const parsed = parseStl(data)
                await initManifold().then((wasm) => {
                    if (aborted) {
                        parsed.dispose()
                        return
                    }
                    // Try to build the source Manifold. transformedGeometry below
                    // owns the rendered geometry; on failure we render `parsed`.
                    let geometry: THREE.BufferGeometry
                    try {
                        const source = geometryToManifold(wasm, parsed)
                        sourceManifoldRef.current = source
                        geometry = transformedGeometry(source, transformRef.current)
                        parsed.dispose()
                    } catch (error) {
                        console.warn("Viewport: STL is not manifold, rendering raw geometry", error)
                        setNonManifold(true)
                        geometry = parsed
                    }

                    const mesh = new THREE.Mesh(geometry, material)
                    meshRef.current = mesh
                    scene.add(mesh)

                    // Frame the camera around the mesh on load only.
                    geometry.computeBoundingBox()
                    const box = geometry.boundingBox
                    if (box) {
                        const center = box.getCenter(new THREE.Vector3())
                        const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1
                        const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2)
                        camera.position
                            .copy(center)
                            .add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(distance))
                        camera.near = Math.max(distance / 100, 0.1)
                        camera.far = distance * 100
                        camera.updateProjectionMatrix()
                        controls.target.copy(center)
                        controls.update()
                    }
                })
            })
            .catch((error) => {
                if (!aborted) {
                    console.warn("Viewport: failed to load STL", error)
                }
            })

        return () => {
            aborted = true
            const mesh = meshRef.current
            if (mesh) {
                scene.remove(mesh)
                mesh.geometry.dispose()
                meshRef.current = null
            }
            material.dispose()
            sourceManifoldRef.current?.delete()
            sourceManifoldRef.current = null
        }
    }, [file])

    // Re-bake the geometry whenever the transform changes. Only runs once a
    // source Manifold exists (manifold STL imported). Swaps the mesh geometry
    // and disposes the previous one; the camera is intentionally left alone so
    // editing transforms does not re-frame the view.
    useEffect(() => {
        const source = sourceManifoldRef.current
        const mesh = meshRef.current
        if (!source || !mesh) {
            return
        }
        const next = transformedGeometry(source, transform)
        const previous = mesh.geometry
        mesh.geometry = next
        previous.dispose()
    }, [transform])

    return (
        <section ref={sectionRef} className="relative flex-1 overflow-hidden bg-3d-grid">
            {nonManifold ? (
                <div className="absolute inset-x-0 bottom-0 bg-surface-container px-4 py-2 text-center font-mono text-tiny text-on-surface-variant">
                    Mesh is not manifold — transforms are disabled.
                </div>
            ) : null}
        </section>
    )
}
