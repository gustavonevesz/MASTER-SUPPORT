import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginView } from "../src/app.js";

test("login view uses provider redirect and contains no password form",()=>{const html=renderToStaticMarkup(<LoginView returnUrl="/assets"/>);assert.match(html,/Acesso do operador/);assert.match(html,/\/auth\/login/);assert.doesNotMatch(html,/type="password"|localStorage|sessionStorage/);});
