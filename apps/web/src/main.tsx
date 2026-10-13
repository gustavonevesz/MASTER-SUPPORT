import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./styles.css";
import "./preflight.css";
const root=document.getElementById("root");if(!root)throw new Error("root_element_missing");createRoot(root).render(<StrictMode><App/></StrictMode>);
