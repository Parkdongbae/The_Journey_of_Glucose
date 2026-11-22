import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Clock,
  DirectionalLight,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RingGeometry,
  Scene,
  Sprite,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { CameraView, ThemeName, ViewInsets } from "../types";

export type Updater = (dt: number) => void;

const INITIAL_VIEW: CameraView = { position: { x: 0, y: 8.6, z: 21 }, target: { x: 0, y: 7.9, z: 0 } };
const FLY_DEFAULT_SEC = 1.3;
const BASE_FOV = 40;

/** 테마별 조명 세트 — 배경은 CSS가 담당하고, 여기서는 노출·조명 세기만 바꾼다 */
const THEME_LIGHT: Record<ThemeName, { exposure: number; env: number; key: number; fill: number; rim: number; hemi: number; ring: number; shadow: number }> = {
  dark: { exposure: 1.0, env: 0.42, key: 2.3, fill: 0.5, rim: 1.5, hemi: 0.3, ring: 0x6fb7ff, shadow: 0.0 },
  light: { exposure: 1.0, env: 0.6, key: 2.0, fill: 0.45, rim: 0.7, hemi: 0.35, ring: 0x7b8aa5, shadow: 0.55 },
};

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
  private insets: ViewInsets = { left: 0, top: 0, right: 0, bottom: 0 };
  private insetsShown = { x: 0, y: 0 };
  private key: DirectionalLight;
  private fill: DirectionalLight;
  private rim: DirectionalLight;
  private hemi: HemisphereLight;
  private ring: Mesh;
  private contact: Mesh;
  private quality: "low" | "high" = "high";

  constructor(private container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.domElement = this.renderer.domElement;
    this.domElement.className = "scene-canvas";
    this.domElement.style.display = "block";
    this.domElement.style.touchAction = "none";
    container.appendChild(this.domElement);

    // 배경은 CSS 그라데이션이 비쳐 보이도록 투명
    this.scene.background = null;

    this.camera = new PerspectiveCamera(BASE_FOV, 1, 0.1, 200);
    this.camera.position.set(INITIAL_VIEW.position.x, INITIAL_VIEW.position.y, INITIAL_VIEW.position.z);

    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.target.set(INITIAL_VIEW.target.x, INITIAL_VIEW.target.y, INITIAL_VIEW.target.z);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.4;
    this.controls.maxDistance = 34;
    this.controls.enablePan = true;
    this.controls.maxPolarAngle = Math.PI * 0.92;
    this.controls.autoRotateSpeed = 0.9;
    this.controls.update();

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // 3점 조명: 키(그림자) + 필 + 림. 주변광은 낮게 두어 입체감을 살린다.
    this.key = new DirectionalLight(0xfff1e0, 2.2);
    this.key.position.set(5, 15, 9);
    this.key.target.position.set(0, 8, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const cam = this.key.shadow.camera;
    cam.left = -4.5;
    cam.right = 4.5;
    cam.top = 9;
    cam.bottom = -9;
    cam.near = 1;
    cam.far = 40;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.03;
    this.key.shadow.radius = 5;
    this.fill = new DirectionalLight(0x8fb4ff, 0.5);
    this.fill.position.set(-8, 6, 5);
    this.rim = new DirectionalLight(0x9fd0ff, 1.4);
    this.rim.position.set(-4, 11, -10);
    this.hemi = new HemisphereLight(0xcfe2ff, 0x2a2233, 0.3);
    this.scene.add(this.key, this.key.target, this.fill, this.rim, this.hemi);

    this.contact = this.buildContactShadow();
    this.ring = this.buildFloorRing();
    this.scene.add(this.contact, this.ring);
    this.setTheme("dark");

    // 사용자가 직접 조작을 시작하면 자동 카메라 이동을 즉시 멈춘다
    const interrupt = (): void => this.cancelTween();
    this.domElement.addEventListener("pointerdown", interrupt);
    this.domElement.addEventListener("wheel", interrupt, { passive: true });

    this.observer = new ResizeObserver(() => this.doResize());
    this.observer.observe(container);
    this.doResize();

    this.clock.start();
    this.loop();
  }

  /** 발밑 접촉 그림자 — 캔버스로 만든 방사 그라데이션 (밝은 테마용) */
  private buildContactShadow(): Mesh {
    const size = 256;
    const cv = document.createElement("canvas");
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext("2d");
    if (ctx) {
      const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size * 0.5);
      grad.addColorStop(0, "rgba(20, 30, 50, 0.9)");
      grad.addColorStop(0.5, "rgba(20, 30, 50, 0.35)");
      grad.addColorStop(1, "rgba(20, 30, 50, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }
    const mesh = new Mesh(
      new PlaneGeometry(7, 3.6),
      new MeshBasicMaterial({ map: new CanvasTexture(cv), transparent: true, depthWrite: false, toneMapped: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.02;
    return mesh;
  }

  /** 발밑 받침 링 — 몸이 허공에 떠 보이지 않게 하는 스테이지 표시 */
  private buildFloorRing(): Mesh {
    const mesh = new Mesh(
      new RingGeometry(3.3, 3.42, 96),
      new MeshBasicMaterial({ color: 0x6fb7ff, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.01;
    return mesh;
  }

  registerUpdater(u: Updater): void {
    this.updaters.push(u);
  }

  setTheme(theme: ThemeName): void {
    const t = THEME_LIGHT[theme];
    this.renderer.toneMappingExposure = t.exposure;
    this.scene.environmentIntensity = t.env;
    this.key.intensity = t.key;
    this.fill.intensity = t.fill;
    this.rim.intensity = t.rim;
    this.hemi.intensity = t.hemi;
    (this.ring.material as MeshBasicMaterial).color.setHex(t.ring);
    (this.contact.material as MeshBasicMaterial).opacity = t.shadow;
    this.contact.visible = t.shadow > 0;
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on;
  }

  /** UI 패널이 가리는 영역(px). 3D의 중심을 남은 빈 영역의 중앙으로 옮긴다. */
  setViewInsets(insets: ViewInsets): void {
    this.insets = { ...insets };
  }

  // ------------------------------------------------------------------ camera

  flyTo(view: CameraView, durationSec = FLY_DEFAULT_SEC): Promise<void> {
    this.generation++;
    return this.rawFlyTo(
      new Vector3(view.position.x, view.position.y, view.position.z),
      new Vector3(view.target.x, view.target.y, view.target.z),
      Math.max(0.05, durationSec),
    );
  }

  resetView(durationSec = FLY_DEFAULT_SEC): Promise<void> {
    return this.flyTo(INITIAL_VIEW, durationSec);
  }

  /** 기관 하나를 화면 가운데에 잡는 근접 뷰 (자유 탐색 목록·경로 순회용) */
  focusPoint(pos: Vector3, distance: number, durationSec = 1.1): Promise<void> {
    this.generation++;
    return this.rawFlyTo(this.viewPointFor(pos, distance), pos.clone(), durationSec);
  }

  private viewPointFor(pos: Vector3, distance: number): Vector3 {
    // 몸 뒤쪽 기관(콩팥 등)은 뒤에서, 나머지는 약간 비스듬한 앞에서 본다
    const back = pos.z < -0.35;
    const side = MathUtils.clamp(pos.x * 0.5, -0.9, 0.9) + (Math.abs(pos.x) < 0.2 ? 0.45 : 0);
    const dir = new Vector3(side, 0.22, back ? -1 : 1).normalize();
    return pos.clone().addScaledVector(dir, distance);
  }

  /** 기관 근접 뷰 순회. 새 flyTo/flyThrough가 들어오면 취소되고 조기 resolve된다. */
  async flyThroughOrganIds(
    getOrganPosition: (id: string) => Vector3 | undefined,
    organIds: string[],
    perStopSec: number,
    onStop?: (id: string) => void,
  ): Promise<void> {
    const gen = ++this.generation;
    const dwell = Math.max(0.2, perStopSec);
    for (const id of organIds) {
      const pos = getOrganPosition(id);
      if (!pos) continue;
      onStop?.(id);
      await this.rawFlyTo(this.viewPointFor(pos, 4.2), pos.clone(), MathUtils.clamp(dwell * 0.6, 0.6, 1.4));
      if (this.disposed || gen !== this.generation) return;
      await this.delay(dwell * 1000);
      if (this.disposed || gen !== this.generation) return;
    }
  }

  private rawFlyTo(toPos: Vector3, toTarget: Vector3, dur: number): Promise<void> {
    const prev = this.tween;
    if (prev) prev.resolve();
    return new Promise<void>((resolve) => {
      this.tween = {
        fromPos: this.camera.position.clone(),
        toPos,
        fromTarget: this.controls.target.clone(),
        toTarget,
        t: 0,
        dur,
        resolve,
      };
    });
  }

  private cancelTween(): void {
    const t = this.tween;
    if (!t) return;
    this.tween = null;
    this.controls.update();
    t.resolve();
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
        this.controls.update();
        tween.resolve();
      }
    } else {
      this.controls.update();
      this.clampTarget();
    }

    this.updateViewOffset(dt);
    for (const u of this.updaters) u(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private clampTarget(): void {
    const t = this.controls.target;
    t.x = MathUtils.clamp(t.x, -3.5, 3.5);
    t.y = MathUtils.clamp(t.y, 0.2, 15.2);
    t.z = MathUtils.clamp(t.z, -3.5, 3.5);
  }

  /** 패널 여백에 맞춰 투영 중심을 부드럽게 옮긴다 (패널이 열리고 닫힐 때 3D가 튀지 않게) */
  private updateViewOffset(dt: number): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const tx = (this.insets.right - this.insets.left) / 2;
    const ty = (this.insets.bottom - this.insets.top) / 2;
    const k = 1 - Math.exp(-dt * 9);
    const nx = Math.abs(tx - this.insetsShown.x) < 0.5 ? tx : MathUtils.lerp(this.insetsShown.x, tx, k);
    const ny = Math.abs(ty - this.insetsShown.y) < 0.5 ? ty : MathUtils.lerp(this.insetsShown.y, ty, k);
    if (nx === this.insetsShown.x && ny === this.insetsShown.y && this.viewSize.w === w && this.viewSize.h === h) return;
    this.insetsShown.x = nx;
    this.insetsShown.y = ny;
    this.viewSize = { w, h };
    if (nx === 0 && ny === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, nx, ny, w, h);
  }

  private viewSize = { w: 0, h: 0 };

  // ------------------------------------------------------------------- misc

  setQuality(level: "low" | "high"): void {
    this.quality = level;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(level === "low" ? Math.min(dpr, 1) : Math.min(dpr, 2));
    this.renderer.shadowMap.enabled = level === "high";
    this.key.castShadow = level === "high";
    this.scene.traverse((obj) => {
      if (obj instanceof Mesh) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) (m as Material).needsUpdate = true;
      }
    });
    this.doResize();
  }

  /** QA용: 프레임 n장을 동기 렌더링해 평균 ms를 잰다 (창이 가려져 rAF가 느려진 환경에서도 측정 가능) */
  debugFrameMs(frames = 20): number {
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      this.renderer.render(this.scene, this.camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    return (performance.now() - t0) / frames;
  }

  getQuality(): "low" | "high" {
    return this.quality;
  }

  resize(): void {
    this.doResize();
  }

  private doResize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    // 세로 화면에서는 수직 화각을 넓혀 몸이 잘리지 않게 한다
    this.camera.fov = w / h < 0.9 ? MathUtils.clamp(BASE_FOV * (0.9 / (w / h)) * 0.82, BASE_FOV, 62) : BASE_FOV;
    this.viewSize = { w: 0, h: 0 }; // 다음 프레임에 뷰 오프셋 재계산
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
