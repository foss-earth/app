/** One helper thread of the shared-memory sky core: the page hands it a port to the sky worker, whose coordinator starts it. */
import { installSkySharedHelper } from "@foss-earth/native-sky/helper";

installSkySharedHelper(self as unknown as Parameters<typeof installSkySharedHelper>[0]);
