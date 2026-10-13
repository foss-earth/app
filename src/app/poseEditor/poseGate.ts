/** Whether photograph placement may be edited. Local dev and the Dev tab flag, both. */
import { wantsDev } from "@foss-earth/dev";

export function poseEditEnabled(dev: boolean, search: string): boolean {
  return dev && wantsDev(search);
}
