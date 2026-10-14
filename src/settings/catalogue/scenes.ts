/** Earth composes the owning scene/image catalogs once; values stay in their owners. */
import { SCENE_DOCUMENT_PARAMETERS, SCENE_SECTION_TITLES as SCENE_TITLES, SCENES_TAB } from "@foss-earth/scenes";
import { VIEWER_PARAMETERS, VIEWER_SECTION_TITLES, SPHERE_TAB, SPHERE_SETTINGS_TAB } from "@foss-earth/sphere-image/settings";
import { createImageResourceParameters, IMAGE_RESOURCE_SECTION_TITLES } from "@foss-earth/images/settings";
import { TILED_CUBEMAP_PARAMETERS, keptGpuDefault } from "@foss-earth/sphere-tiled-cubemap/settings";
import { PREVIEW_SHEETS_PARAMETERS } from "@foss-earth/preview-sheets/settings";
export { SCENES_TAB, SPHERE_TAB, SPHERE_SETTINGS_TAB };
export const SCENE_PARAMETERS = [...SCENE_DOCUMENT_PARAMETERS, ...VIEWER_PARAMETERS,
  ...createImageResourceParameters({ keptGpuDefault }), ...TILED_CUBEMAP_PARAMETERS, ...PREVIEW_SHEETS_PARAMETERS];
export const SCENE_SECTION_TITLES = [...SCENE_TITLES, ...VIEWER_SECTION_TITLES, ...IMAGE_RESOURCE_SECTION_TITLES, [SCENES_TAB, "tiles", "Tiled images"] as const];
