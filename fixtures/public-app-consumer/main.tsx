import React from "react";
import * as app from "foss-earth";
import * as runtime from "foss-earth/runtime";
import * as shell from "foss-earth/shell";
import * as input from "foss-earth/input";
import * as windowing from "foss-earth/windowing";
import * as layers from "foss-earth/layers";
import * as lights from "foss-earth/lights";
import * as cameraMath from "foss-earth/cameraMath";
import * as diagnostics from "foss-earth/diagnostics";
import * as heights from "foss-earth/heights";
import * as drawing from "foss-earth/diagnosticDrawing";
import * as mapDetail from "foss-earth/mapDetailPolicy";
import * as perf from "foss-earth/perf";
import * as scenes from "foss-earth/scenes";
import sceneSchema from "foss-earth/scenes/schema.json";
import * as settings from "foss-earth/settings";
import * as sky from "foss-earth/sky";
import * as weather from "foss-earth/weather";
import * as elevation from "foss-earth/smoothElevation";
import "foss-earth/style.css";
import "foss-earth/input-mode.css";
import "foss-earth/shell.css";
import "foss-earth/windowing.css";

// Static public assembly only: this consumer does not construct a renderer,
// mount an application, open a socket or acquire browser/GPU resources.
export const publicApp = {
  app, runtime, shell, input, windowing, layers, lights, cameraMath,
  diagnostics, heights, drawing, mapDetail, perf, scenes, sceneSchema,
  settings, sky, weather, elevation,
};
export const createHost: typeof app.createGlobeApp = app.createGlobeApp;
export const mountHost: typeof app.mountGlobeApp = app.mountGlobeApp;
export const compatibilityRuntime: typeof runtime.createBabylonRuntime = runtime.createBabylonRuntime;
export const closedHostOptions: app.GlobeAppOptions = { scenes: [], devContributions: [] };
export const portableSections: readonly shell.PanelSection[] = [];
export const renderConsumerLabel = () => <p>Public Earth application exports</p>;
// Retain the public namespace graph in the actual build rather than allowing an
// unused import list to disappear. Browser execution is a separate qualification.
Object.assign(globalThis, { earthPublicConsumer: publicApp, renderConsumerLabel, React });
