import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { initPersistence } from "./modules/drawing"
import "@fontsource-variable/inter"
import "@fontsource-variable/jetbrains-mono"
import "./index.css"

// Hydrate the drawing document from localStorage and start autosaving — once,
// before first render, so a reload restores the drawing and the autosave stays
// active for the whole session regardless of which view is mounted.
initPersistence()

const queryClient = new QueryClient()

const container = document.getElementById("root")
if (!container) {
    throw new Error("Root container #root not found")
}

createRoot(container).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <App />
        </QueryClientProvider>
    </StrictMode>
)
