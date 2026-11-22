import { Box3, Color, DoubleSide, Group, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Vector3 } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import skeletonUrl from "../assets/skeleton.glb?url";
import organsUrl from "../assets/organs.glb?url";
import { ORGAN_MAP } from "../data/organs";
import type { BodyBuilder } from "./BodyBuilder";

const BONE_COLOR = 0xe8e4da;
const TARGET_HEIGHT = 15.4;
const TINT_MIX = 0.06;
/** 흰색 혼합 비율 — 낮을수록 기관 고유색이 진하게 산다 */
const TINT_OVERRIDE: Partial<Record<string, number>> = {
  heart: 0.03,
  lungs: 0.1,
  liver: 0.04,
  kidneys: 0.04,
};

const loadGltf = (loader: GLTFLoader, url: string): Promise<GLTF> =>
  new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));

/**
 * Z-Anatomy 파생 골격 + 실제 기관(GLB)을 하나의 좌표계로 로드.
 * 골격 bbox로 정규변환(s, T)을 구해 기관에도 동일 적용 → 해부학적 정합 보장.
 * 기관은 BodyBuilder.adoptReal로 절차적 메시와 교체된다.
 */
export class AnatomyRig {
  readonly skeletonRoot = new Group();
  loaded = false;
  private skeletonDesired = false;
  private skeletonLoaded = false;

  constructor() {
    this.skeletonRoot.name = "skeleton";
    this.skeletonRoot.visible = false;
  }

  async load(body: BodyBuilder): Promise<number> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const [skel, organs] = await Promise.all([loadGltf(loader, skeletonUrl), loadGltf(loader, organsUrl).catch(() => null)]);

    const s = this.normalizeSkeleton(skel.scene);
    this.applyBoneMaterial(skel.scene);
    this.skeletonRoot.add(skel.scene);
    this.skeletonRoot.updateMatrixWorld(true);
    freezeTransforms(this.skeletonRoot);
    this.skeletonLoaded = true;
    this.skeletonRoot.visible = this.skeletonDesired;

