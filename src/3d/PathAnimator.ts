import {
  AdditiveBlending,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  type Camera,
  type Object3D,
} from "three";
import type { CharacterType, PathDef } from "../types";

const CHAR_RADIUS = 0.16;
const TRAIL_COUNT = 12;
const TRAIL_INTERVAL = 0.05;

interface PlayState {
  curve: CatmullRomCurve3;
  duration: number;
  loops: number;
  t: number;
  resolve: () => void;
  root: Group;
}

interface CharacterBundle {
  root: Group;
  inner: Group;
  color: Color;
}

/** 스플라인 이동 캐릭터 + 잔상 트레일. 재생 중 카메라는 건드리지 않는다. */
export class PathAnimator {
  private characters = new Map<CharacterType, CharacterBundle>();
  private trailGroup = new Group();
  private trailMeshes: Mesh[] = [];
  private trailMaterials: MeshBasicMaterial[] = [];
  private trailHistory: Vector3[] = [];
  private trailClock = 0;
  private active: PlayState | null = null;
  private glowTexture: CanvasTexture;
  private sphereGeo: SphereGeometry;
  private disposables: { dispose(): void }[] = [];

  constructor(private parent: Object3D, private camera: Camera) {
    parent.add(this.trailGroup);
    const geo = new SphereGeometry(1, 8, 6);
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const mat = new MeshBasicMaterial({
        transparent: true,
        opacity: 0.3 * (1 - i / TRAIL_COUNT),
        depthWrite: false,
      });
      const m = new Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 7;
      this.trailMeshes.push(m);
      this.trailMaterials.push(mat);
      this.trailGroup.add(m);
      this.disposables.push(mat);
    }
    this.disposables.push(geo);
    this.sphereGeo = geo;
    for (let i = 0; i < TRAIL_COUNT; i++) this.trailHistory.push(new Vector3());

