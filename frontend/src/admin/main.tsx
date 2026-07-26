import { render } from "preact";
import "../index.css";
import "./admin.css";
import { AdminApp } from "./AdminApp";

render(<AdminApp />, document.getElementById("admin")!);
