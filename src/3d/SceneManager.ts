import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Clock,
  DirectionalLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Sprite,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { CameraView } from "../types";

export type Updater = (dt: number) => void;

const INITIAL_VIEW: CameraView = { position: { x: 0, y: 9, z: 19 }, target: { x: 0, y: 8, z: 0 } };
const FLY_DEFAULT_SEC = 1.4;
const FLY_THROUGH_DIST = 1.9;
const FLY_THROUGH_LIFT = 0.4;

interface Tween {
  fromPos: Vector3;
  toPos: Vector3;
  fromTarget: Vector3;
  toTarget: Vector3;
  t: number;
  dur: number;
  resolve: () => void;
}

/** 렌더러/카메라/조명/컨트롤/트윈/중앙 업데이트 루프. 모든 프레임 갱신은 update(dt)로 모인다. */
export class SceneManager {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly domElement: HTMLCanvasElement;

  private renderer: WebGLRenderer;
  private controls: OrbitControls;
  private observer: ResizeObserver;
  private clock = new Clock();
  private updaters: Updater[] = [];
  private raf = 0;
  private disposed = false;
  private tween: Tween | null = null;
  private generation = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.domElement = this.renderer.domElement;
    this.domElement.style.display = "block";
    this.domElement.style.touchAction = "none";
    container.appendChild(this.domElement);

    // CSS 그라데이션 배경을 비추므로 씬 배경/안개는 투명
    this.scene.background = null;

    this.camera = new PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(INITIAL_VIEW.position.x, INITIAL_VIEW.position.y, INITIAL_VIEW.position.z);

    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.target.set(INITIAL_VIEW.target.x, INITIAL_VIEW.target.y, INITIAL_VIEW.target.z);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 40;
    this.controls.enablePan = true;
    this.controls.maxPolarAngle = Math.PI * 0.95;
    this.controls.update();

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.85;
    pmrem.dispose();

    const sun = new DirectionalLight(0xfff4e6, 1.5);
    sun.position.set(6, 14, 8);
    const fill = new DirectionalLight(0x9db8e8, 0.55);
    fill.position.set(-8, 6, -6);
    const rim = new DirectionalLight(0xbcd8ff, 0.85); // 뒤에서 실루엣 분리
    rim.position.set(-4, 10, -9);
    this.scene.add(sun, fill, rim);
    this.scene.add(this.buildContactShadow());

    this.observer = new ResizeObserver(() => this.doResize());
    this.observer.observe(container);
    this.doResize();

