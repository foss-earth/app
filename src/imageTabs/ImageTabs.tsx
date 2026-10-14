/**
 * The image tabs' window contents: the Open image tab, and the one image
 * surface a single image tab or two joined ones show
 * (docs/proposals/shared-image-viewer-implementation.md §4–§8).
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { IMAGE_SURFACE_KEYS, type ImageSideView, type ImageSurfaceHost, type ImageSurfaceView } from "./imageSurfaceHost";
import { useImageView } from "./useImageTabs";
import "./imageTabs.css";

export function OpenImageTab({ host }: { host: ImageSurfaceHost }) {
  const view = useImageView(host);
  const [address, setAddress] = useState("");
  const file = useRef<HTMLInputElement | null>(null);
  const busy = view.opening.busy;
  return <div className="foss-earth-image-open">
    <p className="foss-earth-image-open__lead">
      Opens a JPEG or PNG image at its own size in a tab of this window. With an image selected in each window, the two are compared.
    </p>
    <div className="foss-earth-image-open__row">
      <button type="button" className="foss-earth-image-button" disabled={busy} onClick={() => file.current?.click()}>Choose file…</button>
      <input ref={file} type="file" accept="image/jpeg,image/png" hidden onChange={event => {
        const chosen = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (chosen) void host.openFile(chosen);
      }} />
    </div>
    <form className="foss-earth-image-open__row" onSubmit={event => {
      event.preventDefault();
      void host.openUrl(address).then(opened => { if (opened) setAddress(""); });
    }}>
      <input className="foss-earth-image-open__address" type="text" inputMode="url" spellCheck={false} autoComplete="off"
        placeholder="https://example.org/photo.jpg" aria-label="Image address" value={address}
        onChange={event => setAddress(event.currentTarget.value)} />
      <button type="submit" className="foss-earth-image-button" disabled={busy || !address.trim()}>Open</button>
    </form>
    {busy ? <p role="status" className="foss-earth-image-open__status">Reading the image…</p> : null}
    {view.opening.error ? <p role="alert" className="foss-earth-image-open__error">{view.opening.error}</p> : null}
    <p className="foss-earth-image-open__note">
      Only static, opaque sRGB images are shown, pixel for pixel and never reduced. A file chosen here stays for this visit; after a reload, choose it again.
    </p>
  </div>;
}

const STATUS_TEXT: Record<ImageSideView["status"], string> = {
  loading: "Loading…", ready: "", failed: "Could not be shown", waiting: "Waiting for the graphics device…", unshown: "Not shown",
};

function percent(value: number): string {
  return `${Number((value * 100).toPrecision(value >= 0.995 && value <= 1.005 ? 4 : 3))}%`;
}

function Readout({ view }: { view: ImageSurfaceView }) {
  const focused = view.focused, resolution = view.resolution;
  if (!focused || view.pixelsPerTexel === null) return null;
  const name = view.sides.length > 1 ? `${focused.title}: ` : "";
  const native = view.native?.aligned ? "1:1, on pixels" : view.native?.scale ? "1:1, between pixels" : percent(view.pixelsPerTexel);
  const unit = resolution && !resolution.displayPixels ? "drawn pixels" : "screen pixels";
  return <span className="foss-earth-image-toolbar__readout" title={`Drawn pixels per pixel of ${focused.title}`}>{name}{native} <span className="foss-earth-image-toolbar__unit">{unit}</span></span>;
}

/** Whether 1:1 means one image pixel per display pixel here, and how to make it so. */
function ResolutionNote({ view }: { view: ImageSurfaceView }) {
  const resolution = view.resolution;
  if (!resolution || resolution.displayPixels || view.presentation === "none" || view.presentation === "incompatible") return null;
  const drawn = Number(resolution.pixelsPerCss.toFixed(3)), display = Number(resolution.devicePixelRatio.toFixed(3));
  return <p className="foss-earth-image-note">
    This page draws {drawn} pixels per CSS pixel and the display has {display}, so 1:1 is one image pixel per drawn pixel, not per display pixel.
    Renderer → Resolution at 1 makes them the same.
  </p>;
}

function Toolbar({ host, view, tabId }: { host: ImageSurfaceHost; view: ImageSurfaceView; tabId: string | null }) {
  const showing = view.presentation === "single" || view.presentation === "pair";
  const focused = view.focused;
  return <div className="foss-earth-image-toolbar">
    <div className="foss-earth-image-toolbar__row" role="toolbar" aria-label="Image view">
      <button type="button" className="foss-earth-image-button" disabled={!showing} onClick={() => host.fit()} title="Show the whole image">Fit</button>
      <button type="button" className="foss-earth-image-button" disabled={!showing || !focused} onClick={() => host.native()}
        title={focused ? `One pixel of ${focused.title} per drawn pixel` : undefined}>
        1:1{view.sides.length > 1 && focused ? ` ${focused.side === "left" ? "left" : "right"}` : ""}
      </button>
      <label className="foss-earth-image-toolbar__field">
        <span>Pixels</span>
        <select value={view.sampling} onChange={event => host.setSampling(event.currentTarget.value === "nearest" ? "nearest" : "linear")}>
          <option value="linear">Smooth</option>
          <option value="nearest">Square</option>
        </select>
      </label>
      {tabId ? <button type="button" className="foss-earth-image-button" onClick={() => host.duplicate(tabId)}
        title="Another tab of this image in the other window, to compare it with itself">Open in other window</button> : null}
      <Readout view={view} />
    </div>
    {view.nativeProblem ? <p role="alert" className="foss-earth-image-note foss-earth-image-note--problem">{view.nativeProblem}</p> : null}
    <ResolutionNote view={view} />
  </div>;
}

