import { render } from "preact";
import "../index.css";
import "./admin.css";
import { AdminApp } from "./AdminApp";

// This entry point is deliberately separate from app.tsx (see vite.config.ts), so it doesn't
// get app.tsx's theme-resolution effect either — without this, index.css's light-mode text
// colors render against the browser's own native dark background on a dark-mode system,
// making most of the page unreadable. No manual toggle here, just follow the OS setting live.
const darkMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => {
  document.documentElement.dataset.theme = darkMediaQuery.matches ? "dark" : "light";
};
applyTheme();
darkMediaQuery.addEventListener("change", applyTheme);

render(<AdminApp />, document.getElementById("admin")!);
