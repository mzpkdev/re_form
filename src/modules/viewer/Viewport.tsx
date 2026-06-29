import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { initManifold } from "../../lib/manifold"
import { geometryToManifold, meshToBufferGeometry } from "../../lib/model"
import { getManifold, setManifold, useModelVersion } from "../../lib/modelStore"
import { parseStl } from "../../lib/stl"

export const Viewport = ({ file }: { file: File | null }) => {
    const sectionRef = useRef<HTMLElement>(null)
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
    const sceneRef = useRef<THREE.Scene | null>(null)
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
    const controlsRef = useRef<OrbitControls | null>(null)
    // The displayed mesh and the material it is built with. The live source
    // Manifold now lives in the module store (modelStore) — the STL importer and
    // Mesh Tools both feed setManifold, so the Viewport no longer owns the handle.
    // The re-bake effect derives geometry from getManifold().
    const meshRef = useRef<THREE.Mesh | null>(null)
    const materialRef = useRef<THREE.MeshStandardMaterial | null>(null)
    const [nonManifold, setNonManifold] = useState(false)
    // Bumped by the store on every setManifold; drives the re-bake effect.
    const modelVersion = useModelVersion()

    // Mount: own the renderer / scene / camera / controls / loop / material for
    // the section's lifetime. StrictMode double-mounts effects in dev, so cleanup
    // must fully tear down — no orphaned canvas, renderer or material. The
    // material is created once here so the re-bake effect can build meshes with
    // it across model versions.
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

        const material = new THREE.MeshStandardMaterial({
            color: 0xec6530,
            roughness: 0.55,
            metalness: 0.1
        })

        rendererRef.current = renderer
        sceneRef.current = scene
        cameraRef.current = camera
        controlsRef.current = controls
        materialRef.current = material

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
            material.dispose()
            rendererRef.current = null
            sceneRef.current = null
            cameraRef.current = null
            controlsRef.current = null
            materialRef.current = null
        }
    }, [])

    // Load the picked STL and feed the source Manifold to the store. A stale
    // async result is dropped via `aborted` when `file` changes mid-load. On a
    // manifold mesh we store the handle and let the re-bake effect build the
    // geometry and frame the camera. On a non-manifold mesh we clear the store
    // and render the raw parsed STL directly, surfacing a notice rather than
    // crashing. The store owns the Manifold's lifetime now — cleanup never
    // deletes it; it only tears down the GPU geometry this effect may have added.
    useEffect(() => {
        const scene = sceneRef.current
        const camera = cameraRef.current
        const controls = controlsRef.current
        const material = materialRef.current
        if (!file || !scene || !camera || !controls || !material) {
            return
        }

        let aborted = false
        setNonManifold(false)

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
                    // Try to build the source Manifold. On success the store
                    // takes ownership and the re-bake effect renders + frames; on
                    // failure we render the raw parsed geometry here.
                    try {
                        const source = geometryToManifold(wasm, parsed)
                        setManifold(source)
                        parsed.dispose()
                    } catch (error) {
                        console.warn("Viewport: STL is not manifold, rendering raw geometry", error)
                        setNonManifold(true)
                        setManifold(null)

                        const mesh = new THREE.Mesh(parsed, material)
                        meshRef.current = mesh
                        scene.add(mesh)

                        // Frame the camera around the raw mesh on load.
                        parsed.computeBoundingBox()
                        const box = parsed.boundingBox
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
        }
    }, [file])

    // Re-bake the displayed geometry whenever the model version bumps (a
    // setManifold anywhere). Reads the live Manifold from the store and converts
    // its mesh to a fresh BufferGeometry. If a mesh already exists we swap its
    // geometry and dispose the previous one. If none exists we create the mesh,
    // add it and frame the camera. Framing happens EXACTLY when the mesh is first
    // created (file load); later edits that swap an existing mesh's geometry must
    // not reframe.
    // biome-ignore lint/correctness/useExhaustiveDependencies: modelVersion gates the re-bake; getManifold() reads the latest handle.
    useEffect(() => {
        const m = getManifold()
        const scene = sceneRef.current
        const camera = cameraRef.current
        const controls = controlsRef.current
        const material = materialRef.current
        if (!m || !scene || !camera || !controls || !material) {
            return
        }

        const next = meshToBufferGeometry(m.getMesh())
        const mesh = meshRef.current
        if (mesh) {
            const previous = mesh.geometry
            mesh.geometry = next
            previous.dispose()
            return
        }

        const created = new THREE.Mesh(next, material)
        meshRef.current = created
        scene.add(created)

        // Frame the camera around the mesh, but only on first creation.
        next.computeBoundingBox()
        const box = next.boundingBox
        if (box) {
            const center = box.getCenter(new THREE.Vector3())
            const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1
            const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2)
            camera.position.copy(center).add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(distance))
            camera.near = Math.max(distance / 100, 0.1)
            camera.far = distance * 100
            camera.updateProjectionMatrix()
            controls.target.copy(center)
            controls.update()
        }
    }, [modelVersion])

    return (
        <section ref={sectionRef} className="relative flex-1 overflow-hidden bg-3d-grid">
            {nonManifold ? (
                <div className="absolute inset-x-0 bottom-0 bg-surface-container px-4 py-2 text-center font-mono text-tiny text-on-surface-variant">
                    Mesh is not manifold — showing raw geometry.
                </div>
            ) : null}
        </section>
    )
}
