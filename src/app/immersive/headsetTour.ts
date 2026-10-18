/**
 * What a headset shows and does on the tour: the open photograph's links as
 * markers to point at, the controllers' pointer rays, and following a link or
 * entering a photograph on the map with a controller's trigger or a pinch.
 */
import {
  Color3, Constants, DynamicTexture, Matrix, Mesh, CreateCylinder, CreateDisc, CreatePlane, Quaternion, StandardMaterial, Vector3, type Scene,
} from "@babylonjs/core";
import { add, cross, scale, sub, type Vec3 } from "@foss-earth/engine";
import { pointedAt } from "./xrMath";

export interface HeadsetRay { origin: Vec3; direction: Vec3 }

export interface HeadsetLink { id: string; label: string; direction: Vec3 }

export interface HeadsetTourOptions {
  scene: Scene;
  /** Layers the markers draw on: every camera's, including one showing only the presentation layer. */
  layerMask: number;
  /** The open photograph's links as world directions; none on the map. */
  links(): readonly HeadsetLink[];
  /** The photographs on the map along a ray, nearest first. */
  pickImages(ray: HeadsetRay): readonly string[];
  hoverImage(id: string | null): void;
  follow(linkId: string): void;
  enter(imageId: string): void;
  /** Leaves the photograph for the map. */
  back(): void;
}

export interface HeadsetTour {
  /** Places the markers around the eye and follows what each ray points at. */
  frame(eye: Vec3, up: Vec3, rays: readonly HeadsetRay[]): void;
  /** A trigger press or pinch along `ray`. */
  select(ray: HeadsetRay): void;
  back(): void;
  dispose(): void;
}

/** How far the markers float from the eye, metres: far enough to look past, near enough to read. */
const MARKER_DISTANCE = 10;
const MARKER_RADIUS = 0.3;
/** A marker is pointed at within this angle of its centre, as seen from the controller. */
const MARKER_REACH_DEG = 4;
const LASER_LENGTH = 30;
const LASER_DIAMETER = 0.006;
/** Drawn after the photograph (group 2), with the device-position marker. */
const OVERLAY_GROUP = 3;

const IDLE = new Color3(1, 1, 1);
const ACTIVE = new Color3(0.35, 0.75, 1);

type Marker = { link: HeadsetLink; disc: Mesh; label: Mesh; material: StandardMaterial; texture: DynamicTexture; labelMaterial: StandardMaterial };

