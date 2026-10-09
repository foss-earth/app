/** Earth compatibility adapter: About owns presentation; the host owns data/transport. */
import { createAboutPanel as createSharedAboutPanel } from "@foss-earth/about/panel";
import { readBuiltFrom, type BuiltFrom } from "@foss-earth/about";
import { getAppIdentity, type AppIdentity } from "../app/appIdentity";
import { describePublishedVersion, type PublishedVersionWatch } from "../app/publishedVersion";

export interface AboutPanelOptions {
  /** What the page says it was built from, read from the page by default; null for a page built without the builtFrom plugin. */
  builtFrom?: BuiltFrom | null;
  /** The build as the app's config names it, for a page without the description, and its bundle; the running app's by default. */
  identity?: AppIdentity;
  /** The app's name as people know it; the page's title by default. */
  title?: string;
  /** Whether this page is the version the site publishes, where the app asks (publishedVersion.ts). */
  publishedVersion?: Pick<PublishedVersionWatch, "state" | "subscribe" | "now">;
  /**
   * The site's GitHub repository, "owner/name", whose gh-pages branch is its
   * latest deploy. Asked of GitHub the first time About is shown: it is the
   * site's, not this page's, which may be older.
   */
  site?: string;
  /** How GitHub is asked; `fetch` by default. */
  fetch?: typeof fetch;
  document?: Document;
  whenShown?(element: HTMLElement, listener: () => void): () => void;
  createAbortController?: () => Pick<AbortController, "signal" | "abort">;
  externalLinkIcon?: () => SVGSVGElement;
}

export interface AboutPanelHandle {
  element: HTMLElement;
  dispose(): void;
}


export function createAboutPanel(options: AboutPanelOptions = {}): AboutPanelHandle {
  const page = options.document ?? document;
  const builtFrom = options.builtFrom === undefined ? readBuiltFrom(page) : options.builtFrom;
  const watch = options.publishedVersion;
  return createSharedAboutPanel({
    builtFrom,
    identity: options.identity ?? getAppIdentity(),
    title: options.title || page.title || builtFrom?.app.name || "This app",
    document: page,
    whenShown: options.whenShown,
    createAbortController: options.createAbortController,
    externalLinkIcon: options.externalLinkIcon,
    ...(watch ? { publishedVersion: {
      describe: () => describePublishedVersion(watch.state(), watch.now()),
      subscribe: listener => watch.subscribe(listener),
    } } : {}),
    ...(options.site ? { latestDeploy: {
      async read(signal: AbortSignal) {
        const response = await (options.fetch ?? fetch)(`https://api.github.com/repos/${options.site}/git/ref/heads/gh-pages`, { cache: "no-store", signal });
        const payload: unknown = response.ok ? await response.json() : null;
        if (!payload || typeof payload !== "object" || !("object" in payload)) return null;
        const object = payload.object;
        return object && typeof object === "object" && "sha" in object && typeof object.sha === "string" ? object.sha : null;
      },
    } } : {}),
  });
}
