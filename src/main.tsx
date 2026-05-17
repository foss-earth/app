import "./styles/globe.css";
import { createGlobeApp } from "./app/createGlobeApp";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error('Expected to find a root element with id "root".');
}

void createGlobeApp(rootElement).catch((error: unknown) => {
  console.error("Failed to bootstrap FOSS Earth Babylon.", error);
  rootElement.innerHTML = '<div class="boot-error">Failed to initialize FOSS Earth Babylon.</div>';
});
