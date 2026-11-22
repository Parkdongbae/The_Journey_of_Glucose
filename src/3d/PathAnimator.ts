import {
  AdditiveBlending,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Camera,
  type Object3D,
} from "three";
import type { CharacterType, PathDef } from "../types";

const CHAR_RADIUS = 0.16;
/** 멀리서 볼 때도 캐릭터가 점처럼 작아지지 않도록 하는 화면 기준 최소 크기 */
const MIN_SCREEN_SCALE = 0.02;

interface PlayState {
  curve: CatmullRomCurve3;
  duration: number;
  loops: number;
  t: number;
  done: boolean;
  resolve: () => void;
  root: Group;
}

interface CharacterBundle {
  root: Group;
  inner: Group;
  color: Color;
}

/**
 * 스플라인을 따라 움직이는 캐릭터 + 지나갈 길 전체를 보여 주는 흐름선.
 * 경로가 기관 속을 지나므로 모두 깊이 검사를 끄고 기관 위에 그린다.
 * 재생이 끝나도 stopPath()가 불릴 때까지 길과 캐릭터는 도착점에 남는다.
 */
export class PathAnimator {
  private characters = new Map<CharacterType, CharacterBundle>();
  private active: PlayState | null = null;
  private glowTexture: CanvasTexture;
  private flowTexture: CanvasTexture;
  private sphereGeo = new SphereGeometry(1, 20, 14);
  private route: Mesh | null = null;
  private routeGlow: Mesh | null = null;
  private routeMat: MeshBasicMaterial;
  private routeGlowMat: MeshBasicMaterial;
  private endDot: Mesh;
  private disposables: { dispose(): void }[] = [];
  private tmp = new Vector3();

