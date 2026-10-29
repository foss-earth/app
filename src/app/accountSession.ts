import { accountOriginFor, clientIdForBase, createAccountPanel, createAuthClient } from "@foss-earth/auth";
import type { GoogleTilesCredential } from "@foss-earth/engine/babylon";
import { visitSuppliedGoogleKey } from "./visitGoogleKey";

export interface OpenedAccount {
  panel: HTMLElement;
  destroy(): void;
  /** Signed-in access to Google 3D Tiles. Null when this visit brought its own key, or nobody is signed in. */
  hosted: Extract<GoogleTilesCredential, { kind: "hosted" }> | null;
  /** This tab's address bar included `gkey` (or a legacy alias). That key wins over the account. */
  visitLocked: boolean;
}

/**
 * Signs the page in, if a redirect or a stored session is waiting, and builds
 * the Account tab. A failure to reach the account service leaves the page
 * signed out; flat maps still load.
 */
export async function openAccountSession(document: Document): Promise<OpenedAccount> {
  const view = document.defaultView;
  const base = import.meta.env?.BASE_URL || "/";
  const hostname = view?.location.hostname ?? "";
  const origin = view ? view.location.origin : "https://foss-earth.github.io";
  const client = createAuthClient({
    accountOrigin: accountOriginFor(hostname),
    clientId: clientIdForBase(base),
    redirectUri: new URL(base, origin).href,
  });
  try {
    await client.settle();
  } catch {
    // The account service was unreachable. The page continues signed out.
  }
  const accountPanel = createAccountPanel(client, document);
  const session = client.session();
  const entitled = Boolean(session?.entitlements.includes("google-3d-tiles"));
  const visitLocked = visitSuppliedGoogleKey();
  const hosted = entitled && !visitLocked ? {
    kind: "hosted" as const,
    rootUrl: client.tilesRoot(),
    authorization: (request?: { refresh?: boolean }) => client.authorization(request),
  } : null;
  return { panel: accountPanel.element, destroy: () => accountPanel.destroy(), hosted, visitLocked };
}
