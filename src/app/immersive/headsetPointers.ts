/**
 * The controllers' pointer rays in a headset, and a dot where one ends on a
 * panel: drawn in the headset space, over everything the scene draws.
 */
import { Color3, Constants, CreateCylinder, CreateDisc, Quaternion, StandardMaterial, Vector3, type Mesh, type Scene, type TransformNode } from "@babylonjs/core";
import type { Vec3 } from "@foss-earth/engine";

export interface HeadsetPointer {
  origin: Vec3;
  direction: Vec3;
  /** Where the ray ends on a panel, metres along it; it reaches into the distance without one. */
  length?: number;
}

export interface HeadsetPointers {
  /** The rays this frame, in the headset space. */
  frame(pointers: readonly HeadsetPointer[]): void;
  dispose(): void;
}

const LENGTH = 30;
const DIAMETER = 0.006;
const DOT_DIAMETER = 0.012;
const FORWARD = new Vector3(0, 0, 1);
/** Drawn after the photograph (group 2), with the device-position marker and the headset's markers. */
export const HEADSET_OVERLAY_GROUP = 3;
export const HEADSET_ACTIVE = new Color3(0.35, 0.75, 1);

/** A material drawn over the scene: unlit, both sides, never hidden behind the globe. */
export function overlayMaterial(name: string, scene: Scene): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.depthFunction = Constants.ALWAYS;
  return material;
}

/** A mesh of the headset's overlay: not picked, drawn on `layerMask` in the overlay group, in `space`. */
export function overlayMesh<T extends Mesh>(mesh: T, space: TransformNode, layerMask: number): T {
  mesh.isPickable = false;
  mesh.renderingGroupId = HEADSET_OVERLAY_GROUP;
  mesh.layerMask = layerMask;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.rotationQuaternion = new Quaternion();
  mesh.parent = space;
  return mesh;
}

export function createHeadsetPointers(scene: Scene, space: TransformNode, layerMask: number): HeadsetPointers {
  const material = overlayMaterial("headset-laser", scene);
  material.emissiveColor = HEADSET_ACTIVE;
  material.alpha = 0.7;
  const dotMaterial = overlayMaterial("headset-cursor", scene);
  dotMaterial.emissiveColor = new Color3(1, 1, 1);
  dotMaterial.alpha = 0.95;
  const lasers: { laser: Mesh; dot: Mesh }[] = [];
  const axis = new Vector3();
  return {
    frame(pointers) {
      while (lasers.length < pointers.length) {
        const index = lasers.length;
        const laser = overlayMesh(CreateCylinder(`headset-laser-${index}`, { height: 1, diameter: DIAMETER, tessellation: 8 }, scene), space, layerMask);
        laser.material = material;
        const dot = overlayMesh(CreateDisc(`headset-cursor-${index}`, { radius: DOT_DIAMETER / 2, tessellation: 24 }, scene), space, layerMask);
        dot.material = dotMaterial;
        lasers.push({ laser, dot });
      }
      lasers.forEach(({ laser, dot }, index) => {
        const pointer = pointers[index];
        laser.setEnabled(pointer !== undefined);
        dot.setEnabled(pointer?.length !== undefined);
        if (!pointer) return;
        const size = Math.hypot(...pointer.direction) || 1;
        const direction = axis.set(pointer.direction[0] / size, pointer.direction[1] / size, pointer.direction[2] / size);
        const length = pointer.length ?? LENGTH;
        laser.position.set(pointer.origin[0] + direction.x * length / 2, pointer.origin[1] + direction.y * length / 2, pointer.origin[2] + direction.z * length / 2);
        laser.scaling.set(1, length, 1);
        // A cylinder's axis is its y.
        Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly, direction, laser.rotationQuaternion!);
        if (pointer.length === undefined) return;
        // Just short of the panel, across the ray: a disc lies across its z.
        const end = length - 0.003;
        dot.position.set(pointer.origin[0] + direction.x * end, pointer.origin[1] + direction.y * end, pointer.origin[2] + direction.z * end);
        Quaternion.FromUnitVectorsToRef(FORWARD, direction, dot.rotationQuaternion!);
      });
    },
    dispose() {
      for (const { laser, dot } of lasers.splice(0)) { laser.dispose(); dot.dispose(); }
      material.dispose();
      dotMaterial.dispose();
    },
  };
}
