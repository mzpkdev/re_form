import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://openrouter.ai https://api.openai.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
].join("; ")

const cspPlugin: Plugin = {
    name: "inject-csp",
    apply: "build",
    transformIndexHtml: () => [
        {
            tag: "meta",
            attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy },
            injectTo: "head-prepend"
        }
    ]
}

export default defineConfig({
    plugins: [react(), tailwindcss(), cspPlugin],
    optimizeDeps: {
        exclude: ["manifold-3d"]
    }
})
