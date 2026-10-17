import { defineConfig } from "vite";

// No @vitejs/plugin-react: the spec allows only react, react-dom, vite and
// typescript as dependencies. Vite's built-in esbuild handles TSX through the
// "jsx": "react-jsx" setting in tsconfig.json. Without the plugin there is no
// Fast Refresh; an edit triggers a full reload instead, which is fine here.
export default defineConfig({
  server: { port: 3000, strictPort: true },
});
