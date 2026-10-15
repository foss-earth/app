/** Whether photograph placement may be edited. Exactly one `dev=1` opens it, in dev and on the published site. */
import { wantsDev } from "@foss-earth/dev";

export function poseEditEnabled(search: string): boolean {
  return wantsDev(search);
}
