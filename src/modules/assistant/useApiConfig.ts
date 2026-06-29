import { useSyncExternalStore } from "react"

/**
 * Build a hook over a single localStorage-backed string, shared across all
 * consumers in the tab via a module store (so e.g. the chat panel re-renders
 * when Settings changes the value, even while it stays mounted-but-hidden).
 * An empty value clears the key; callers resolve emptiness to their own default.
 */
const createPersisted = (storageKey: string) => {
    const read = (): string => {
        try {
            return localStorage.getItem(storageKey) ?? ""
        } catch {
            return ""
        }
    }

    const listeners = new Set<() => void>()
    let snapshot = read()

    const subscribe = (onChange: () => void) => {
        listeners.add(onChange)
        return () => {
            listeners.delete(onChange)
        }
    }

    return () => {
        const value = useSyncExternalStore(subscribe, () => snapshot)
        const set = (next: string) => {
            if (next) {
                localStorage.setItem(storageKey, next)
            } else {
                localStorage.removeItem(storageKey)
            }
            snapshot = next
            for (const onChange of listeners) {
                onChange()
            }
        }
        return [value, set] as const
    }
}

const usePersistedKey = createPersisted("hublinator.openrouter.key")
const usePersistedBaseUrl = createPersisted("hublinator.api.baseUrl")
const usePersistedModel = createPersisted("hublinator.api.model")

export const useApiKey = () => {
    const [apiKey, setApiKey] = usePersistedKey()
    return { apiKey, setApiKey }
}

export const useBaseUrl = () => {
    const [baseUrl, setBaseUrl] = usePersistedBaseUrl()
    return { baseUrl, setBaseUrl }
}

export const useModel = () => {
    const [model, setModel] = usePersistedModel()
    return { model, setModel }
}
