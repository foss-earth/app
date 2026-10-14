import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { WindowOverlay, type WindowOverlayHandle } from "@foss-earth/ui/react";
import { browserOverlayGeometry, browserOverlayLayout } from "@foss-earth/ui/browser";
import { imageTabDefinitions, isImageInstanceTab, OPEN_IMAGE_TAB, type ImageTabId } from "../imageTabs/imageDocuments";
import { ImageSurfaceBody } from "../imageTabs/ImageTabs";
import type { ImageSurfaceHost } from "../imageTabs/imageSurfaceHost";
import { useImageDocuments } from "../imageTabs/useImageTabs";
import { rt4ksrOutputUrl, rt4ksrSourceUrl, RT4KSR_RUNNER, type Rt4ksrCase, type Rt4ksrProfile } from "./demo";
import { ExperimentTab } from "./ExperimentTab";
import { openImageOnSide } from "./openImage";

type ViewerTabId = "experiment" | ImageTabId;

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

export function ViewerApp({ host }: { host: ImageSurfaceHost }) {
  const documents = useImageDocuments(host);
  const [profile, setProfile] = useState<Rt4ksrProfile>("720p");
  const [caseName, setCaseName] = useState<Rt4ksrCase>("natural");
  const overlayApi = useRef<WindowOverlayHandle<ViewerTabId> | null>(null);
  const storage = useState(memoryStorage)[0];
  const originalTab = useRef<string | null>(null);
  const compared = useRef<string[]>([]);
  const [bound, setBound] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const tabs = useMemo(() => [
    { id: "experiment" as const, label: "Experiment" },
    ...imageTabDefinitions(documents).filter(tab => tab.id !== OPEN_IMAGE_TAB),
  ], [documents]);

  // The overlay's handle is set in its own layout effect, which runs before this one.
  useLayoutEffect(() => {
    const handle = overlayApi.current;
    if (!handle) return;
    const off = host.bindWorkspace({
      workspace: handle.workspace,
      openTabInSlot: (tabId, slotId) => overlayApi.current?.openTabInSlot(tabId as ViewerTabId, slotId),
    });
    handle.openTabInSlot("experiment", "primary");
    setBound(true);
    return () => { setBound(false); off(); };
  }, [host]);

  useEffect(() => {
    if (!bound) return;
    const handle = overlayApi.current;
    if (!handle) return;
    let cancel = false;
    const url = rt4ksrSourceUrl(RT4KSR_RUNNER, "Original", profile, caseName);
    void (async () => {
      for (const tabId of compared.current) handle.closeTab(tabId as ViewerTabId);
      compared.current = [];
      if (originalTab.current) handle.closeTab(originalTab.current as ViewerTabId);
      originalTab.current = null;
      const tabId = await openImageOnSide(host, url, "primary");
      if (cancel) {
        if (tabId) overlayApi.current?.closeTab(tabId as ViewerTabId);
        return;
      }
      if (!tabId) {
        setSourceError(host.getView().opening.error ?? "The original image could not be opened.");
        return;
      }
      setSourceError(null);
      originalTab.current = tabId;
    })().catch(error => { if (!cancel) setSourceError(error instanceof Error ? error.message : String(error)); });
    return () => { cancel = true; };
  }, [bound, host, profile, caseName]);

  async function onFinished(job: string, runProfile: Rt4ksrProfile, runCase: Rt4ksrCase): Promise<void> {
    for (const tabId of compared.current) overlayApi.current?.closeTab(tabId as ViewerTabId);
    compared.current = [];
    const output = await openImageOnSide(host, rt4ksrOutputUrl(RT4KSR_RUNNER, job), "secondary");
    if (!output) throw new Error(host.getView().opening.error ?? "The WebGPU output could not be opened.");
    const half = await openImageOnSide(host, rt4ksrSourceUrl(RT4KSR_RUNNER, "Half-resolution", runProfile, runCase), "secondary");
    if (!half) throw new Error(host.getView().opening.error ?? "The half-resolution input could not be opened.");
    compared.current = [output, half];
    if (originalTab.current) overlayApi.current?.openOrSelectTab(originalTab.current as ViewerTabId);
  }

  return <WindowOverlay<ViewerTabId>
    tabDefinitions={tabs}
    renderTabContent={tabId => {
      if (tabId === "experiment") return <ExperimentTab profile={profile} caseName={caseName} sourceError={sourceError} onProfile={setProfile} onCase={setCaseName} onFinished={onFinished} />;
      if (isImageInstanceTab(tabId)) return <ImageSurfaceBody host={host} tabId={tabId} />;
      return null;
    }}
    surfaces={{ renderJoined: () => <ImageSurfaceBody host={host} tabId={null} /> }}
    context={{ active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "experiment" }}
    restorableTabs={new Set(["experiment"])}
    storage={storage}
    geometry={browserOverlayGeometry(window, () => null)}
    logSize={{ getWidth: () => null, subscribe: () => () => {} }}
    layoutPort={browserOverlayLayout(document.documentElement)}
    overlayApiRef={overlayApi}
    presentation={{ choice: "split", onChoice() {}, tabsBehindToolbar: false }}
  />;
}
