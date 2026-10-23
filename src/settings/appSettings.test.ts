// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { getAppSettings, resetAppSettings } from "./appSettings";
import { SETTINGS_STORAGE_KEY } from "./registry";

function savedValues(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}").values ?? {};
}

afterEach(() => { window.history.replaceState(null, "", "/"); });

describe("the app registry and the address bar", () => {
  it("keeps a host's saved namespace until registration while cleaning retired Earth settings", () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, values: {
      "osfs.aircraft.id": "f-35b", "map.retiredSetting": true,
    } }));
    const settings = getAppSettings();
    expect(savedValues()).toEqual({ "osfs.aircraft.id": "f-35b" });
    settings.reload();
    expect(savedValues()).toEqual({ "osfs.aircraft.id": "f-35b" });
    settings.register([{
      id: "osfs.aircraft.id", label: "Aircraft", description: "The flight's aircraft.",
      kind: "choice", unit: "none", choices: [{ id: "cessna-172", label: "C172" }, { id: "f-35b", label: "F-35B" }],
      default: "cessna-172", defaultReason: "The trainer.", home: { tab: "aircraft", section: "model", level: "main" },
      appliesLive: true, source: "src/flight/settings.ts",
    }]);
    expect(settings.get("osfs.aircraft.id")).toBe("f-35b");
  });

  it.each(["gkey", "key", "googleKey"])("saves a %s given in the query on this device and takes it off the address bar", name => {
    const state = { fossEarthScene: { id: "campus" } };
    window.history.replaceState(state, "", `/fly/?${name}=abc&scene=campus&set.map.source.cartoKey=c#invite`);
    const settings = getAppSettings();

    expect(settings.inspect("map.source.googleKey")).toMatchObject({ value: "abc", provenance: "user" });
    expect(settings.get("map.source.cartoKey")).toBe("c");
    expect(savedValues()).toMatchObject({ "map.source.googleKey": "abc", "map.source.cartoKey": "c" });
    expect(settings.sessionValueIds()).toEqual([]);
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe("/fly/?scene=campus#invite");
    expect(window.history.state).toEqual(state);
  });

  it("replaces a saved key with one from the query", () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, values: { "map.source.googleKey": "old" } }));
    window.history.replaceState(null, "", "/?googleKey=new");

    expect(getAppSettings().get("map.source.googleKey")).toBe("new");
    expect(window.location.search).toBe("");
  });

  it("prefers gkey over older URL names and removes every credential alias", () => {
    window.history.replaceState(null, "", "/?key=old&googleKey=older&gkey=new&scene=campus");
    expect(getAppSettings().get("map.source.googleKey")).toBe("new");
    expect(savedValues()["map.source.googleKey"]).toBe("new");
    expect(window.location.search).toBe("?scene=campus");
  });

  it.each(["gkey", "key", "googleKey"])("adopts a legacy device %s without requiring another URL", name => {
    localStorage.setItem(name, " legacy-device-key ");
    expect(getAppSettings().get("map.source.googleKey")).toBe("legacy-device-key");
    expect(savedValues()["map.source.googleKey"]).toBe("legacy-device-key");
    // A later save wins permanently over the old record, including after reload.
    getAppSettings().set("map.source.googleKey", "replacement");
    resetAppSettings();
    expect(getAppSettings().get("map.source.googleKey")).toBe("replacement");
  });

  it("prefers raw gkey over legacy names without replacing the current saved setting", () => {
    localStorage.setItem("key", "old-device-key");
    localStorage.setItem("gkey", "new-device-key");
    expect(getAppSettings().get("map.source.googleKey")).toBe("new-device-key");

    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, values: { "map.source.googleKey": "current-setting" } }));
    resetAppSettings();
    expect(getAppSettings().get("map.source.googleKey")).toBe("current-setting");
  });

  it("keeps a key previously saved from a legacy URL across the gkey rename", () => {
    window.history.replaceState(null, "", "/?key=previously-saved");
    getAppSettings();
    resetAppSettings();
    expect(window.location.search).toBe("");
    expect(getAppSettings().get("map.source.googleKey")).toBe("previously-saved");
  });

  it("writes the basemap and elevation provider chosen anywhere to the query, under the names it reads", () => {
    window.history.replaceState(null, "", "/?tiles=usgs-topo&set.map.source.elevation=aws-terrarium&scene=campus");
    const settings = getAppSettings();
    // Read as given: nothing changed, so nothing is rewritten.
    expect(window.location.search).toBe("?tiles=usgs-topo&set.map.source.elevation=aws-terrarium&scene=campus");

    settings.set("map.source.basemap", "osm-standard");
    // Mapterhorn is the default: choosing it is still a choice.
    settings.set("map.source.elevation", "mapterhorn");
    expect(window.location.search).toBe("?scene=campus&mapSource=osm-standard&elevationSource=mapterhorn");

    settings.reset("map.source.basemap");
    expect(window.location.search).toBe("?scene=campus&mapSource=usgs-imagery-topo&elevationSource=mapterhorn");
  });

  it("names nothing while only a default moves, and names the default once it is chosen", () => {
    window.history.replaceState(null, "", "/?scene=campus");
    const settings = getAppSettings();
    settings.setHostDefault("map.source.basemap", "google", "a Google Maps API key was given");
    expect(window.location.search).toBe("?scene=campus");

    settings.set("map.source.basemap", "osm-standard");
    settings.set("map.source.basemap", "google");
    expect(settings.inspect("map.source.basemap").provenance).toBe("host-default");
    expect(window.location.search).toBe("?scene=campus&mapSource=google");
  });

  it("gives the query the values in use again after Back or Forward, keeping the entry's state", () => {
    window.history.replaceState(null, "", "/?scene=campus");
    const settings = getAppSettings();
    settings.set("map.source.basemap", "osm-standard");
    // Back to an entry a scene pushed before the choice: its URL comes back with it.
    const entry = { fossEarthScene: { destination: "northrop" } };
    window.history.replaceState(entry, "", "/?scene=campus&mapSource=usgs-topo");
    window.dispatchEvent(new PopStateEvent("popstate", { state: entry }));

    expect(window.location.search).toBe("?scene=campus&mapSource=osm-standard");
    expect(window.history.state).toEqual(entry);
  });

  it("leaves the query alone while a host forces the basemap", () => {
    window.history.replaceState(null, "", "/?mapSource=usgs-topo");
    const release = getAppSettings().force("map.source.basemap", "osm-standard", "a test");
    expect(window.location.search).toBe("?mapSource=usgs-topo");
    release();
    expect(window.location.search).toBe("?mapSource=usgs-topo");
  });
});

describe("the developer tools' settings", () => {
  afterEach(() => { resetAppSettings(); });

  it("are registered only on a page opened with ?dev=1", () => {
    window.history.replaceState(null, "", "/tour/minneapolis/");
    resetAppSettings();
    expect(getAppSettings().has("input.showCompassCenter")).toBe(false);

    window.history.replaceState(null, "", "/tour/minneapolis/?dev=1&set.input.showCompassCenter=true");
    resetAppSettings();
    expect(getAppSettings().get("input.showCompassCenter")).toBe(true);
  });
});