  constructor(private parent: Object3D, private camera: Camera) {
    this.glowTexture = makeGlowTexture();
    this.flowTexture = makeFlowTexture();
    this.routeMat = new MeshBasicMaterial({
      map: this.flowTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.routeGlowMat = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.12,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    const dotMat = new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    this.endDot = new Mesh(this.sphereGeo, dotMat);
    this.endDot.renderOrder = 56;
    this.endDot.visible = false;
    parent.add(this.endDot);
    this.disposables.push(this.glowTexture, this.flowTexture, this.routeMat, this.routeGlowMat, dotMat, this.sphereGeo);
  }

  playPath(def: PathDef, character: CharacterType, opts: { durationSec: number; loops: number }): Promise<void> {
    this.stopPath();
    if (def.points.length < 2) return Promise.resolve();

    const points = def.points.map((p) => new Vector3(p.x, p.y, p.z));
    const curve = new CatmullRomCurve3(points, def.closed === true, "centripetal");
    const bundle = this.getCharacter(character);
    bundle.root.visible = true;
    this.buildRoute(curve, bundle.color);

    return new Promise<void>((resolve) => {
      this.active = {
        curve,
        duration: Math.max(0.1, opts.durationSec),
        loops: Math.max(1, opts.loops),
        t: 0,
        done: false,
        resolve,
        root: bundle.root,
      };
    });
  }

  stopPath(): void {
    const a = this.active;
    this.clearRoute();
    if (!a) return;
    this.active = null;
    a.root.visible = false;
    if (!a.done) a.resolve();
  }

  update(dt: number): void {
    this.flowTexture.offset.x -= dt * 0.9;
    const a = this.active;
    if (!a) return;
    if (!a.done) a.t += dt;
    const total = a.duration * a.loops;
    const progress = a.t / a.duration;
    const u = a.curve.closed ? progress % 1 : Math.min(progress, 1);

    const pos = a.curve.getPointAt(Math.min(Math.max(u, 0), 1));
    a.root.position.copy(pos);
    a.root.quaternion.copy(this.camera.quaternion); // 항상 카메라를 향함
    const dist = this.camera.getWorldPosition(this.tmp).distanceTo(pos);
    a.root.scale.setScalar(Math.max(1, (dist * MIN_SCREEN_SCALE) / CHAR_RADIUS));
    const inner = a.root.children[0];
    if (inner) inner.position.y = Math.sin(performance.now() / 200) * 0.03; // 살짝 출렁임

    if (!a.done && a.t >= total) {
      a.done = true; // 도착점에 머문다 — 정리는 stopPath
      a.resolve();
    }
  }

  dispose(): void {
    this.stopPath();
    this.parent.remove(this.endDot);
    for (const bundle of this.characters.values()) this.parent.remove(bundle.root);
    this.characters.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  // ------------------------------------------------------------------ route

  private buildRoute(curve: CatmullRomCurve3, color: Color): void {
    const length = curve.getLength();
    const segments = Math.max(48, Math.round(length * 26));
    const geo = new TubeGeometry(curve, segments, 0.034, 8, curve.closed);
    const glowGeo = new TubeGeometry(curve, segments, 0.075, 8, curve.closed);
    this.flowTexture.repeat.set(Math.max(2, Math.round(length * 2.6)), 1);
    this.routeMat.color.copy(color).lerp(WHITE, 0.25);
    this.routeGlowMat.color.copy(color);
    this.route = new Mesh(geo, this.routeMat);
    this.route.renderOrder = 55;
    this.routeGlow = new Mesh(glowGeo, this.routeGlowMat);
    this.routeGlow.renderOrder = 54;
    this.parent.add(this.routeGlow, this.route);

    // 도착점 표시
    const end = curve.getPointAt(1);
    this.endDot.position.copy(end);
    this.endDot.scale.setScalar(0.075);
    (this.endDot.material as MeshBasicMaterial).color.copy(color).lerp(WHITE, 0.5);
    this.endDot.visible = !curve.closed;
  }

  private clearRoute(): void {
    for (const m of [this.route, this.routeGlow]) {
      if (!m) continue;
      this.parent.remove(m);
      m.geometry.dispose();
    }
    this.route = null;
    this.routeGlow = null;
    this.endDot.visible = false;
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

    // 기관 속에서도 보이도록 깊이 검사를 끄고, 그리는 순서(renderOrder)로 앞뒤를 정한다
    const solid = (color: number, roughness = 0.4): MeshStandardMaterial => {
      const mat = new MeshStandardMaterial({
        color,
        roughness,
        metalness: 0,
        emissive: color,
        emissiveIntensity: 0.28,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      this.disposables.push(mat);
      return mat;
    };

    switch (type) {
      case "glucose": {
        bundle.color.set(0xffc93c);
        inner.add(this.ball(solid(0xffc93c), CHAR_RADIUS));
        const eyeMat = solid(0x2b2b2b, 0.5);
        inner.add(this.ball(eyeMat, 0.024, undefined, -0.055, 0.045, 0.145, 61));
        inner.add(this.ball(eyeMat, 0.024, undefined, 0.055, 0.045, 0.145, 61));
        const smile = new Mesh(new TorusGeometry(0.06, 0.013, 6, 14, Math.PI), eyeMat);
        smile.position.set(0, -0.01, 0.148);
        smile.rotation.z = Math.PI;
        smile.renderOrder = 61;
        inner.add(smile);
        this.disposables.push(smile.geometry);
        break;
      }
      case "oxygen": {
        bundle.color.set(0x4dabf7);
        inner.add(this.ball(solid(0x4dabf7), CHAR_RADIUS));
        const white = solid(0xffffff, 0.3);
        const pupil = solid(0x22303f, 0.5);
        for (const side of [-1, 1]) {
          inner.add(this.ball(white, 0.038, undefined, side * 0.06, 0.04, 0.138, 61));
          inner.add(this.ball(pupil, 0.018, undefined, side * 0.06, 0.04, 0.166, 62));
        }
        break;
      }
      case "co2": {
        bundle.color.set(0xa8b3c2);
        inner.add(this.ball(solid(0x8e99a8), CHAR_RADIUS * 0.95));
        const eyeMat = solid(0x30353c, 0.5);
        inner.add(this.ball(eyeMat, 0.022, undefined, -0.055, 0.04, 0.138, 61));
        inner.add(this.ball(eyeMat, 0.022, undefined, 0.055, 0.04, 0.138, 61));
        break;
      }
      case "water": {
        bundle.color.set(0x74c0fc);
        inner.add(this.ball(solid(0x74c0fc), 0.14, { x: 1, y: 1.1, z: 1 }));
        inner.add(this.ball(solid(0x74c0fc), 0.07, { x: 0.7, y: 1.4, z: 0.7 }, 0, 0.19, 0));
        break;
      }
      case "starch": {
        bundle.color.set(0xf1d9b0);
        const mat = solid(0xf1e3c8, 0.7);
        const offs: [number, number, number, number][] = [
          [0, 0, 0, 0.09],
          [0.09, 0.05, 0.02, 0.075],
          [-0.08, 0.06, -0.02, 0.07],
          [0.04, -0.08, 0.04, 0.08],
          [-0.06, -0.06, 0.05, 0.065],
        ];
        for (const [x, y, z, r] of offs) inner.add(this.ball(mat, r, undefined, x, y, z));
        break;
      }
      case "nutrient":
      default: {
        bundle.color.set(0xe8923c);
        inner.add(this.ball(solid(0xe8923c, 0.6), 0.13, { x: 0.9, y: 1.15, z: 0.9 }));
        break;
      }
    }

    const glowMat = new SpriteMaterial({
      map: this.glowTexture,
      color: bundle.color,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const glow = new Sprite(glowMat);
    glow.scale.setScalar(1.0);
    glow.renderOrder = 58;
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
    order = 60,
  ): Mesh {
    const m = new Mesh(this.sphereGeo, mat);
    m.position.set(x, y, z);
    if (scale) m.scale.set(scale.x * r, scale.y * r, scale.z * r);
    else m.scale.setScalar(r);
    m.renderOrder = order;
    return m;
  }
}

const WHITE = new Color(0xffffff);

function makeGlowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,0.85)");
    g.addColorStop(0.4, "rgba(255,255,255,0.3)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** 흐르는 점선 텍스처 — offset을 움직여 진행 방향을 보여 준다 */
function makeFlowTexture(): CanvasTexture {
  const w = 64;
  const h = 8;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "rgba(255,255,255,0.12)");
    g.addColorStop(0.55, "rgba(255,255,255,0.35)");
    g.addColorStop(0.8, "rgba(255,255,255,1)");
    g.addColorStop(0.9, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0.12)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  return tex;
}
