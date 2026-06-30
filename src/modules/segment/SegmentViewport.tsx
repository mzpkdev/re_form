import { useEffect, useRef } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { SELECTED_COLOR } from "./groupColors"
import { toggleSelection } from "./groupHierarchy"
import { setGroups, useGroups, useGroupsVersion } from "./groupsStore"
import { clearSelection, getSelection, setSelection, useSelection } from "./selectionStore"
import { triangleIndicesToGeometry } from "./subGeometry"
import type { ShapeGroup } from "./types"

/**
 * A forked 3D viewport for the segment module. Unlike `Viewport`, which renders
 * a single solid from `modelStore`, this renders ONE selectable mesh per
 * `ShapeGroup` and is driven entirely by the segment stores: `useGroups`
 * supplies the meshes, `useSelection` drives the blue highlight, and picking /
 * Delete write straight back through `setSelection`/`setGroups`. The only prop
 * is the App-owned imported `geometry` — it is BORROWED and never disposed here;
 * every per-group geometry + material this component builds IS segment-owned and
 * is disposed on every group-set change and on unmount.
 *
 * The renderer/scene/camera/OrbitControls/lights/RAF/ResizeObserver scaffold and
 * its teardown are copied verbatim from `Viewport.tsx` (the fork source).
 */
export const SegmentViewport = ({ geometry }: { geometry: THREE.BufferGeometry | null }) => {
    const sectionRef = useRef<HTMLElement>(null)
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
    const sceneRef = useRef<THREE.Scene | null>(null)
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
    const controlsRef = useRef<OrbitControls | null>(null)
    const raycasterRef = useRef<THREE.Raycaster | null>(null)

    // The group meshes currently in the scene, keyed by group id for the
    // highlight effect, plus the reverse Object3D→id map the raycaster reads to
    // turn a hit back into a group id. Both are rebuilt together by the
    // mesh-build effect and emptied on teardown.
    const meshByIdRef = useRef<Map<string, THREE.Mesh>>(new Map())
    const idByObjectRef = useRef<Map<THREE.Object3D, string>>(new Map())

    // Latest groups/selection mirrored into refs so the document-level keydown
    // and the canvas pointerdown handlers read current values without being
    // re-bound on every change (the `DrawingCanvas` selectionRef idiom).
    const groups = useGroups()
    const selection = useSelection()
    const groupsVersion = useGroupsVersion()
    const groupsRef = useRef<ShapeGroup[]>(groups)
    groupsRef.current = groups

    // Mount: own the renderer / scene / camera / controls / loop / raycaster for
    // the section's lifetime. StrictMode double-mounts effects in dev, so cleanup
    // must fully tear down — no orphaned canvas, renderer or controls.
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
        raycasterRef.current = new THREE.Raycaster()

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
            // Free every per-group geometry + material this component built.
            for (const mesh of meshByIdRef.current.values()) {
                scene.remove(mesh)
                mesh.geometry.dispose()
                ;(mesh.material as THREE.Material).dispose()
            }
            meshByIdRef.current.clear()
            idByObjectRef.current.clear()
            rendererRef.current = null
            sceneRef.current = null
            cameraRef.current = null
            controlsRef.current = null
            raycasterRef.current = null
        }
    }, [])

    // Build one mesh per group whenever the source geometry or the group set
    // changes. Each mesh gets its OWN geometry (the group's triangles carved out
    // of the borrowed source) and its OWN material coloured by `group.color`,
    // matching `Viewport`'s flat-shaded standard material. Every previous mesh's
    // geometry + material is disposed before rebuilding — N meshes leak fast on
    // re-segment. Reframes the camera to the combined bounds on each rebuild.
    // biome-ignore lint/correctness/useExhaustiveDependencies: groupsVersion gates the rebuild; groupsRef reads the latest array.
    useEffect(() => {
        const scene = sceneRef.current
        const camera = cameraRef.current
        const controls = controlsRef.current
        if (!scene || !camera || !controls) {
            return
        }

        // Tear down the previous mesh set.
        for (const mesh of meshByIdRef.current.values()) {
            scene.remove(mesh)
            mesh.geometry.dispose()
            ;(mesh.material as THREE.Material).dispose()
        }
        meshByIdRef.current.clear()
        idByObjectRef.current.clear()

        if (!geometry) {
            return
        }

        const selected = new Set(getSelection())
        const bounds = new THREE.Box3()
        const currentGroups = groupsRef.current
        for (const group of currentGroups) {
            const sub = triangleIndicesToGeometry(geometry, group.triangleIndices)
            const material = new THREE.MeshStandardMaterial({
                roughness: 0.55,
                metalness: 0.1,
                flatShading: true
            })
            const [r, g, b] = selected.has(group.id) ? SELECTED_COLOR : group.color
            material.color.setRGB(r, g, b)
            const mesh = new THREE.Mesh(sub, material)
            scene.add(mesh)
            meshByIdRef.current.set(group.id, mesh)
            idByObjectRef.current.set(mesh, group.id)
            sub.computeBoundingBox()
            if (sub.boundingBox) {
                bounds.union(sub.boundingBox)
            }
        }

        // Frame the camera to the combined bounds of the group meshes (falling
        // back to the source geometry if there are no groups yet). Copies
        // Viewport's framing maths.
        if (currentGroups.length === 0) {
            geometry.computeBoundingBox()
            if (geometry.boundingBox) {
                bounds.copy(geometry.boundingBox)
            }
        }
        if (!bounds.isEmpty()) {
            const center = bounds.getCenter(new THREE.Vector3())
            const radius = bounds.getSize(new THREE.Vector3()).length() / 2 || 1
            const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2)
            camera.position.copy(center).add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(distance))
            camera.near = Math.max(distance / 100, 0.1)
            camera.far = distance * 100
            camera.updateProjectionMatrix()
            controls.target.copy(center)
            controls.update()
        }
    }, [geometry, groupsVersion])

    // Highlight the selected groups: a selected group's material turns
    // `SELECTED_COLOR`, every other reverts to its own `group.color`. Mutates the
    // existing material's colour — it never rebuilds geometry. Keyed on selection
    // (and groupsVersion, so a fresh mesh set picks up the current highlight).
    // biome-ignore lint/correctness/useExhaustiveDependencies: selection drives the highlight; groupsVersion re-applies it to a fresh mesh set.
    useEffect(() => {
        const selected = new Set(selection)
        for (const group of groupsRef.current) {
            const mesh = meshByIdRef.current.get(group.id)
            if (!mesh) {
                continue
            }
            const [r, g, b] = selected.has(group.id) ? SELECTED_COLOR : group.color
            ;(mesh.material as THREE.MeshStandardMaterial).color.setRGB(r, g, b)
        }
    }, [selection, groupsVersion])

    // Pointer pick: cast a ray from the click into the group meshes. A plain hit
    // single-selects that group; a hit with shift/meta held TOGGLES it in/out of
    // the current selection (multi-select); a miss always clears. Reads the live
    // selection through `getSelection()` (the store ref idiom) so the toggle sees
    // the current set. Ports the `DrawingCanvas` click-select contract to 3D.
    const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
        const camera = cameraRef.current
        const raycaster = raycasterRef.current
        if (!camera || !raycaster) {
            return
        }
        const rect = event.currentTarget.getBoundingClientRect()
        const ndc = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        )
        raycaster.setFromCamera(ndc, camera)
        const meshes = [...idByObjectRef.current.keys()]
        const hits = raycaster.intersectObjects(meshes, false)
        const hit = hits[0]
        if (hit) {
            const id = idByObjectRef.current.get(hit.object)
            if (id) {
                const additive = event.shiftKey || event.metaKey
                setSelection(additive ? toggleSelection(getSelection(), id) : [id])
                return
            }
        }
        clearSelection()
    }

    // Delete/Backspace removes the selected groups in one step. Bound once on the
    // document (the canvas doesn't focus to receive keydown). GUARD: bail when a
    // form field is focused so deleting in a text input edits text instead of
    // nuking groups. Ports `DrawingCanvas`'s key-delete contract.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Delete" && event.key !== "Backspace") {
                return
            }
            const tag = document.activeElement?.tagName
            if (tag === "INPUT" || tag === "TEXTAREA") {
                return
            }
            const ids = getSelection()
            if (ids.length === 0) {
                return
            }
            event.preventDefault()
            const drop = new Set(ids)
            setGroups(groupsRef.current.filter((group) => !drop.has(group.id)))
            clearSelection()
        }
        document.addEventListener("keydown", onKeyDown)
        return () => document.removeEventListener("keydown", onKeyDown)
    }, [])

    return (
        <section
            ref={sectionRef}
            onPointerDown={handlePointerDown}
            className="relative flex-1 overflow-hidden bg-3d-grid"
        />
    )
}