function Wipe({ host, view, left, right }: { host: ImageSurfaceHost; view: ImageSurfaceView; left: ImageSideView; right: ImageSideView }) {
  const drag = useRef<{ id: number; rect: DOMRect } | null>(null);
  const handle = useRef<HTMLDivElement | null>(null);
  // Native, so the surface's own pointer listeners, which pan and take focus,
  // never see a press on the handle: React's would run after theirs.
  useLayoutEffect(() => {
    const element = handle.current!;
    const down = (event: globalThis.PointerEvent): void => {
      event.stopPropagation();
      event.preventDefault();
      const surface = element.closest(".foss-earth-image-surface");
      if (!surface) return;
      element.focus({ preventScroll: true });
      element.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, rect: surface.getBoundingClientRect() };
    };
    element.addEventListener("pointerdown", down);
    return () => element.removeEventListener("pointerdown", down);
  }, []);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId || !(current.rect.width > 0)) return;
    host.setWipe((event.clientX - current.rect.left) / current.rect.width);
  };
  const keys: Record<string, (wipe: number) => number> = {
    ArrowLeft: wipe => wipe - 0.01, ArrowDown: wipe => wipe - 0.01, ArrowRight: wipe => wipe + 0.01, ArrowUp: wipe => wipe + 0.01,
    PageDown: wipe => wipe - 0.1, PageUp: wipe => wipe + 0.1, Home: () => 0, End: () => 1,
  };
  const value = Math.round(view.wipe * 100);
  return <div className="foss-earth-image-wipe" style={{ left: `${view.wipe * 100}%` }}>
    <div ref={handle} className="foss-earth-image-wipe__handle" role="slider" tabIndex={0}
      aria-label={`Wipe between ${left.title} and ${right.title}`} aria-orientation="horizontal"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}
      aria-valuetext={`${value}% ${left.title}, ${100 - value}% ${right.title}`}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const next = keys[event.key];
        if (!next) return;
        event.preventDefault();
        host.setWipe(next(view.wipe));
      }}
      onPointerMove={move}
      onPointerUp={event => { move(event); drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }} />
  </div>;
}

function SideLabel({ side, placement }: { side: ImageSideView; placement: "left" | "right" | "single" }) {
  const status = STATUS_TEXT[side.status];
  return <div className={`foss-earth-image-label foss-earth-image-label--${placement}`}>
    <span className="foss-earth-image-label__title">{side.title}</span>
    <span className="foss-earth-image-label__size">{side.width} × {side.height}</span>
    {status ? <span className="foss-earth-image-label__status">{status}</span> : null}
  </div>;
}

function Message({ children }: { children: string }) {
  return <p className="foss-earth-image-message" role="status">{children}</p>;
}

/** The surface of one image tab, or of two joined ones when `tabId` is null. */
export function ImageSurfaceBody({ host, tabId }: { host: ImageSurfaceHost; tabId: string | null }) {
  const view = useImageView(host);
  const surface = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => host.attachSurface(surface.current!), [host]);
  const [left, right] = view.sides.length === 2 ? view.sides : [null, null];
  const single = view.sides.length === 1 ? view.sides[0] : null;
  const failures = view.sides.filter(side => side.error).map(side => side.error!);
  const titles = view.sides.map(side => side.title).join(" and ") || "No image";
  return <div className="foss-earth-image-tab">
    <Toolbar host={host} view={view} tabId={tabId} />
    <div ref={surface} className="foss-earth-image-surface" tabIndex={0} data-takes-keys={IMAGE_SURFACE_KEYS}
      aria-label={`${titles}. Drag to move, wheel or pinch to zoom; arrow keys move and + and − zoom. Escape returns the keys to the globe.`}>
      {view.presentation === "pair" && left && right ? <>
        <Wipe host={host} view={view} left={left} right={right} />
        <SideLabel side={left} placement="left" />
        <SideLabel side={right} placement="right" />
      </> : null}
      {single ? <SideLabel side={single} placement="single" /> : null}
      {view.unavailable ? <Message>{`Images cannot be drawn here: ${view.unavailable}`}</Message>
        : view.incompatibleReason ? <Message>{view.incompatibleReason}</Message>
            : failures.length ? <Message>{failures.join(" ")}</Message>
              : view.presentation === "none" ? <Message>No image is selected.</Message> : null}
    </div>
  </div>;
}
