import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./styles.css";
import "./preflight.css";
import "./auth.css";
import "./actions.css";
const root=document.getElementById("root");if(!root)throw new Error("root_element_missing");createRoot(root).render(<StrictMode><App/></StrictMode>);
