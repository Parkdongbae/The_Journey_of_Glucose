import {
  Box3,
  type BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  EqualDepth,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  Shape,
  SplineCurve,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { ORGAN_MAP } from "../data/organs";
import type { OrganMeta, OrganShape, OrganSystem, SystemName, ThemeName, Vec3 } from "../types";

function disposeObject(root: Group): void {
  root.traverse((obj) => {
    if (obj instanceof Mesh) {
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m.dispose();
    }
  });
}

const FADE_SEC = 0.4;
const BREATH_PERIOD = 4;
const DIM_FACTOR = 0.2;

/** 하이라이터가 dim 상태를 기록하고, 불투명도는 이 모듈이 단일 작성자로 계산한다. */
export interface OrganRecord {
  id: string;
  system: OrganSystem;
  group: Group;
  meshes: Mesh[];
  materials: MeshStandardMaterial[];
  baseOpacities: number[];
  baseColors: Color[];
  /** 계통 페이드 0..1 (setSystemsVisible 애니메이션) */
  fade: number;
  fadeFrom: number;
  fadeTo: number;
  fadeT: number;
  /** 하이라이트 시 나머지 기관 딤 (OrganHighlighter가 설정) */
  dim: boolean;
}

interface BreathTarget {
  kind: "lungs" | "diaphragm";
  mesh: Mesh;
  baseScale: Vector3;
  basePos: Vector3;
  /** 메시의 실제 중심 — 원점이 발밑에 있는 실제 메시도 제자리에서 부풀도록 이 점을 기준으로 확대한다 */
  center: Vector3;
}

/**
 * 실제 크기로는 보이지 않는 구조를 크게 키워 표시한 확대 모형.
 * 평소에는 몸에 붙은 혹처럼 보여 혼란을 주므로, 그 구조를 다루는 단계에서만 나타난다.
 */
const ON_DEMAND = new Set(["thighCell", "alveoli"]);

const vv = (p: Vec3): Vector3 => new Vector3(p.x, p.y, p.z);

export class BodyBuilder {
  readonly root = new Group();
  readonly records = new Map<string, OrganRecord>();
  readonly systemGroups: Record<SystemName, Group>;
  readonly cellGroup = new Group();
  readonly skinGroup = new Group();

  private breathTargets: BreathTarget[] = [];
  private breathingOn = false;
  private breathAmp = 0;
  private breathPhase = 0;

  constructor() {
    this.root.name = "body";
    this.systemGroups = {
      digestive: new Group(),
      respiratory: new Group(),
      circulatory: new Group(),
      excretory: new Group(),
    };
    this.systemGroups.digestive.name = "digestive";
    this.systemGroups.respiratory.name = "respiratory";
    this.systemGroups.circulatory.name = "circulatory";
    this.systemGroups.excretory.name = "excretory";
    this.cellGroup.name = "cell";
    this.skinGroup.name = "skin";

    this.buildSkin();
    for (const meta of ORGAN_MAP.values()) {
      const rec = this.buildOrgan(meta);
      this.records.set(meta.id, rec);
      if (meta.system === "cell") this.cellGroup.add(rec.group);
      else this.systemGroups[meta.system].add(rec.group);
    }
    this.captureBreathTargets();

    this.root.add(
      this.skinGroup,
      this.systemGroups.digestive,
      this.systemGroups.respiratory,
      this.systemGroups.circulatory,
      this.systemGroups.excretory,
      this.cellGroup,
    );
  }

  // ---------------------------------------------------------------- skin shell

  /**
   * 몸 외형 — 회전체(Lathe) 프로파일로 만든 사람 실루엣.
   * 깊이 선행 패스 + 프레넬 림 셰이더로 "가장 앞 표면 한 겹"만 그려,
   * 캡슐이 겹쳐 보이는 대신 윤곽선이 빛나는 유리 몸처럼 보인다.
   */
  private skinMaterial = new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(0x8fd0ff) },
      uRim: { value: 0.75 },
      uBase: { value: 0.045 },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uRim; uniform float uBase;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
        gl_FragColor = vec4(uColor, uBase + f * uRim);
      }`,
    transparent: true,
    depthWrite: false,
    depthFunc: EqualDepth,
  });

  private buildSkin(): void {
    const prepass = new MeshBasicMaterial({ colorWrite: false, transparent: true });
    const add = (geo: BufferGeometry, x: number, y: number, z: number, rotZ = 0, sx = 1, sz = 1): void => {
      for (const [mat, order] of [
        [prepass, 90],
        [this.skinMaterial, 91],
      ] as const) {
        const m = new Mesh(geo, mat);
        m.position.set(x, y, z);
        m.rotation.z = rotZ;
        m.scale.set(sx, 1, sz);
        m.renderOrder = order; // 기관·경로를 모두 그린 뒤 마지막에 얹는다
        this.skinGroup.add(m);
      }
    };
    /** [반지름, 높이] 점열을 회전시킨 매끈한 회전체 */
    const lathe = (profile: [number, number][]): BufferGeometry => {
      const curve = new SplineCurve(profile.map(([r, y]) => new Vector2(r, y)));
      return new LatheGeometry(curve.getPoints(40), 40);
    };

    // 머리 + 목
    add(new SphereGeometry(1, 40, 28), 0, 14.3, 0.05, 0, 0.84, 0.95);
    this.skinGroup.children.slice(-2).forEach((m) => (m.scale.y = 1.1));
    add(lathe([[0.4, 0], [0.36, 0.35], [0.4, 0.8]]), 0, 12.75, -0.05);
    // 몸통: 어깨 → 허리 → 골반
    add(
      lathe([
        [0.02, 6.55], [0.75, 6.7], [1.36, 7.3], [1.42, 8.0], [1.26, 9.2], [1.2, 10.2],
        [1.36, 11.4], [1.6, 12.3], [1.5, 12.75], [0.9, 13.05], [0.36, 13.2],
      ]),
      0, 0, 0, 0, 1, 0.66,
    );
    // 팔: 어깨에서 손끝까지 가늘어짐
    const arm = lathe([[0.02, 0.05], [0.24, 0.3], [0.2, 0.9], [0.24, 2.1], [0.3, 3.2], [0.34, 4.6], [0.4, 5.5], [0.3, 6.0], [0.02, 6.15]]);
    add(arm, 2.78, 6.25, 0, 0.19);
    add(arm, -2.78, 6.25, 0, -0.19);
    // 다리: 허벅지 → 무릎 → 종아리 → 발목
    const leg = lathe([[0.02, 0.0], [0.3, 0.12], [0.26, 0.9], [0.42, 2.3], [0.38, 3.5], [0.5, 4.6], [0.66, 6.2], [0.62, 7.0], [0.3, 7.5], [0.02, 7.6]]);
    add(leg, 0.72, 0, 0);
    add(leg, -0.72, 0, 0);
    // 발
    const foot = new SphereGeometry(1, 20, 14);
    add(foot, 0.76, 0.2, 0.42, 0, 0.3, 0.72);
    add(foot, -0.76, 0.2, 0.42, 0, 0.3, 0.72);
    this.skinGroup.children.slice(-4).forEach((m) => (m.scale.y = 0.2));
  }

  /** 테마에 맞춰 몸 윤곽 색을 바꾼다 (어두운 배경: 밝은 하늘색 / 밝은 배경: 짙은 청회색) */
  setTheme(theme: ThemeName): void {
    const u = this.skinMaterial.uniforms;
    (u.uColor!.value as Color).setHex(theme === "dark" ? 0x8fd0ff : 0x3b5b86);
    u.uRim!.value = theme === "dark" ? 0.75 : 0.6;
    u.uBase!.value = theme === "dark" ? 0.045 : 0.06;
  }
  // -------------------------------------------------------------- organ build

  private buildOrgan(meta: OrganMeta): OrganRecord {
    const group = new Group();
    group.name = meta.id;
    group.position.copy(vv(meta.position));
    group.userData.organId = meta.id;

    const meshes = this.buildShape(meta);
    const materials: MeshStandardMaterial[] = [];
    const baseOpacities: number[] = [];
    const baseColors: Color[] = [];
    for (const mesh of meshes) {
      group.add(mesh);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.organId = meta.id;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const std = mat as MeshStandardMaterial;
        if (!materials.includes(std)) {
          materials.push(std);
          baseOpacities.push(std.opacity);
          baseColors.push(std.color.clone());
        }
      }
    }

    return {
      id: meta.id,
      system: meta.system,
      group,
      meshes,
      materials,
      baseOpacities,
      baseColors,
      fade: 1,
      fadeFrom: 1,
      fadeTo: 1,
      fadeT: FADE_SEC,
      dim: false,
    };
  }

  private buildShape(meta: OrganMeta): Mesh[] {
    const shape: OrganShape = meta.shape;
    switch (shape.kind) {
      case "sphere":
        return [this.sphereMesh(this.organMaterial(meta.color), shape.radius, shape.scale)];
      case "pair":
        return this.buildPair(meta, shape);
      case "tube":
        return this.buildTube(meta, shape.radius, shape.through);
      case "bronchi":
        return this.buildBronchi(meta);
      case "lips":
        return this.buildLips(meta);
      case "nasal":
        return this.buildNasal(meta);
      case "stomach":
        return this.buildStomach(meta);
      case "liver":
        return this.buildLiver(meta);
      case "gallbladder":
        return [this.sphereMesh(this.organMaterial(meta.color), 0.17, { x: 0.9, y: 1.4, z: 0.9 })];
      case "pancreas":
        return this.buildPancreas(meta);
      case "intestineCoil":
        return [this.tubeFromLocalPoints(meta, this.coilPoints(), 0.34, 120)];
      case "intestineFrame":
        return [this.tubeFromLocalPoints(meta, this.framePoints(), 0.2, 140)];
      case "heart":
        return this.buildHeart(meta);
      case "beanPair":
        return this.buildBeanPair(meta, shape);
      case "ureterPair":
        return this.buildUreters(meta);
      case "bladder":
        return [this.sphereMesh(this.organMaterial(meta.color), 0.42, { x: 1.2, y: 1, z: 1 })];
      case "alveoli":
        return this.buildAlveoli(meta);
      case "diaphragm":
        return this.buildDiaphragm(meta);
      case "muscleCell":
        return this.buildMuscleCell(meta);
    }
  }

  /** 젖은 기관 질감: 클리어코트 물성 + 부드러운 거칠기 */
  private organMaterial(color: number, opacity = 1): MeshPhysicalMaterial {
    return new MeshPhysicalMaterial({
      color,
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.25,
      clearcoatRoughness: 0.45,
      envMapIntensity: 0.9,
      transparent: opacity < 0.999,
      opacity,
      depthWrite: opacity > 0.6,
    });
  }

  private sphereMesh(mat: MeshStandardMaterial, radius: number, scale?: Vec3): Mesh {
    const m = new Mesh(new SphereGeometry(radius, 48, 32), mat);
    if (scale) m.scale.set(scale.x, scale.y, scale.z);
    return m;
  }

  /** 그룹 로컬 좌표(= 세계좌표 - 기관 위치)로 TubeGeometry 생성 */
  private tubeFromLocalPoints(meta: OrganMeta, localPoints: Vec3[], radius: number, segments: number): Mesh {
    const pts = localPoints.map((p) => new Vector3(p.x, p.y, p.z));
    const curve = new CatmullRomCurve3(pts, false, "centripetal");
    const geo = new TubeGeometry(curve, segments, radius, 20, false);
    return new Mesh(geo, this.organMaterial(meta.color));
  }

  // pair (폐)
  private buildPair(meta: OrganMeta, shape: Extract<OrganShape, { kind: "pair" }>): Mesh[] {
    const out: Mesh[] = [];
    for (const side of [-1, 1]) {
      const m = this.sphereMesh(this.organMaterial(meta.color), shape.radius);
      m.position.x = (side * shape.gap) / 2;
      m.scale.y = shape.scaleY ?? 1;
      if (shape.tilt) m.rotation.z = side * shape.tilt;
      out.push(m);
    }
    return out;
  }

  private buildTube(meta: OrganMeta, radius: number, through: Vec3[]): Mesh[] {
    // through는 신체 절대좌표 — 그룹이 meta.position에 놓이므로 로컬 좌표로 변환해야 함
    const local = through.map((p) => ({
      x: p.x - meta.position.x,
      y: p.y - meta.position.y,
      z: p.z - meta.position.z,
    }));
    return [this.tubeFromLocalPoints(meta, local, radius, Math.min(100, Math.max(24, through.length * 12)))];
  }

  // 숨관가지: 숨관 끝(0,0.1,0)에서 좌우 폐(±1.35, 0.5, 0.02)로 갈라짐
  private buildBronchi(meta: OrganMeta): Mesh[] {
    const out: Mesh[] = [];
    for (const side of [-1, 1]) {
      const pts: Vec3[] = [
        { x: 0, y: 0.12, z: 0 },
        { x: side * 0.35, y: 0.26, z: 0.02 },
        { x: side * 0.85, y: 0.4, z: 0.02 },
        { x: side * 1.35, y: 0.5, z: 0.02 },
      ];
      out.push(this.tubeFromLocalPoints(meta, pts, 0.11, 24));
    }
    return out;
  }

  // 코: 위로 갈수록 가늘어지는 마름모 콧대 + 둥근 끝 + 콧구멍 2개
  private buildNasal(meta: OrganMeta): Mesh[] {
    const mat = this.organMaterial(meta.color);
    const bridgeGeo = new CylinderGeometry(0.07, 0.19, 0.36, 4, 1);
    bridgeGeo.rotateY(Math.PI / 4); // 마름모 단면(모서리가 상하좌우)
    bridgeGeo.rotateX(-Math.PI / 2); // 축을 +z(얼굴 앞)로 — 넓은 아랫면이 콧끝
    const bridge = new Mesh(bridgeGeo, mat);
    bridge.scale.set(0.88, 1.15, 0.9);
    const tip = new Mesh(new SphereGeometry(0.115, 24, 16), mat);
    tip.scale.set(1.05, 0.95, 0.85);
    tip.position.set(0, -0.03, 0.19);
    const nostrilMat = this.organMaterial(0x8a4640);
    const out: Mesh[] = [bridge, tip];
    for (const side of [-1, 1]) {
      const nostril = new Mesh(new SphereGeometry(0.044, 16, 12), nostrilMat);
      nostril.scale.set(1, 0.7, 0.9);
      nostril.position.set(side * 0.105, -0.12, 0.1);
      out.push(nostril);
    }
    return out;
  }

  // 입: 윗입술(큐피드 활)·아랫입술 익스트루드 — 입술 사이 접촉선이 자연스러운 입
  private buildLips(meta: OrganMeta): Mesh[] {
    const mat = this.organMaterial(meta.color);
    mat.roughness = 0.32;
    mat.clearcoat = 0.55;
    const opts = {
      depth: 0.07,
      curveSegments: 24,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.028,
      bevelSegments: 4,
    };
    const upper = new Shape();
    upper.moveTo(-0.3, 0);
    upper.bezierCurveTo(-0.24, 0.09, -0.13, 0.105, -0.07, 0.075);
    upper.bezierCurveTo(-0.03, 0.05, 0.03, 0.05, 0.07, 0.075);
    upper.bezierCurveTo(0.13, 0.105, 0.24, 0.09, 0.3, 0);
    upper.bezierCurveTo(0.2, -0.05, 0.1, -0.065, 0, -0.065);
    upper.bezierCurveTo(-0.1, -0.065, -0.2, -0.05, -0.3, 0);
    const lower = new Shape();
    lower.moveTo(-0.27, -0.015);
    lower.bezierCurveTo(-0.14, -0.035, 0.14, -0.035, 0.27, -0.015);
    lower.bezierCurveTo(0.22, -0.14, 0.12, -0.19, 0, -0.19);
    lower.bezierCurveTo(-0.12, -0.19, -0.22, -0.14, -0.27, -0.015);
    const out: Mesh[] = [];
    for (const [shape, y] of [
      [upper, 0.012],
      [lower, -0.02],
    ] as const) {
      const geo = new ExtrudeGeometry(shape, opts);
      geo.translate(0, 0, -0.035); // 두께 중앙 정렬
      const mesh = new Mesh(geo, mat);
      mesh.scale.setScalar(0.77); // 두개골 치열 폭에 맞춘 축척
      mesh.position.y = y;
      out.push(mesh);
    }
    return out;
  }

  // J자 위주머니: 눌린 구 + 토스 호
  private buildStomach(meta: OrganMeta): Mesh[] {
    const mat = this.organMaterial(meta.color);
    const body = this.sphereMesh(mat, 0.6, { x: 0.95, y: 1.2, z: 0.78 });
    body.position.set(0.08, 0.18, 0);
    const hook = new Mesh(new TorusGeometry(0.38, 0.19, 20, 36, Math.PI * 1.15), mat);
    hook.position.set(-0.02, -0.26, 0);
    hook.rotation.z = -0.35;
    return [body, hook];
  }

  // 간: 몸 오른쪽(−x) 가로막 바로 아래의 큰 쐐기 + 정중선을 넘어가는 작은 왼엽
  private buildLiver(meta: OrganMeta): Mesh[] {
    const mat = this.organMaterial(meta.color);
    const right = this.sphereMesh(mat, 0.62, { x: 1.12, y: 0.86, z: 0.98 });
    right.position.set(-0.08, 0, 0);
    right.rotation.z = 0.18;
    const left = this.sphereMesh(mat, 0.4, { x: 1.35, y: 0.62, z: 0.8 });
    left.position.set(0.56, 0.2, 0.12);
    left.rotation.z = 0.32;
    return [right, left];
  }
  private buildPancreas(meta: OrganMeta): Mesh[] {
    const mat = this.organMaterial(meta.color);
    const body = new Mesh(new CapsuleGeometry(0.18, 1.15, 10, 24), mat);
    body.position.set(0.18, -0.05, 0);
    body.rotation.z = 0.45;
    const head = this.sphereMesh(mat, 0.27, { x: 1, y: 1.1, z: 0.9 });
    head.position.set(-0.48, -0.22, 0);
    return [body, head];
  }

  // 작은창자 군일: 복부 범위 안에서 결정론적 S자 3줄
  private coilPoints(): Vec3[] {
    return [
      { x: 1.0, y: 0.6, z: 0.05 },
      { x: 0.4, y: 0.65, z: -0.3 },
      { x: -0.35, y: 0.62, z: 0.1 },
      { x: -1.0, y: 0.58, z: -0.25 },
      { x: -1.05, y: 0.25, z: 0.12 },
      { x: -0.4, y: -0.02, z: -0.3 },
      { x: 0.3, y: 0.0, z: 0.1 },
      { x: 1.0, y: -0.02, z: -0.28 },
      { x: 1.05, y: -0.33, z: 0.12 },
      { x: 0.4, y: -0.58, z: -0.3 },
      { x: -0.3, y: -0.6, z: 0.1 },
      { x: -0.95, y: -0.58, z: -0.22 },
      { x: -0.95, y: -0.3, z: 0.1 },
    ];
  }

  // 큰창자: 오른쪽 아래 막창자 → 오름 → 가로 → 내림 → 구불 → 곧창자 (작은창자를 액자처럼 두른다)
  // 좌표는 기관 위치(0, 8.9, 0.1) 기준 — 실제 작은창자 메시(x -0.78~0.97, y 7.9~9.9)를 감싸도록 잡았다
  private framePoints(): Vec3[] {
    return [
      { x: -0.92, y: -0.95, z: 0.1 },
      { x: -1.04, y: -0.5, z: 0.08 },
      { x: -1.05, y: 0.3, z: 0.05 },
      { x: -0.95, y: 0.95, z: 0.12 },
      { x: -0.45, y: 1.12, z: 0.3 },
      { x: 0.15, y: 1.08, z: 0.34 },
      { x: 0.7, y: 1.12, z: 0.26 },
      { x: 1.08, y: 0.92, z: 0.1 },
      { x: 1.13, y: 0.2, z: 0.02 },
      { x: 1.08, y: -0.6, z: 0.0 },
      { x: 0.8, y: -1.05, z: -0.05 },
      { x: 0.35, y: -1.08, z: -0.15 },
      { x: 0.05, y: -1.3, z: -0.32 },
      { x: 0.0, y: -1.62, z: -0.38 },
    ];
  }
  // 심장: 기울어진 타원체 + 혈관 단 4개(동맥 2 적색, 정맥 2 청색)
  private buildHeart(meta: OrganMeta): Mesh[] {
    const mat = this.organMaterial(meta.color);
    const body = this.sphereMesh(mat, 0.55, { x: 1, y: 1.18, z: 0.9 });
    body.rotation.z = 0.4;
    const arterial = this.organMaterial(0xd64545);
    const venous = this.organMaterial(0x4d79d6);
    const stub = (mat2: MeshStandardMaterial, x: number, y: number, z: number, rotZ: number): Mesh => {
      const m = new Mesh(new CapsuleGeometry(0.08, 0.34, 8, 20), mat2);
      m.position.set(x, y, z);
      m.rotation.z = rotZ;
      return m;
    };
    return [
      body,
      stub(arterial, -0.12, 0.58, -0.06, -0.22),
      stub(arterial, 0.05, 0.64, 0.0, 0.12),
      stub(venous, 0.34, 0.5, 0.02, 0.35),
      stub(venous, -0.36, 0.46, 0.1, -0.4),
    ];
  }

  // 콩팥 1쌍: 눌린 구 + 회전으로 콩 모양 착시
  private buildBeanPair(meta: OrganMeta, shape: Extract<OrganShape, { kind: "beanPair" }>): Mesh[] {
    const out: Mesh[] = [];
    for (const side of [-1, 1]) {
      const m = this.sphereMesh(this.organMaterial(meta.color), 0.42, { x: 0.72, y: 1.15, z: 0.6 });
      m.position.set((side * (shape.gap ?? 1.1)) / 2, 0, 0);
      m.rotation.y = -side * 0.4;
      m.rotation.z = side * 0.12;
      out.push(m);
    }
    return out;
  }

  private buildUreters(meta: OrganMeta): Mesh[] {
    const out: Mesh[] = [];
    for (const side of [-1, 1]) {
      const pts: Vec3[] = [
        { x: side * 1.15, y: 1.15, z: -0.2 },
        { x: side * 0.85, y: 0.45, z: -0.15 },
        { x: side * 0.45, y: -0.5, z: 0.1 },
        { x: side * 0.16, y: -1.35, z: 0.45 },
        { x: side * 0.05, y: -1.85, z: 0.66 },
      ];
      out.push(this.tubeFromLocalPoints(meta, pts, 0.07, 32));
    }
    return out;
  }

  // 허파꽈리 포도송이: 반경 0.3 안에 14개 결정론적 배치
  private buildAlveoli(meta: OrganMeta): Mesh[] {
    const mat = this.organMaterial(meta.color);
    const geo = new SphereGeometry(1, 20, 14);
    const out: Mesh[] = [];
    const count = 14;
    for (let i = 0; i < count; i++) {
      const k = i + 0.5;
      const y = 1 - (2 * k) / count;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * 2.39996; // 황금각
      const size = 0.07 + 0.06 * ((i * 7) % 5) / 4;
      const m = new Mesh(geo, mat);
      m.position.set(Math.cos(phi) * ring * 0.3, y * 0.3, Math.sin(phi) * ring * 0.3);
      m.scale.setScalar(size);
      out.push(m);
    }
    return out;
  }

  private buildDiaphragm(meta: OrganMeta): Mesh[] {
    const mat = new MeshPhysicalMaterial({
      color: meta.color,
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.5,
      envMapIntensity: 1.1,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: DoubleSide,
    });
    const dome = new Mesh(new SphereGeometry(2.0, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.scale.set(1.12, 0.42, 0.85);
    return [dome];
  }

  private buildMuscleCell(meta: OrganMeta): Mesh[] {
    const shellMat = new MeshPhysicalMaterial({
      color: meta.color,
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.5,
      envMapIntensity: 1.1,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    const shell = new Mesh(new SphereGeometry(0.34, 32, 24), shellMat);
    const nucleusMat = new MeshPhysicalMaterial({
      color: 0xe8a13a,
      roughness: 0.35,
      metalness: 0,
      clearcoat: 0.5,
      clearcoatRoughness: 0.4,
      envMapIntensity: 1.2,
      emissive: 0xffdf6b,
      emissiveIntensity: 0.6,
    });
    const nucleus = new Mesh(new SphereGeometry(0.13, 24, 16), nucleusMat);
    return [shell, nucleus];
  }

  // ------------------------------------------------------------ visibility/fx

  private captureBreathTargets(): void {
    const lungs = this.records.get("lungs");
    const diaphragm = this.records.get("diaphragm");
    for (const mesh of lungs?.meshes ?? []) {
      this.breathTargets.push({
        kind: "lungs",
        mesh,
        baseScale: mesh.scale.clone(),
        basePos: mesh.position.clone(),
        center: new Box3().setFromObject(mesh).getCenter(new Vector3()),
      });
    }
    for (const mesh of diaphragm?.meshes ?? []) {
      this.breathTargets.push({
        kind: "diaphragm",
        mesh,
        baseScale: mesh.scale.clone(),
        basePos: mesh.position.clone(),
        center: new Box3().setFromObject(mesh).getCenter(new Vector3()),
      });
    }
  }

  private systemsVisible = new Set<SystemName>();
  private isolated: Set<string> | null = null;
  private systemOpacity = new Map<SystemName, number>();

  setSystemsVisible(visible: Set<SystemName>): void {
    this.systemsVisible = visible;
    for (const rec of this.records.values()) {
      this.setFadeTarget(rec, this.effectiveOn(rec));
    }
  }

  private onDemand = new Set<string>();

  /** 확대 모형(세포·허파꽈리) 중 지금 보여 줄 것을 정한다 */
  setOnDemandVisible(ids: readonly string[]): void {
    this.onDemand = new Set(ids.filter((id) => ON_DEMAND.has(id)));
    for (const id of ON_DEMAND) {
      const rec = this.records.get(id);
      if (rec) this.setFadeTarget(rec, this.effectiveOn(rec));
    }
  }

  isolateOrgans(organIds: string[] | null): void {
    this.isolated = organIds === null ? null : new Set(organIds);
    for (const rec of this.records.values()) {
      this.setFadeTarget(rec, this.effectiveOn(rec));
    }
  }

  /**
   * 실제 해부학 메시를 동일 id의 절차적 기관과 교체 수용.
   * 가시성/펄스/호흡/레이캐스트는 records 기준으로 동작하므로 교체만으로 전 시스템에 반영된다.
   */
  adoptReal(id: string, group: Group, meshes: Mesh[], materials: MeshStandardMaterial[]): boolean {
    const prev = this.records.get(id);
    const meta = ORGAN_MAP.get(id);
    if (!prev || !meta) return false;
    const parent = prev.group.parent;
    prev.group.removeFromParent();
    disposeObject(prev.group);

    group.name = id;
    group.userData.organId = id;
    for (const mesh of meshes) {
      mesh.userData.organId = id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = true; // 호흡 등 애니메이션이 스케일/위치를 바꿀 수 있음
      mesh.matrixWorldAutoUpdate = true;
    }
    if (prev.system === "cell") this.cellGroup.add(group);
    else this.systemGroups[prev.system].add(group);

    const rec: OrganRecord = {
      id,
      system: prev.system,
      group,
      meshes,
      materials,
      baseOpacities: materials.map((m) => m.opacity),
      baseColors: materials.map((m) => m.color.clone()),
      fade: 1,
      fadeFrom: 1,
      fadeTo: 1,
      fadeT: FADE_SEC,
      dim: false,
    };
    this.records.set(id, rec);
    if (parent) parent.add(group);

    this.breathTargets = [];
    this.captureBreathTargets();
    this.setFadeTarget(rec, this.effectiveOn(rec));
    return true;
  }

  setSystemOpacity(target: SystemName | "all", opacity: number): void {
    const v = MathUtils.clamp(opacity, 0, 1);
    const keys: SystemName[] = target === "all" ? ["digestive", "respiratory", "circulatory", "excretory"] : [target];
    for (const key of keys) this.systemOpacity.set(key, v);
    for (const rec of this.records.values()) {
      this.setFadeTarget(rec, this.effectiveOn(rec));
    }
  }

  /** 계통 토글 × 퀴즈 고립 × 계통 투명도 슬라이더를 모두 반영한 최종 가시 여부 */
  private effectiveOn(rec: OrganRecord): boolean {
    // 세포 표지는 그 세포를 다루는 단계에서만 보인다 (평소에는 다리에 뜬 점처럼 보여 혼란을 준다)
    const sysOn = rec.system === "cell" ? true : this.systemsVisible.has(rec.system);
    if (ON_DEMAND.has(rec.id) && !this.onDemand.has(rec.id)) return false;
    if (!sysOn) return false;
    return this.isolated === null || this.isolated.has(rec.id);
  }

  private setFadeTarget(rec: OrganRecord, on: boolean): void {
    const sys = rec.system === "cell" ? "circulatory" : rec.system;
    const to = on ? (this.systemOpacity.get(sys) ?? 1) : 0;
    if (rec.fadeTo === to) return;
    rec.fadeFrom = rec.fade;
    rec.fadeTo = to;
    rec.fadeT = 0;
    if (to > 0) rec.group.visible = true;
  }

  /** 불투명도 단일 작성자: baseOpacity × 계통페이드 × 딤 */
  refreshOpacity(rec: OrganRecord): void {
    const dimF = rec.dim ? DIM_FACTOR : 1;
    for (const [i, mat] of rec.materials.entries()) {
      const base = rec.baseOpacities[i] ?? 1;
      const opacity = MathUtils.clamp(base * rec.fade * dimF, 0, 1);
      mat.opacity = opacity;
      mat.transparent = opacity < 0.999;
      mat.depthWrite = opacity > 0.6;
    }
  }

  /** 기관 중심(세계 좌표). 실제 메시는 그룹이 원점에 있으므로 메타에 기록된 중심을 쓴다. */
  getOrganWorldPosition(id: string, out: Vector3): Vector3 | undefined {
    const meta = ORGAN_MAP.get(id);
    if (!meta || !this.records.has(id)) return undefined;
    return out.set(meta.position.x, meta.position.y, meta.position.z);
  }
  setBreathing(on: boolean): void {
    this.breathingOn = on;
    if (on && this.breathAmp === 0) this.breathPhase = 0;
  }

  update(dt: number): void {
    // 계통 페이드
    for (const rec of this.records.values()) {
      if (rec.fadeT < FADE_SEC && rec.fadeFrom !== rec.fadeTo) {
        rec.fadeT = Math.min(rec.fadeT + dt, FADE_SEC);
        const k = rec.fadeT / FADE_SEC;
        const eased = k * k * (3 - 2 * k);
        rec.fade = MathUtils.lerp(rec.fadeFrom, rec.fadeTo, eased);
        this.refreshOpacity(rec);
        if (k >= 1 && rec.fadeTo === 0) rec.group.visible = false;
      }
    }
    this.updateBreathing(dt);
  }

  private updateBreathing(dt: number): void {
    const target = this.breathingOn ? 1 : 0;
    if (this.breathAmp !== target) {
      const step = dt / 1.0; // 1초에 걸쳐 완만히 증감
      this.breathAmp = MathUtils.clamp(this.breathAmp + Math.sign(target - this.breathAmp) * step, 0, 1);
    }
    const a = this.breathAmp;
    if (a <= 0.0001) {
      if (this.breathTargetsBreathed) {
        for (const t of this.breathTargets) {
          t.mesh.scale.copy(t.baseScale);
          t.mesh.position.copy(t.basePos);
          t.mesh.rotation.x = 0;
        }
        this.breathTargetsBreathed = false;
      }
      return;
    }
    this.breathTargetsBreathed = true;
    this.breathPhase += dt;
    const s = Math.sin((Math.PI * 2 * this.breathPhase) / BREATH_PERIOD);
    for (const t of this.breathTargets) {
      if (t.kind === "lungs") {
        // 들숨(s>0): 가슴이 앞뒤·좌우·위아래로 넓어진다
        const fx = 1 + 0.07 * a * s;
        const fy = 1 + 0.06 * a * s;
        const fz = 1 + 0.1 * a * s;
        t.mesh.scale.set(t.baseScale.x * fx, t.baseScale.y * fy, t.baseScale.z * fz);
        t.mesh.position.set(
          t.center.x + (t.basePos.x - t.center.x) * fx,
          t.center.y + (t.basePos.y - t.center.y) * fy,
          t.center.z + (t.basePos.z - t.center.z) * fz,
        );
      } else {
        t.mesh.position.y = t.basePos.y - 0.22 * a * s; // 들숨(s>0)에 내려감
        t.mesh.rotation.x = 0.05 * a * s;
      }
    }
  }

  private breathTargetsBreathed = false;
}
