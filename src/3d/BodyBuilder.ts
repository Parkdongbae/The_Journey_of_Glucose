import {
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { ORGAN_MAP } from "../data/organs";
import type { OrganMeta, OrganShape, OrganSystem, SystemName, Vec3 } from "../types";

function disposeObject(root: Group): void {
  root.traverse((obj) => {
    if (obj instanceof Mesh) {
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m.dispose();
    }
  });
}

const SKIN_COLOR = 0xf5cdb0;
const FADE_SEC = 0.4;
const BREATH_PERIOD = 4;
const DIM_FACTOR = 0.35;

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
}

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

  private buildSkin(): void {
    const mat = new MeshStandardMaterial({
      color: SKIN_COLOR,
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
    });
    const add = (geo: CapsuleGeometry | SphereGeometry, x: number, y: number, z: number, rotZ = 0): void => {
      const m = new Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.z = rotZ;
      m.renderOrder = 5; // 반투명 피부는 기관 뒤에서 그려짐 (기관이 비쳐 보임)
      this.skinGroup.add(m);
    };
    add(new CapsuleGeometry(1.15, 4.3, 10, 28), 0, 10.4, 0); // torso
    add(new SphereGeometry(1.08, 36, 24), 0, 14.15, 0); // head
    add(new CapsuleGeometry(0.4, 0.6, 8, 18), 0, 13.15, 0); // neck
    add(new CapsuleGeometry(0.36, 5.3, 8, 18), 1.52, 9.7, 0, -0.1); // left arm
    add(new CapsuleGeometry(0.36, 5.3, 8, 18), -1.52, 9.7, 0, 0.1); // right arm
    add(new CapsuleGeometry(0.5, 6.3, 8, 20), 0.62, 3.55, 0); // left leg
    add(new CapsuleGeometry(0.5, 6.3, 8, 20), -0.62, 3.55, 0); // right leg
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
        return [this.tubeFromLocalPoints(meta, this.framePoints(), 0.3, 110)];
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
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.5,
      envMapIntensity: 1.1,
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

  // 간: −x(신체 오른쪽)에 납작한 쐐기 + 작은 엽
  private buildLiver(meta: OrganMeta): Mesh[] {
    const mat = this.organMaterial(meta.color);
    const main = this.sphereMesh(mat, 0.95, { x: 1.3, y: 0.6, z: 0.9 });
    main.position.set(0, 0.08, 0);
    main.rotation.z = 0.1;
    const lobe = this.sphereMesh(mat, 0.55, { x: 1.0, y: 0.5, z: 0.75 });
    lobe.position.set(0.85, -0.12, 0.1);
    return [main, lobe];
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

  // 큰창자 테두리: −x(오른쪽) 상행 → 가로 → +x(왼쪽) 하행 → 직장 갈고리
  private framePoints(): Vec3[] {
    return [
      { x: -1.3, y: -0.75, z: -0.05 },
      { x: -1.42, y: 0.0, z: -0.05 },
      { x: -1.3, y: 0.85, z: -0.05 },
      { x: -0.7, y: 1.15, z: -0.05 },
      { x: 0, y: 1.2, z: -0.05 },
      { x: 0.7, y: 1.15, z: -0.05 },
      { x: 1.32, y: 0.8, z: -0.05 },
      { x: 1.42, y: 0.0, z: -0.05 },
      { x: 1.3, y: -0.68, z: -0.05 },
      { x: 0.8, y: -0.95, z: -0.05 },
      { x: 0.25, y: -1.0, z: -0.02 },
      { x: -0.15, y: -0.85, z: 0.0 },
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
      opacity: 0.45,
      depthWrite: false,
    });
    const shell = new Mesh(new SphereGeometry(0.5, 32, 24), shellMat);
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
    const nucleus = new Mesh(new SphereGeometry(0.17, 24, 16), nucleusMat);
    return [shell, nucleus];
  }

  // ------------------------------------------------------------ visibility/fx

  private captureBreathTargets(): void {
    const lungs = this.records.get("lungs");
    const diaphragm = this.records.get("diaphragm");
    for (const mesh of lungs?.meshes ?? []) {
      this.breathTargets.push({ kind: "lungs", mesh, baseScale: mesh.scale.clone(), basePos: mesh.position.clone() });
    }
    for (const mesh of diaphragm?.meshes ?? []) {
      this.breathTargets.push({
        kind: "diaphragm",
        mesh,
        baseScale: mesh.scale.clone(),
        basePos: mesh.position.clone(),
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
      baseOpacities: materials.map(() => 1),
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
    const sysOn = rec.system === "cell" ? this.systemsVisible.has("circulatory") : this.systemsVisible.has(rec.system);
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

  getOrganWorldPosition(id: string, out: Vector3): Vector3 | undefined {
    const rec = this.records.get(id);
    if (!rec) return undefined;
    return rec.group.getWorldPosition(out);
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
        t.mesh.scale.set(
          t.baseScale.x * (1 - 0.04 * a * s),
          t.baseScale.y * (1 + 0.12 * a * s),
          t.baseScale.z * (1 - 0.04 * a * s),
        );
      } else {
        t.mesh.position.y = t.basePos.y - 0.22 * a * s; // 들숨(s>0)에 내려감
        t.mesh.rotation.x = 0.05 * a * s;
      }
    }
  }

  private breathTargetsBreathed = false;
}