    let adopted = 0;
    if (organs !== null) {
      const organRoot = organs.scene;
      organRoot.scale.setScalar(s);
      organRoot.position.set(this.offset.x, this.offset.y, this.offset.z);
      organRoot.updateMatrixWorld(true);
      adopted = this.adoptOrgans(organRoot, body);
      freezeTransforms(organRoot);
    }
    this.loaded = true;
    return adopted;
  }

  setSkeletonVisible(on: boolean, ghost = false): void {
    this.skeletonDesired = on;
    this.ghost = ghost;
    if (this.skeletonLoaded) this.skeletonRoot.visible = on;
    this.applyGhost();
  }

  private ghost = false;
  private boneMat: MeshStandardMaterial | null = null;

  /** 흐린 뼈대: 기관을 가리지 않고 위치 감각만 준다 */
  private applyGhost(): void {
    const mat = this.boneMat;
    if (mat === null) return;
    mat.opacity = this.ghost ? 0.16 : 0.96;
    mat.depthWrite = !this.ghost;
  }

  /** 골격 bbox 기준 정규화. 기관이 재사용할 s/오프셋을 반환한다. */
  private offset = new Vector3();

  private normalizeSkeleton(model: Group): number {
    const box = new Box3().setFromObject(model);
    if (box.isEmpty()) return 1;
    const size = box.getSize(new Vector3());
    const s = size.y > 0.0001 ? TARGET_HEIGHT / size.y : 1;
    model.scale.setScalar(s);
    box.setFromObject(model);
    const center = box.getCenter(new Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
    this.offset.set(-center.x, -box.min.y, -center.z);
    return s;
  }

  private applyBoneMaterial(model: Group): void {
    const boneMat = new MeshStandardMaterial({
      color: BONE_COLOR,
      roughness: 0.8,
      metalness: 0,
      transparent: true,
      opacity: 0.96,
    });
    this.boneMat = boneMat;
    this.applyGhost();
    model.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.material = boneMat;
        obj.receiveShadow = true;
        obj.userData.isSkeleton = true; // 기관 레이캐스트 제외 마커
      }
    });
  }

  private adoptOrgans(root: Group, body: BodyBuilder): number {
    const white = new Color(0xffffff);
    const byName = new Map<string, Mesh[]>();
    root.updateMatrixWorld(true);
    const rootMatrix = root.matrixWorld.clone();
    root.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const id = organIdFromName(obj.name);
      if (id === null) return;
      // organRoot(스케일+오프셋) 변환을 메시에 베이크 — 재부모닝 후에도 정규화가 유지된다
      obj.applyMatrix4(rootMatrix);
      const list = byName.get(id) ?? [];
      list.push(obj);
      byName.set(id, list);
    });

    let adopted = 0;
    for (const [id, meshes] of byName) {
      const meta = ORGAN_MAP.get(id);
      if (meta === undefined || KEEP_PROCEDURAL.has(id)) continue;

      // 원본 모델에 한쪽만 들어 있는 쌍 기관은 정중면에 대해 거울 복사해 반대쪽을 채운다
      const mirror = MIRRORED[id];
      if (mirror !== undefined) {
        for (const mesh of meshes.slice()) {
          const twin = mesh.clone();
          twin.applyMatrix4(MIRROR_X);
          twin.position.y += mirror.dy;
          meshes.push(twin);
        }
      }

      const group = new Group();
      const materials: MeshStandardMaterial[] = [];
      const tint = new Color(meta.color).lerp(white, TINT_OVERRIDE[id] ?? TINT_MIX);
      const seeThrough = SEE_THROUGH[id];
      const mat = new MeshPhysicalMaterial({
        color: tint,
        roughness: 0.5,
        metalness: 0,
        clearcoat: 0.25,
        clearcoatRoughness: 0.45,
        envMapIntensity: 0.9,
        ...(seeThrough !== undefined ? { transparent: true, opacity: seeThrough, depthWrite: false, side: DoubleSide } : {}),
      });
      materials.push(mat);
      for (const mesh of meshes) {
        mesh.removeFromParent();
        mesh.material = mat;
        group.add(mesh);
      }
      if (body.adoptReal(id, group, meshes, materials)) {
        adopted++;
        const center = new Box3().setFromObject(group).getCenter(new Vector3());
        meta.position = { x: center.x, y: center.y, z: center.z };
      }
    }

    // 허파꽈리(확대 모형)는 오른쪽 폐 앞면 안쪽에 둔다 — 폐가 흐려지는 단계에서 속이 들여다보이도록
    const lungsRec = body.records.get("lungs");
    const alveoli = body.records.get("alveoli");
    const alveoliMeta = ORGAN_MAP.get("alveoli");
    if (lungsRec !== undefined && alveoli !== undefined && alveoliMeta !== undefined) {
      const box = new Box3().setFromObject(lungsRec.group);
      const c = box.getCenter(new Vector3());
      alveoliMeta.position = { x: box.min.x * 0.52, y: c.y - 0.15, z: box.max.z - 0.42 };
      alveoli.group.position.set(alveoliMeta.position.x, alveoliMeta.position.y, alveoliMeta.position.z);
    }
    return adopted;
  }
}

/** 원본 모델에 일부분만 들어 있어(혈관은 몸통 구간만, 간·큰창자는 한 조각만) 절차적으로 만든 온전한 형태를 쓰는 기관 */
const KEEP_PROCEDURAL = new Set(["aorta", "venaCava", "liver", "largeIntestine"]);
/** 거울 복사로 반대쪽을 채울 기관 (dy: 반대쪽의 높이 차) */
const MIRRORED: Partial<Record<string, { dy: number }>> = {
  lungs: { dy: 0 },
  kidneys: { dy: -0.12 }, // 오른쪽 콩팥은 간 때문에 조금 낮다
  ureters: { dy: 0 },
};
/** 뒤의 기관을 가리지 않도록 반투명으로 그릴 기관 */
const SEE_THROUGH: Partial<Record<string, number>> = { diaphragm: 0.24 };
const MIRROR_X = new Matrix4().makeScale(-1, 1, 1);
function organIdFromName(name: string): string | null {
  if (!name.startsWith("ORG_")) return null;
  const id = name.slice(4).trim();
  return ORGAN_MAP.has(id) ? id : null;
}

function freezeTransforms(root: Group): void {
  root.traverse((obj) => {
    obj.matrixAutoUpdate = false;
    obj.matrixWorldAutoUpdate = false;
  });
}