    this.glowTexture = makeGlowTexture();
    this.disposables.push(this.glowTexture);
  }

  playPath(def: PathDef, character: CharacterType, opts: { durationSec: number; loops: number }): Promise<void> {
    this.stopPath();
    if (def.points.length < 2) return Promise.resolve();

    const points = def.points.map((p) => new Vector3(p.x, p.y, p.z));
    const curve = new CatmullRomCurve3(points, def.closed === true, "centripetal");
    const bundle = this.getCharacter(character);
    bundle.root.visible = true;
    for (const mat of this.trailMaterials) mat.color.copy(bundle.color);
    this.trailHistory[0]?.copy(bundle.root.position);

    return new Promise<void>((resolve) => {
      this.active = {
        curve,
        duration: Math.max(0.1, opts.durationSec),
        loops: Math.max(1, opts.loops),
        t: 0,
        resolve,
        root: bundle.root,
      };
    });
  }

  stopPath(): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    a.root.visible = false;
    for (const m of this.trailMeshes) m.visible = false;
    a.resolve();
  }

  update(dt: number): void {
    const a = this.active;
    if (!a) return;
    a.t += dt;
    const total = a.duration * a.loops;
    const k = Math.min(a.t / total, 1);
    const progress = a.t / a.duration;
    const u = a.curve.closed ? progress % 1 : Math.min(progress, 1);

    const pos = a.curve.getPointAt(Math.min(Math.max(u, 0), 1));
    a.root.position.copy(pos);
    a.root.quaternion.copy(this.camera.quaternion); // 항상 카메라 향함
    const inner = a.root.children[0];
    if (inner) inner.position.y = Math.sin(a.t * 5) * 0.035; // 살짝 출렁임

    this.updateTrail(pos, dt);

    if (k >= 1) this.stopPath();
  }

  private updateTrail(pos: Vector3, dt: number): void {
    this.trailClock += dt;
    if (this.trailClock >= TRAIL_INTERVAL) {
      this.trailClock = 0;
      for (let i = TRAIL_COUNT - 1; i > 0; i--) {
        this.trailHistory[i]?.copy(this.trailHistory[i - 1] ?? pos);
      }
      this.trailHistory[0]?.copy(pos);
    }
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const m = this.trailMeshes[i];
      const h = this.trailHistory[i];
      if (!m || !h) continue;
      m.position.copy(h);
      m.scale.setScalar(0.07 * (1 - i / TRAIL_COUNT));
      m.visible = true;
    }
  }

  dispose(): void {
    this.stopPath();
    this.parent.remove(this.trailGroup);
    for (const bundle of this.characters.values()) this.parent.remove(bundle.root);
    this.characters.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  // ------------------------------------------------------------- characters

  private getCharacter(type: CharacterType): CharacterBundle {
    const existing = this.characters.get(type);
    if (existing) return existing;
    const bundle = this.buildCharacter(type);
    this.characters.set(type, bundle);
    this.parent.add(bundle.root);
    return bundle;
  }

  private buildCharacter(type: CharacterType): CharacterBundle {
    const root = new Group();
    root.name = `char-${type}`;
    root.visible = false;
    const inner = new Group();
    root.add(inner);

    const bundle: CharacterBundle = { root, inner, color: new Color(0xffffff) };

    const solid = (color: number, roughness = 0.4): MeshStandardMaterial => {
      const mat = new MeshStandardMaterial({ color, roughness, metalness: 0 });
      this.disposables.push(mat);
      return mat;
    };

    switch (type) {
      case "glucose": {
        bundle.color.set(0xf6c445);
        inner.add(this.ball(solid(0xf6c445), CHAR_RADIUS, { x: 1, y: 1, z: 1 }));
        const eyeMat = solid(0x333333, 0.5);
        inner.add(this.ball(eyeMat, 0.022, undefined, -0.055, 0.045, 0.145));
        inner.add(this.ball(eyeMat, 0.022, undefined, 0.055, 0.045, 0.145));
        const smile = new Mesh(new TorusGeometry(0.06, 0.012, 6, 14, Math.PI), eyeMat);
        smile.position.set(0, -0.01, 0.148);
        smile.rotation.z = Math.PI;
        inner.add(smile);
        this.disposables.push(smile.geometry);
        break;
      }
      case "oxygen": {
        bundle.color.set(0x4dabf7);
        inner.add(this.ball(solid(0x4dabf7), CHAR_RADIUS));
        const white = solid(0xffffff, 0.3);
        const pupil = solid(0x333333, 0.5);
        for (const side of [-1, 1]) {
          inner.add(this.ball(white, 0.036, undefined, side * 0.06, 0.04, 0.138));
          inner.add(this.ball(pupil, 0.016, undefined, side * 0.06, 0.04, 0.166));
        }
        break;
      }
      case "co2": {
        bundle.color.set(0x9aa3ad);
        inner.add(this.ball(solid(0x9aa3ad), CHAR_RADIUS * 0.95));
        const eyeMat = solid(0x4a4f55, 0.5);
        inner.add(this.ball(eyeMat, 0.02, undefined, -0.055, 0.04, 0.138));
        inner.add(this.ball(eyeMat, 0.02, undefined, 0.055, 0.04, 0.138));
        break;
      }
      case "water": {
        bundle.color.set(0x74c0fc);
        inner.add(this.ball(solid(0x74c0fc), 0.14, { x: 1, y: 1.1, z: 1 }));
        const drop = new Mesh(new SphereGeometry(0.07, 12, 10), solid(0x74c0fc));
        drop.position.y = 0.19;
        drop.scale.set(0.7, 1.4, 0.7);
        inner.add(drop);
        this.disposables.push(drop.geometry);
        break;
      }
      case "starch": {
        bundle.color.set(0xa9744f);
        const mat = solid(0xa9744f, 0.7);
        const offs: [number, number, number, number][] = [
          [0, 0, 0, 0.09],
          [0.08, 0.05, 0.02, 0.075],
          [-0.07, 0.06, -0.02, 0.07],
          [0.04, -0.07, 0.04, 0.08],
          [-0.05, -0.05, 0.05, 0.065],
        ];
        for (const [x, y, z, r] of offs) {
          inner.add(this.ball(mat, r, undefined, x, y, z));
        }
        break;
      }
      case "nutrient":
      default: {
        bundle.color.set(0xe8923c);
        inner.add(this.ball(solid(0xe8923c, 0.6), 0.13, { x: 0.9, y: 1.15, z: 0.9 }));
        break;
      }
    }

    // 글로우 스프라이트 — 반투명 몸체 안에서도 잘 보이게
    const glowMat = new SpriteMaterial({
      map: this.glowTexture,
      color: bundle.color,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const glow = new Sprite(glowMat);
    glow.scale.setScalar(0.85);
    glow.renderOrder = 8;
    inner.add(glow);
    this.disposables.push(glowMat);

    return bundle;
  }

  private ball(
    mat: MeshStandardMaterial,
    r: number,
    scale?: { x: number; y: number; z: number },
    x = 0,
    y = 0,
    z = 0,
  ): Mesh {
    const m = new Mesh(this.sphereGeo, mat);
    m.position.set(x, y, z);
    if (scale) m.scale.set(scale.x * r, scale.y * r, scale.z * r);
    else m.scale.setScalar(r);
    m.renderOrder = 6;
    return m;
  }
}

function makeGlowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.4, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
