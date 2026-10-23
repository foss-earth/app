# Add image

Open **+ → Add image** in either FOSS Earth window. The tab offers two workflows.

**Google 360°** opens Google's own interactive viewer inside the tab. Paste a
Google Maps Street View URL, panorama ID, or the URL/iframe code from Google's
**Share → Embed** control. Expanded Maps panorama links and links containing a
panorama ID are supported. Short share links and Earth links without a readable
panorama identity need to be opened in Maps and expanded first. Arbitrary remote
iframe addresses are refused.

An official Share/Embed URL can work without adding a key here. A raw panorama
ID uses the existing Google Maps key configured by the application or in **Map**;
that key must allow Maps Embed API on the hosting origin. The tab creates no new
saved credential or saved provider-URL record. Google supplies the controls,
image and attribution. **Open in Google Maps** provides a separate fallback link
without the API key. This viewer does not download an original, export provider
pixels or turn a Maps page into a FOSS Earth asset.

The endpoint and iframe policy follow Google's [Maps Embed documentation](https://developers.google.com/maps/documentation/embed/embedding-map),
and fallback links follow its [Maps URL documentation](https://developers.google.com/maps/documentation/urls/get-started).

**Prepared panorama** adds a photographed original to a scene draft. Prepare a
full 2:1 original with `foss-earth-prepare-panorama` first; use a file you own or
have permission to reuse, with its credit and known orientation provenance.
The preparation command's `--help` lists the preview, whole-image and EAC tile
options. It writes `asset.fragment.json` and a separate preparation record.

The shared `foss-earth-download-panorama` command can also retrieve your own
Google 360 originals through Street View Publish API. Set
`STREETVIEW_PUBLISH_ACCESS_TOKEN` in your shell using your own OAuth token with
the `streetviewpublish` scope, then identify and prepare a photo:

```sh
foss-earth-download-panorama --list
foss-earth-download-panorama --photo-id OWN_PHOTO_ID --out build/original \
  --prepare-out public/media/my-photo --attribution "Photo by ..." \
  --pose pose.json -- --asset-id my-photo --url-prefix media/my-photo/
```

The token stays in the environment; do not put it in a scene, URL, command
argument or committed file. This workflow uses an OAuth token for the photo
owner, separate from the Maps key used for embedded viewing. An explicitly
permitted original URL can instead be passed with `--url`. The public Node
entry is `@foss-earth/sphere-image/download`, which exports
`downloadPanorama`, `listOwnStreetViewPhotos` and `downloadAndPreparePanorama`.
See the image owner's [download and import guide](https://github.com/foss-earth/sphere-image/blob/main/docs/download-and-import.md)
for OAuth, original acquisition, pose and conversion details.

1. Choose an existing scene JSON file, or leave it empty to start **My scene**.
   An existing file also needs its original published scene URL so relative
   image and preview-sheet references continue to work after export.
2. Choose `asset.fragment.json`. Enter the media base URL against which the
   fragment's URLs resolve, including any preparation `--url-prefix`.
3. Enter a unique panorama ID, title, latitude and longitude. Capture height
   remains unknown. Credit and orientation come from the prepared fragment.
4. **Add to draft** assembles an independent document using the public Scenes
   authoring helper and validates it with the application's normal image-owner
   catalogue. Subsequent additions build on that draft.
5. **Download scene** keeps the JSON. **Preview scene** replaces the scene loaded
   in this visit and enters the added panorama; it requires an already-loaded
   scene and reachable prepared media. The original input file is unchanged.

Drafts and chosen files are held in this tab's memory. Download before closing
it or reloading. Downloading a manifest does not publish its media or the tour.
