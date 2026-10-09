import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// No <StrictMode>: in development it mounts effects twice, which would run the
// one-time OAuth callback handling twice and try to exchange the code twice.
createRoot(document.getElementById("root")!).render(<App />);
