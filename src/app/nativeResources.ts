/** Earth assembles one borrowed device and the shared Images broker. */
import { ResourceCapacityError, type ImageSessionBroker, type PoolName } from "@foss-earth/images";
import {
  createImageTextureUploader, createTextureDevicePorts, createImageRegionDevicePorts, createCanvasTextureDevicePorts,
  createTextureTransferTracker, type ImageTextureUploader, type ImageTextureUploaderOptions,
  type ImageRegionDevicePorts,
} from "@foss-earth/renderer/babylon";
import type { ImageryAtlasDevicePorts, ManagedImageryAtlasResources } from "@foss-earth/engine/babylon";

export interface EarthNativeResourceOptions {
  broker: ImageSessionBroker;
  scene: ImageTextureUploaderOptions["scene"];
  limits(): ImageTextureUploaderOptions["limits"];
  wakeWork(): void;
  createCanvas: ImageTextureUploaderOptions["createStagingCanvas"];
  invalidatePublishedSource: ImageTextureUploaderOptions["invalidatePublishedSource"];
}

/** All supplied releases are attempted even after an earlier native failure. */
export function attemptEarthCleanup(actions: readonly (() => void)[], message: string): void {
  const errors: unknown[] = [];
  for (const action of actions) { try { action(); } catch (error) { errors.push(error); } }
  if (errors.length) throw new AggregateError(errors, message);
}

export function createEarthNativeResources(options: EarthNativeResourceOptions) {
  const { broker, scene } = options;
  let stopped = false;
  let restorationNeeded = false;
  const requireDevice = () => {
    if (stopped || restorationNeeded) throw new Error("The Earth native resource device is unavailable.");
  };
  const reserve = (pool: PoolName, bytes: number, label: string) => {
    const result = broker.pools.reserve(pool, bytes, label);
    return result.ok ? result.reservation : null;
  };
  const makeTracker = () => createTextureTransferTracker({
    scene, admit: (bytes, label) => reserve("uploadOutstanding", bytes, label),
    requestRender: options.wakeWork,
  });
  let tracker = makeTracker();
  const makeDevice = (currentTracker = tracker) => createTextureDevicePorts({ scene,
    transfer: (bytes, label, submit) => currentTracker.transfer(bytes, label, submit),
    tryAdmit: (bytes, label, retain) => currentTracker.tryAdmit(bytes, label, retain),
  });
  let nativeDevice = makeDevice();
  // Canvas features borrow the same device and outstanding-transfer authority.
  const canvasDevice = createCanvasTextureDevicePorts({ scene, createCanvas: options.createCanvas,
    transfer: (bytes, label, submit) => { requireDevice(); return tracker.transfer(bytes, label, submit); },
  });
  const makeRegionDevice = (currentTracker = tracker) => createImageRegionDevicePorts({ scene,
    track: (ticket, submit) => currentTracker.track(ticket, submit),
  });
  let nativeRegionDevice = makeRegionDevice();
  const makeUploader = () => createImageTextureUploader({
    scene, limits: options.limits(), requestRender: options.wakeWork,
    createStagingCanvas: options.createCanvas,
    invalidatePublishedSource: options.invalidatePublishedSource,
  });
  let nativeUploader = makeUploader();
  const device: ImageryAtlasDevicePorts = {
    createRawTexture: request => { requireDevice(); return nativeDevice.createRawTexture(request); },
    updateTextureData: (...args) => { requireDevice(); return nativeDevice.updateTextureData(...args); },
    prepareRawTextureBatch: request => { requireDevice(); return nativeDevice.prepareRawTextureBatch(request); },
  };
  const regionDevice: ImageRegionDevicePorts = {
    createTexture: request => { requireDevice(); return nativeRegionDevice.createTexture(request); },
    copyImage: (...args) => {
      try { requireDevice(); } catch (error) { args[4].release(); throw error; }
      return nativeRegionDevice.copyImage(...args);
    },
    copyBytes: (...args) => {
      try { requireDevice(); } catch (error) { args[2].release(); throw error; }
      return nativeRegionDevice.copyBytes(...args);
    },
  };
  const uploader: ImageTextureUploader = {
    upload: request => { requireDevice(); return nativeUploader.upload(request); },
    pump: () => !stopped && !restorationNeeded ? nativeUploader.pump() : 0,
    busy: () => nativeUploader.busy(), setLimits: limits => nativeUploader.setLimits(limits),
    stats: () => nativeUploader.stats(), cancelAll: (reason, flags) => nativeUploader.cancelAll(reason, flags),
  };
  const managedAtlas: ManagedImageryAtlasResources = {
    generation: () => broker.generation(),
    reserveGpu(bytes, label, flags) {
      const result = broker.pools.reserve("sourceGpu", bytes, label, flags);
      return result.ok ? result.reservation : null;
    },
    reserveTable: (bytes, label) => reserve("decoded", bytes, label),
    reserveCopy(bytes, label) {
      const result = broker.pools.reserve("decoded", bytes, label);
      if (!result.ok) throw new ResourceCapacityError(result.pool, result.reason);
      return result.reservation;
    },
    canUpload: (bytes, extra = 0) => broker.pools.fits("uploadOutstanding", bytes) && broker.pools.fits("decoded", bytes + extra),
    subscribeAvailable: listener => broker.pools.subscribeAvailable(listener),
    capacityKey() {
      const stats = broker.pools.stats();
      return JSON.stringify((["sourceGpu", "decoded", "encoded", "uploadOutstanding", "overlap"] as const)
        .map(name => [name, stats[name].limit, stats[name].reserved]));
    },
  };
  const restoreManagedDevice = () => {
    if (stopped) throw new Error("The Earth native resource host has been disposed.");
    if (restorationNeeded) {
      const nextTracker = makeTracker();
      try {
        const nextDevice = makeDevice(nextTracker), nextRegionDevice = makeRegionDevice(nextTracker);
        const nextUploader = makeUploader();
        tracker = nextTracker; nativeDevice = nextDevice; nativeRegionDevice = nextRegionDevice;
        nativeUploader = nextUploader; restorationNeeded = false;
      } catch (error) {
        try { nextTracker.dispose(); } catch (cleanup) {
          throw new AggregateError([error, cleanup], "Earth device restoration and cleanup failed.");
        }
        throw error;
      }
    }
    return device;
  };
  return {
    device, canvasDevice, regionDevice, uploader, managedAtlas, restoreManagedDevice,
    resourceWork: { prepare() {
      if (stopped || restorationNeeded) return;
      attemptEarthCleanup([() => uploader.pump(), () => tracker.pump()], "Earth resource pumping failed.");
    } },
    observedDeviceLoss() {
      if (stopped || restorationNeeded) return;
      restorationNeeded = true;
      attemptEarthCleanup([
        () => tracker.deviceLost(), () => uploader.cancelAll("Observed device loss", { deviceLost: true }),
        () => broker.invalidate(),
      ], "Earth device-loss cleanup failed.");
    },
    dispose() {
      if (stopped) return;
      stopped = true;
      attemptEarthCleanup([() => uploader.cancelAll("Earth host disposed"), () => tracker.dispose()], "Earth native resource cleanup failed.");
    },
  };
}