export function createHeadsetTour(options: HeadsetTourOptions): HeadsetTour {
  const { scene } = options;
  const markers = new Map<string, Marker>();
  const lasers: Mesh[] = [];
  let hoveredLink: string | null = null;
  let hoveredImage: string | null = null;
  let disposed = false;
  const overlay = (material: StandardMaterial): StandardMaterial => {
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.depthFunction = Constants.ALWAYS;
    return material;
  };
  const place = (mesh: Mesh): Mesh => {
    mesh.isPickable = false;
    mesh.renderingGroupId = OVERLAY_GROUP;
    mesh.layerMask = options.layerMask;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.rotationQuaternion = new Quaternion();
    return mesh;
  };
  const laserMaterial = overlay(new StandardMaterial("headset-laser", scene));
  laserMaterial.emissiveColor = ACTIVE;
  laserMaterial.alpha = 0.7;

  function createMarker(link: HeadsetLink): Marker {
    const material = overlay(new StandardMaterial(`headset-link-${link.id}`, scene));
    material.emissiveColor = IDLE;
    material.alpha = 0.55;
    const disc = place(CreateDisc(`headset-link-${link.id}`, { radius: MARKER_RADIUS, tessellation: 48 }, scene));
    disc.material = material;
    const texture = new DynamicTexture(`headset-link-label-${link.id}`, { width: 1024, height: 192 }, scene, true);
    texture.hasAlpha = true;
    const labelMaterial = overlay(new StandardMaterial(`headset-link-label-${link.id}`, scene));
    labelMaterial.emissiveTexture = texture;
    labelMaterial.opacityTexture = texture;
    const label = place(CreatePlane(`headset-link-label-${link.id}`, { width: 3.2, height: 0.6 }, scene));
    label.material = labelMaterial;
    const marker = { link, disc, label, material, texture, labelMaterial };
    drawLabel(marker);
    return marker;
  }
  function drawLabel(marker: Marker): void {
    const { texture } = marker;
    // A browser's DynamicTexture draws on a 2D canvas, wider than Babylon's own context type.
    const context = texture.getContext() as unknown as CanvasRenderingContext2D;
    const size = texture.getSize();
    context.clearRect(0, 0, size.width, size.height);
    context.font = "600 72px system-ui, sans-serif";
    const text = marker.link.label || "Go";
    const width = Math.min(size.width - 16, context.measureText(text).width + 64);
    context.fillStyle = "rgba(0, 0, 0, 0.6)";
    context.beginPath();
    context.roundRect((size.width - width) / 2, 24, width, size.height - 48, 48);
    context.fill();
    context.fillStyle = "white";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, size.width / 2, size.height / 2, size.width - 80);
    texture.update(true);
  }
  function disposeMarker(marker: Marker): void {
    marker.disc.dispose();
    marker.label.dispose();
    marker.material.dispose();
    marker.labelMaterial.dispose();
    marker.texture.dispose();
  }

  /** Faces a mesh at `position` toward the eye, upright: its +z toward the eye reads correctly in a right-handed scene. */
  const rotation = new Matrix();
  function face(mesh: Mesh, position: Vec3, toEye: Vec3, up: Vec3): void {
    const right = normalize(cross(up, toEye));
    const upright = cross(toEye, right);
    Matrix.FromValuesToRef(right[0], right[1], right[2], 0, upright[0], upright[1], upright[2], 0, toEye[0], toEye[1], toEye[2], 0, 0, 0, 0, 1, rotation);
    Quaternion.FromRotationMatrixToRef(rotation, mesh.rotationQuaternion!);
    mesh.position.set(position[0], position[1], position[2]);
  }

  const markerPoint = (eye: Vec3, link: HeadsetLink): Vec3 => add(eye, scale(normalize(link.direction), MARKER_DISTANCE));
  function hoveredFor(eye: Vec3, rays: readonly HeadsetRay[]): { link: string | null; image: string | null } {
    const shown = [...markers.values()];
    for (const ray of rays) {
      const hit = pointedAt(shown.map(marker => ({ id: marker.link.id, direction: sub(markerPoint(eye, marker.link), ray.origin), reachDeg: MARKER_REACH_DEG })), ray.direction);
      if (hit) return { link: hit.id, image: null };
    }
    if (shown.length) return { link: null, image: null };
    for (const ray of rays) {
      const image = options.pickImages(ray)[0];
      if (image) return { link: null, image };
    }
    return { link: null, image: null };
  }

  return {
    frame(eye, up, rays) {
      if (disposed) return;
      const links = options.links();
      const seen = new Set<string>();
      for (const link of links) {
        seen.add(link.id);
        const current = markers.get(link.id);
        if (!current) markers.set(link.id, createMarker(link));
        else {
          const relabel = current.link.label !== link.label;
          current.link = link;
          if (relabel) drawLabel(current);
        }
      }
      for (const [id, marker] of markers) if (!seen.has(id)) { disposeMarker(marker); markers.delete(id); }
      const hovered = hoveredFor(eye, rays);
      hoveredLink = hovered.link;
      if (hovered.image !== hoveredImage) { hoveredImage = hovered.image; options.hoverImage(hoveredImage); }
      for (const marker of markers.values()) {
        const point = markerPoint(eye, marker.link);
        const toEye = normalize(sub(eye, point));
        const active = marker.link.id === hoveredLink;
        face(marker.disc, point, toEye, up);
        // The label sits under its marker, along the marker's own upright axis.
        const below = cross(toEye, normalize(cross(up, toEye)));
        face(marker.label, add(point, scale(below, -(MARKER_RADIUS + 0.45))), toEye, up);
        marker.material.emissiveColor = active ? ACTIVE : IDLE;
        marker.material.alpha = active ? 0.9 : 0.55;
        marker.disc.scaling.setAll(active ? 1.3 : 1);
      }
      while (lasers.length < rays.length) {
        const laser = place(CreateCylinder(`headset-laser-${lasers.length}`, { height: 1, diameter: LASER_DIAMETER, tessellation: 8 }, scene));
        laser.material = laserMaterial;
        lasers.push(laser);
      }
      lasers.forEach((laser, index) => {
        const ray = rays[index];
        laser.setEnabled(ray !== undefined);
        if (!ray) return;
        const direction = normalize(ray.direction);
        const middle = add(ray.origin, scale(direction, LASER_LENGTH / 2));
        laser.position.set(middle[0], middle[1], middle[2]);
        laser.scaling.set(1, LASER_LENGTH, 1);
        // A cylinder's axis is its y.
        Quaternion.FromUnitVectorsToRef(Vector3.Up(), new Vector3(direction[0], direction[1], direction[2]), laser.rotationQuaternion!);
      });
    },
    select(ray) {
      if (disposed) return;
      const eye = ray.origin;
      const hovered = hoveredLink && markers.has(hoveredLink) ? hoveredLink : hoveredFor(eye, [ray]).link;
      if (hovered) { options.follow(hovered); return; }
      if (markers.size) return;
      const image = options.pickImages(ray)[0];
      if (image) options.enter(image);
    },
    back() { if (!disposed) options.back(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (hoveredImage) options.hoverImage(null);
      for (const marker of markers.values()) disposeMarker(marker);
      markers.clear();
      for (const laser of lasers.splice(0)) laser.dispose();
      laserMaterial.dispose();
    },
  };
}

/** A unit vector, or the zero vector unchanged. */
const normalize = (a: Vec3): Vec3 => { const size = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / size, a[1] / size, a[2] / size]; };
