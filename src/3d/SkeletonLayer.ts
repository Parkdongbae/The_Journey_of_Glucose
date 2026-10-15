import { Box3, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import skeletonUrl from "../assets/skeleton.glb?url";

const BONE_COLOR = 0xe8e4da;
const TARGET_HEIGHT = 15.4;

/** skeleton.glb (EXT_meshopt_compression) 로딩 + 정규화 + 단일 골재질 토글 레이어 */
export class SkeletonLayer {
  readonly root = new Group();
  loaded = false;
  private desiredVisible = false;

  constructor() {
    this.root.name = "skeleton";
    this.root.visible = false;
  }

  async load(): Promise<boolean> {
    try {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await new Promise<GLTF>((resolve, reject) => {
        loader.load(skeletonUrl, resolve, undefined, reject);
      });
      const model = gltf.scene;
      this.normalize(model);
      this.applyBoneMaterial(model);
      this.root.add(model);
      this.root.updateMatrixWorld(true);
      model.traverse((obj) => {
        obj.matrixAutoUpdate = false;
        obj.matrixWorldAutoUpdate = false; // 정적 subtree — 프레임 갱신 스킵 (826 meshes)
      });
      this.loaded = true;
      this.root.visible = this.desiredVisible;
      return true;
    } catch {
      return false; // 로딩 실패해도 씬은 계속 동작
    }
  }

  setVisible(on: boolean): void {
    this.desiredVisible = on;
    if (this.loaded) this.root.visible = on;
  }

  /** bbox 실측 후 y ∈ [0, 15.4], x/z 중앙 정렬로 스케일·위치 보정 */
  private normalize(model: Group): void {
    const box = new Box3().setFromObject(model);
    if (box.isEmpty()) return;
    const size = box.getSize(new Vector3());
    if (size.y > 0.0001) model.scale.setScalar(TARGET_HEIGHT / size.y);
    box.setFromObject(model);
    const center = box.getCenter(new Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
  }

  private applyBoneMaterial(model: Group): void {
    const boneMat = new MeshStandardMaterial({
      color: BONE_COLOR,
      roughness: 0.8,
      metalness: 0,
      transparent: true,
      opacity: 0.95,
    });
    model.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.material = boneMat;
        obj.userData.isSkeleton = true; // 기관 레이캐스트 제외 마커
      }
    });
  }
}
