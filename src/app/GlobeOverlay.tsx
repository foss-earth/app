import { AdoptedElement } from "@foss-earth/ui/react";
import { useLayoutEffect, useMemo } from "react";
import { WindowOverlay, type WindowOverlayHandle } from "../shell/WindowOverlay";
import { imageTabDefinitions, isImageInstanceTab, OPEN_IMAGE_TAB, type ImageTabId } from "../imageTabs/imageDocuments";
import { ImageSurfaceBody, OpenImageTab } from "../imageTabs/ImageTabs";
import { useImageDocuments } from "../imageTabs/useImageTabs";
import type { GlobeAppHandle } from "./createGlobeApp";

export type AppTabId = "dev" | ImageTabId;

/** The window overlay with the app's own tabs: Dev, Open image and one per open image. */
export function GlobeOverlay({ app, overlayApi }: { app: GlobeAppHandle; overlayApi: { current: WindowOverlayHandle<AppTabId> | null } }) {
  const images = app.imageTabs;
  const documents = useImageDocuments(images);
  const tabs = useMemo(() => [...(app.devTab ? [{ id: "dev" as const, label: app.devTab.title }] : []), ...imageTabDefinitions(documents)], [app, documents]);
  // The overlay's handle is set in its own layout effect, which runs before this one.
  useLayoutEffect(() => {
    const handle = overlayApi.current;
    if (!handle) return;
    return images.bindWorkspace({ workspace: handle.workspace,
      openTabInSlot: (tabId, slotId) => overlayApi.current?.openTabInSlot(tabId as AppTabId, slotId) });
  }, [images, overlayApi]);
  return <WindowOverlay<AppTabId>
    additionalTabs={tabs}
    renderAdditionalTab={tabId => {
      if (tabId === OPEN_IMAGE_TAB) return <OpenImageTab host={images} />;
      if (isImageInstanceTab(tabId)) return <ImageSurfaceBody host={images} tabId={tabId} />;
      return app.devTab ? <AdoptedElement element={app.devTab.element} /> : null;
    }}
    renderJoinedTabs={() => <ImageSurfaceBody host={images} tabId={null} />}
    onTabVisibility={(id, visible) => app.onTabVisibility(id, visible)}
    getViewState={app.getViewState}
    setViewState={(location) => app.setViewState(location)}
    onDeviceLocation={(fix) => app.showDeviceLocation(fix)}
    observeLocation={(listener) => {
      const observer = app.runtime.scene.onAfterRenderObservable.add(listener);
      return () => { app.runtime.scene.onAfterRenderObservable.remove(observer); };
    }}
    controlsSections={app.controlsSections}
    interfaceSections={app.interfaceSections}
    interfaceLead={app.interfaceLead}
    locationSearchSection={app.locationSearchSection}
    settingsSections={app.settingsSections}
    mapTab={app.mapTab}
    rendererTab={app.rendererTab}
    skyTab={app.skyTab}
    timeTab={app.timeTab}
    scenesTab={app.scenesTab}
    aboutTab={app.aboutTab}
    bugReportTab={app.bugReportTab}
    browserDataTab={app.browserDataTab}
    onBugReportShow={app.onBugReportShow}
    sphereTabs={app.sphereTabs}
    overlayApiRef={overlayApi}
  />;
}
