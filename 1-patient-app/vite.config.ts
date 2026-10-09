import { defineConfig } from "vite";

// No @vitejs/plugin-react: the spec allows only react, react-dom, vite and
// typescript as dependencies. Vite's built-in esbuild handles TSX using the
// "jsx": "react-jsx" setting in tsconfig.json. Fast Refresh is not available
// without the plugin; edits trigger a full reload instead, which is fine here.
export default defineConfig({
  server: { port: 3000, strictPort: true },
});
