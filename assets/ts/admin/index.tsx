import { render, h } from "preact";
import { App } from "./App";

const mount = document.getElementById("admin-app");
if (mount) render(<App />, mount);
