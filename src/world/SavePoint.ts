import { BoxGeometry, CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type Scene } from "three/webgpu";
import { RoadCourse } from "./RoadCourse";
import { saveGame } from "../save";
import { Palette, toCss } from "../palette";
import { swapInRealModelWhenReady } from "../assets/AssetLoader";

/**
 * Generic 24h kiosk, not a real chain's branding (brief section 2 legal
 * constraint: "Żabka"/"Paczkomat" names/logos are trademarked, a generic
 * green-lit kiosk with a code-generated neon sign is not). The sign text
 * is drawn on a canvas, not downloaded, per the brief's own instruction for
 * this exact element.
 */
function buildNeonSignTexture(): CanvasTexture {
  const w = 256, h = 96;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(10, 20, 14, 0.9)";
  ctx.fillRect(0, 0, w, h);
  ctx.font = "bold 40px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = toCss(Palette.neonToxic);
  ctx.shadowBlur = 18;
  ctx.fillStyle = toCss(Palette.neonToxic);
  ctx.fillText("24h", w / 2, h / 2 - 14);
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("OTWARTE", w / 2, h / 2 + 22);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function buildKioskBuildingPlaceholder(): Group {
  const group = new Group();
  const building = new Mesh(
    new BoxGeometry(6, 3.2, 5),
    new MeshStandardMaterial({ color: Palette.buildingLit, emissive: Palette.neonToxic, emissiveIntensity: 0.12 }),
  );
  building.position.y = 1.6;
  group.add(building);
  return group;
}

export class SavePoint {
  private object: Group;
  private radius = 5;
  private z: number;
  private x: number;
  private saved = false;
  private course: RoadCourse;

  constructor(scene: Scene, course: RoadCourse) {
    this.course = course;
    this.z = 6; // just past the "finish" (z=0) so the car naturally rolls up to it
    this.x = course.centerXAt(this.z);
    this.object = new Group();
    this.object.position.set(this.x, 0, this.z);

    const building = buildKioskBuildingPlaceholder();
    this.object.add(building);
    // The uploaded kit's own bounding box is ~55m x 12.75m x 30m (a whole
    // modular street-building set, not one small kiosk) centred at
    // roughly (0.5, -0.15, -3.56) in its own local space - scaled down to
    // a roadside-building-sized footprint and recentred so it sits under
    // the neon sign instead of off to one side.
    swapInRealModelWhenReady(building, "assets/models/kiosk.glb", 0.2, { x: -0.5, y: 0.15, z: 3.56 });

    // The neon sign is code-generated (brief section 3.4) and stays even
    // once a real kiosk model swaps in - it's not part of the swappable
    // `building` container.
    const sign = new Mesh(new PlaneGeometry(3, 1.1), new MeshBasicMaterial({ map: buildNeonSignTexture() }));
    sign.position.set(0, 3.4, 2.52);
    this.object.add(sign);

    scene.add(this.object);
  }

  /** Returns true the frame a checkpoint save actually happens (for the focus-mode FX pulse). */
  /** Position, for the minimap. */
  get position(): { x: number; z: number } {
    return { x: this.x, z: this.z };
  }

  update(carX: number, carZ: number): boolean {
    if (this.saved) return false;
    const dx = carX - this.x;
    const dz = carZ - this.z;
    if (dx * dx + dz * dz > this.radius * this.radius) return false;

    this.saved = true;
    saveGame({
      progress: this.course.progressAt(carZ),
      savedAtStation: "kiosk-1",
      timestamp: Date.now(),
    });
    return true;
  }
}