    this.clock.start();
    this.loop();
  }

  /** 발밑 접촉 그림자 — 캔버스로 만든 방사 그라데이션 (에셋 없음) */
  private buildContactShadow(): Mesh {
    const size = 256;
    const cv = document.createElement("canvas");
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext("2d");
    if (ctx) {
      const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.5);
      grad.addColorStop(0, "rgba(30, 42, 60, 0.7)");
      grad.addColorStop(0.55, "rgba(30, 42, 60, 0.3)");
      grad.addColorStop(1, "rgba(30, 42, 60, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }
    const tex = new CanvasTexture(cv);
    const mesh = new Mesh(
      new PlaneGeometry(6.4, 3.2),
      new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.02;
    return mesh;
  }

  registerUpdater(u: Updater): void {
    this.updaters.push(u);
  }

  // ------------------------------------------------------------------ camera

  flyTo(view: CameraView, durationSec = FLY_DEFAULT_SEC): Promise<void> {
    this.generation++;
    const prev = this.tween;
    if (prev) prev.resolve(); // 이전 트윈/순회 취소
    const dur = Math.max(0.05, durationSec);
    this.tween = {
      fromPos: this.camera.position.clone(),
      toPos: new Vector3(view.position.x, view.position.y, view.position.z),
      fromTarget: this.controls.target.clone(),
      toTarget: new Vector3(view.target.x, view.target.y, view.target.z),
      t: 0,
      dur,
      resolve: () => {},
    };
    this.controls.enabled = false;
    return new Promise<void>((resolve) => {
      const t = this.tween;
      if (t) t.resolve = resolve;
      else resolve();
    });
  }

  resetView(durationSec = FLY_DEFAULT_SEC): Promise<void> {
    return this.flyTo(INITIAL_VIEW, durationSec);
  }

  /** 기관 근접 뷰 순회. 새 flyTo/flyThrough가 들어오면 취소되고 조기 resolve된다. */
  async flyThroughOrganIds(
    getOrganPosition: (id: string) => Vector3 | undefined,
    organIds: string[],
    perStopSec: number,
  ): Promise<void> {
    const gen = ++this.generation;
    const dwell = Math.max(0.2, perStopSec);
    for (const id of organIds) {
      const pos = getOrganPosition(id);
      if (!pos) continue;
      const dir = pos.clone().sub(new Vector3(0, pos.y, 0)); // 척추축에서의 수평 방향
      if (dir.lengthSq() < 1e-6) dir.set(0.35, 0, 1);
      dir.normalize();
      const camPos = pos
        .clone()
        .addScaledVector(dir, FLY_THROUGH_DIST)
        .add(new Vector3(0, FLY_THROUGH_LIFT, 0));
      const flyDur = MathUtils.clamp(dwell * 0.55, 0.6, 1.4);
      await this.rawFlyTo(camPos, pos, flyDur);
      if (this.disposed || gen !== this.generation) return;
      await this.delay(dwell * 1000);
      if (this.disposed || gen !== this.generation) return;
    }
  }

  private rawFlyTo(toPos: Vector3, toTarget: Vector3, dur: number): Promise<void> {
    const prev = this.tween;
    if (prev) prev.resolve();
    this.tween = {
      fromPos: this.camera.position.clone(),
      toPos,
      fromTarget: this.controls.target.clone(),
      toTarget: toTarget.clone(),
      t: 0,
      dur,
      resolve: () => {},
    };
    this.controls.enabled = false;
    return new Promise<void>((resolve) => {
      const t = this.tween;
      if (t) t.resolve = resolve;
      else resolve();
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, ms);
      this.timers.add(timer);
    });
  }

  // -------------------------------------------------------------------- loop

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);

    const tween = this.tween;
    if (tween) {
      tween.t += dt;
      const k = Math.min(tween.t / tween.dur, 1);
      const e = cubicInOut(k);
      this.camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
      this.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
      this.camera.lookAt(this.controls.target);
      if (k >= 1) {
        this.tween = null;
        this.controls.enabled = true;
        this.controls.update();
        tween.resolve();
      }
    } else {
      this.controls.update();
      this.clampTarget();
    }

    for (const u of this.updaters) u(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private clampTarget(): void {
    const t = this.controls.target;
    t.x = MathUtils.clamp(t.x, -3.5, 3.5);
    t.y = MathUtils.clamp(t.y, 0.2, 15.2);
    t.z = MathUtils.clamp(t.z, -3.5, 3.5);
  }

  // ------------------------------------------------------------------- misc

  setQuality(level: "low" | "high"): void {
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(level === "low" ? 1 : Math.min(dpr, 2));
    this.doResize();
  }

  resize(): void {
    this.doResize();
  }

  private doResize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (this.tween) {
      this.tween.resolve();
      this.tween = null;
    }
    this.observer.disconnect();
    this.controls.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof Mesh || obj instanceof Sprite) {
        if (obj.geometry) obj.geometry.dispose();
        const mat = obj.material as Material | Material[] | undefined;
        if (Array.isArray(mat)) for (const m of mat) disposeMaterial(m);
        else if (mat) disposeMaterial(mat);
      }
    });
    this.renderer.dispose();
    this.domElement.remove();
  }
}

function disposeMaterial(mat: Material): void {
  const anyMat = mat as Material & { map?: { dispose(): void } | null };
  anyMat.map?.dispose();
  mat.dispose();
}

function cubicInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
