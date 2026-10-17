import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// No <StrictMode>: in development it mounts effects twice, which would run the
// one-time launch handling twice and try to exchange the authorization code
// twice. A code is single use, so the second exchange would fail.
createRoot(document.getElementById("root")!).render(<App />);
