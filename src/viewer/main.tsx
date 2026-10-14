import "@foss-earth/ui/theme.css";
import "@foss-earth/ui/windowing.css";
import "../imageTabs/imageTabs.css";
import "./viewer.css";
import { markBrowserAppReady, reportBrowserAppFailure } from "@foss-earth/ui/browser";
import { createRoot } from "react-dom/client";
import { createViewerHost } from "./host";
import { ViewerApp } from "./ViewerApp";

const shell = document.querySelector<HTMLElement>("#root");
const canvas = document.querySelector<HTMLCanvasElement>("#viewer-canvas");
const overlay = document.querySelector<HTMLElement>("#viewer-overlay");
if (!shell || !canvas || !overlay) throw new Error("The viewer page is missing its canvas.");

try {
  const { host } = await createViewerHost(canvas);
  createRoot(overlay).render(<ViewerApp host={host} />);
  markBrowserAppReady(document);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(reason);
  reportBrowserAppFailure(document, reason);
  throw error;
}
