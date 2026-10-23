import { useState, type FormEvent } from "react";
import type { SceneDocument } from "@foss-earth/scenes";
import type { GlobeAppHandle } from "../createGlobeApp";
import { googlePanoramaEmbedUrl, parseGooglePanoramaSource } from "./googleSource";
import "./add-image.css";

const JSON_LIMIT = 2 * 1024 * 1024;
const explain = (error: unknown): string => error instanceof Error ? error.message : String(error);

async function readJson(file: File): Promise<unknown> {
  if (file.size > JSON_LIMIT) throw new Error("Choose a JSON file smaller than 2 MiB.");
  try { return JSON.parse(await file.text()); }
  catch { throw new Error(`${file.name} is not valid JSON.`); }
}

function emptyScene(): SceneDocument {
  return { format: "foss-earth-scene", version: 1, id: "my-scene", revision: "draft", title: "My scene", assets: [], entities: [] };
}

function downloadScene(scene: SceneDocument): void {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(scene, null, 2)}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${scene.id}.scene.json`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const ADD_IMAGE_TAB = "add-image";

/** Provider viewing and prepared originals use distinct paths, in one ordinary window tab. */
export function AddImageTab({ app }: { app: GlobeAppHandle }) {
  const [mode, setMode] = useState<"google" | "prepared">("google");
  const [address, setAddress] = useState("");
  const [viewer, setViewer] = useState<{ url: string; sourceUrl: string } | null>(null);
  const [googleError, setGoogleError] = useState("");
  const [scene, setScene] = useState<unknown>(null);
  const [sceneName, setSceneName] = useState("");
  const [fragment, setFragment] = useState<unknown>(null);
  const [fragmentName, setFragmentName] = useState("");
  const [sceneBase, setSceneBase] = useState("");
  const [mediaBase, setMediaBase] = useState("");
  const [id, setId] = useState("my-panorama");
  const [title, setTitle] = useState("My panorama");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<SceneDocument | null>(null);
  const [draftId, setDraftId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const openGoogle = (event: FormEvent): void => {
    event.preventDefault();
    setGoogleError("");
    try {
      const source = parseGooglePanoramaSource(address);
      setViewer({ url: googlePanoramaEmbedUrl(source, app.googleMapsApiKey?.()), sourceUrl: source.sourceUrl });
    } catch (cause) { setGoogleError(explain(cause)); }
  };

  const chooseJson = async (file: File | undefined, kind: "scene" | "fragment"): Promise<void> => {
    if (!file) return;
    setError("");
    try {
      const value = await readJson(file);
      setMessage("");
      if (kind === "scene") { setScene(value); setSceneName(file.name); setDraft(null); }
      else { setFragment(value); setFragmentName(file.name); }
    } catch (cause) { setError(explain(cause)); }
  };

  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (!fragment) throw new Error("Choose asset.fragment.json from panorama preparation.");
      if (scene && !sceneBase.trim()) throw new Error("Enter the original scene's published URL so its existing media stays linked correctly.");
      const [{ addPreparedPanorama }, { validateScene }] = await Promise.all([
        import("@foss-earth/scenes/authoring"), import("foss-earth/scenes"),
      ]);
      const output = addPreparedPanorama(draft ?? scene ?? emptyScene(), fragment, {
        id: id.trim(), title: title.trim(), latitudeDeg: Number(latitude), longitudeDeg: Number(longitude),
        description, mediaBaseUrl: mediaBase.trim(), ...(sceneBase.trim() ? { sceneBaseUrl: sceneBase.trim() } : {}),
      });
      const validation = validateScene(output);
      if (!validation.ok) throw new Error(validation.errors.map(item => `${item.path}: ${item.message}`).join("\n"));
      setDraft(output);
      setDraftId(id.trim());
      setMessage(`${title.trim()} is in the draft. Download the scene to keep it.`);
    } catch (cause) { setError(explain(cause)); }
    finally { setBusy(false); }
  };

  const preview = async (): Promise<void> => {
    if (!draft) return;
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const handle = app.scenes.handle();
      if (!handle) throw new Error("Load a scene in Scenes before previewing, or download this draft for your tour.");
      const result = await handle.replace(draft as unknown as Record<string, unknown>);
      if (!result.ok) throw new Error(result.errors.map(item => `${item.path}: ${item.message}`).join("\n"));
      const entered = await handle.enter(draftId);
      if (!entered.ok) throw new Error(entered.message);
      setMessage("The draft is showing in this visit. Download it to keep the scene; publish its prepared media separately.");
    } catch (cause) { setError(explain(cause)); }
    finally { setBusy(false); }
  };

  return <div className="foss-earth-add-image">
    <div className="foss-earth-add-image__choices" role="group" aria-label="Image source">
      <button type="button" className="foss-earth-choice" aria-pressed={mode === "google"} onClick={() => setMode("google")}>Google 360°</button>
      <button type="button" className="foss-earth-choice" aria-pressed={mode === "prepared"} onClick={() => setMode("prepared")}>Prepared panorama</button>
    </div>
    {mode === "google" ? <>
      <form className="foss-earth-add-image__form" onSubmit={openGoogle}>
        <label>Maps / Earth 360° <input value={address} onChange={event => setAddress(event.target.value)} placeholder="Panorama link, ID or Google embed URL" autoComplete="off" spellCheck={false} required /></label>
        <div className="foss-earth-add-image__row"><button type="submit" className="foss-earth-choice">View</button><details className="foss-earth-add-image__help"><summary aria-label="Explain Google panorama viewing">?</summary><p>Paste the expanded Street View link or Google's Share → Embed URL. Panorama IDs use the Google Maps key already configured in Map. This tab keeps Google's viewer and credits. It does not download provider imagery.</p></details></div>
      </form>
      {googleError ? <p className="foss-earth-add-image__error" role="alert">{googleError}</p> : null}
      {viewer ? <div className="foss-earth-add-image__viewer"><iframe key={viewer.url} src={viewer.url} title="Google Street View panorama" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /><a href={viewer.sourceUrl} target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a></div> : null}
      <p className="foss-earth-add-image__note">To add your own photograph to a scene, prepare its original file and choose Prepared panorama.</p>
    </> : <>
      <form className="foss-earth-add-image__form" onSubmit={event => { void add(event); }}>
        <label>Scene JSON <input type="file" accept="application/json,.json" onChange={event => { void chooseJson(event.target.files?.[0], "scene"); event.target.value = ""; }} /></label>
        <span className="foss-earth-add-image__note">{sceneName || "No file: starts a new scene."}</span>
        {sceneName ? <label>Scene URL <input type="url" value={sceneBase} onChange={event => setSceneBase(event.target.value)} placeholder="https://example.org/tour/scene.json" required /></label> : null}
        <label>Prepared fragment <input type="file" accept="application/json,.json" onChange={event => { void chooseJson(event.target.files?.[0], "fragment"); event.target.value = ""; }} /></label>
        {fragmentName ? <span className="foss-earth-add-image__note">{fragmentName}</span> : null}
        <label>Media base URL <input type="url" value={mediaBase} onChange={event => setMediaBase(event.target.value)} placeholder="https://example.org/tour/" required /></label>
        <div className="foss-earth-add-image__row"><label>ID <input className="foss-earth-add-image__short" value={id} onChange={event => setId(event.target.value)} required pattern="[A-Za-z0-9._-]+" /></label><label>Title <input value={title} onChange={event => setTitle(event.target.value)} required /></label></div>
        <div className="foss-earth-add-image__row"><label>Latitude <input className="foss-earth-add-image__number" type="number" step="any" min="-90" max="90" value={latitude} onChange={event => setLatitude(event.target.value)} required /></label><label>Longitude <input className="foss-earth-add-image__number" type="number" step="any" min="-180" max="180" value={longitude} onChange={event => setLongitude(event.target.value)} required /></label></div>
        <label>Description <textarea rows={2} value={description} onChange={event => setDescription(event.target.value)} /></label>
        <div className="foss-earth-add-image__row"><button className="foss-earth-choice" type="submit" disabled={busy || !fragment}>Add to draft</button><details className="foss-earth-add-image__help"><summary aria-label="Explain prepared panorama import">?</summary><p>Choose asset.fragment.json produced by foss-earth-prepare-panorama. Media base URL resolves the fragment's relative paths, including its preparation URL prefix. Coordinates are your photograph's capture location; its unknown height remains unknown. Credits and orientation come from the prepared fragment. Preview changes this visit; Download keeps the draft.</p><pre>foss-earth-prepare-panorama --help</pre><p>Use an original you own or have permission to reuse. Google viewer links are references, not downloadable original files.</p></details></div>
      </form>
      <div className="foss-earth-add-image__row"><button className="foss-earth-choice" type="button" disabled={!draft || busy} onClick={() => { if (draft) downloadScene(draft); }}>Download scene</button><button className="foss-earth-choice" type="button" disabled={!draft || busy} onClick={() => { void preview(); }}>Preview scene</button></div>
      {busy ? <p role="status">Preparing the draft…</p> : null}
      {message ? <p className="foss-earth-add-image__note" role="status">{message}</p> : null}
      {error ? <p className="foss-earth-add-image__error" role="alert">{error}</p> : null}
    </>}
  </div>;
}
