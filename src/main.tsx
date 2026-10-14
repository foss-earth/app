import { mountGlobeApp } from "./app/mountGlobeApp";
import { startupFailure } from "./app/startupFailure";
import { isBrowserRecoveryPage, markBrowserAppReady, reportBrowserAppFailure } from "@foss-earth/ui/browser";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error('Expected to find a root element with id "root".');
}

if (!isBrowserRecoveryPage(document)) void mountGlobeApp(rootElement).then((globeApp) => {
  markBrowserAppReady(document);
  if (new URLSearchParams(window.location.search).get("bench") === "1") {
    window.__fossEarthBench = globeApp;
  }
}).catch((error: unknown) => {
  const reason = startupFailure(error);
  console.error(`Earth application startup failed: ${reason}`);
  const message = document.createElement("div");
  message.className = "boot-error";
  message.textContent = `Earth application startup failed: ${reason}`;
  rootElement.replaceChildren(message);
  reportBrowserAppFailure(document, reason);
});
