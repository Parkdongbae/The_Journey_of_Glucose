import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  SRGBColorSpace,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import type { FxSpec } from "../types";

interface Particle {
  obj: Sprite | Mesh;
  vel: Vector3;
  age: number;
  life: number;
  baseScale: number;
  material: SpriteMaterial | MeshBasicMaterial; // 파티클 전용 (개별 dispose)
  texture: CanvasTexture | null;
  fadeAt: number; // life 중 페이드 시작 비율
  grow: number; // 초당 스케일 증가율
}

interface Emitter {
  kind: "energy" | "co2" | "label";
  at: Vector3;
  elapsed: number;
  duration: number; // 스폰이 지속되는 시간
  spawnEvery: number;
  spawnAcc: number;
  particles: Particle[];
}

const ENERGY_LIFETIME = 6; // 6초간 반짝임 지속
const LABEL_LIFETIME = 4;
const CO2_LIFETIME = 2.2;

/** 캔버스 텍스처 스프라이트 기반 FX (CSS2D 레이어 없이 단일 캔버스 유지) */
export class FxLayer {
  private emitters: Emitter[] = [];
  private group = new Group();
  private starTexture: CanvasTexture;
  private co2Geo = new SphereGeometry(0.09, 8, 6);

  constructor(parent: Object3D) {
    this.group.name = "fx";
    parent.add(this.group);
    this.starTexture = makeStarTexture();
  }

  spawnFx(fx: FxSpec): void {
    const at = new Vector3(fx.at.x, fx.at.y, fx.at.z);
    if (fx.kind === "energy") {
      const count = Math.max(1, fx.count ?? 10);
      this.emitters.push(this.makeEmitter("energy", at, ENERGY_LIFETIME, ENERGY_LIFETIME / count));
    } else if (fx.kind === "co2") {
      const count = Math.max(1, fx.count ?? 8);
      this.emitters.push(this.makeEmitter("co2", at, count * 0.1, 0.1));
    } else {
      this.spawnLabel(fx.text, at);
    }
  }

  clearFx(): void {
    for (const em of this.emitters) this.disposeEmitter(em);
    this.emitters = [];
  }

  update(dt: number): void {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const em = this.emitters[i];
      if (!em) continue;
      em.elapsed += dt;
      if (em.kind !== "label" && em.elapsed < em.duration) {
        em.spawnAcc += dt;
        while (em.spawnAcc >= em.spawnEvery) {
          em.spawnAcc -= em.spawnEvery;
          this.spawnParticle(em);
        }
      }
      for (let p = em.particles.length - 1; p >= 0; p--) {
        const pt = em.particles[p];
        if (!pt) continue;
        pt.age += dt;
        if (pt.age >= pt.life) {
          this.disposeParticle(em, p);
          continue;
        }
        pt.obj.position.addScaledVector(pt.vel, dt);
        if (pt.grow > 0) {
          const s = pt.baseScale + pt.grow * pt.age;
          pt.obj.scale.setScalar(s);
        }
        // 나이에 따른 페이드 (라벨은 자체 곡선)
        const k = pt.age / pt.life;
        if (pt.obj instanceof Sprite) {
          pt.material.opacity = k < pt.fadeAt ? Math.min(1, k / 0.15) : Math.max(0, 1 - (k - pt.fadeAt) / (1 - pt.fadeAt));
        } else {
          pt.material.opacity = 0.55 * Math.max(0, 1 - k);
        }
      }
      const done = em.particles.length === 0 && (em.kind === "label" || em.elapsed >= em.duration);
      if (done) {
        this.disposeEmitter(em);
        this.emitters.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.clearFx();
    this.starTexture.dispose();
    this.co2Geo.dispose();
  }

  // ----------------------------------------------------------------- emitters

  private makeEmitter(kind: "energy" | "co2", at: Vector3, duration: number, spawnEvery: number): Emitter {
    return { kind, at, elapsed: 0, duration, spawnEvery, spawnAcc: spawnEvery, particles: [] };
  }

  private spawnParticle(em: Emitter): void {
    if (em.kind === "energy") {
      const mat = new SpriteMaterial({
        map: this.starTexture,
        color: 0xffe066,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const sprite = new Sprite(mat);
      const scale = 0.16 + Math.random() * 0.1;
      sprite.position.copy(em.at);
      sprite.position.x += (Math.random() - 0.5) * 0.5;
      sprite.position.y += (Math.random() - 0.5) * 0.3;
      sprite.position.z += (Math.random() - 0.5) * 0.5;
      sprite.scale.setScalar(scale);
      sprite.renderOrder = 9;
      this.group.add(sprite);
      em.particles.push({
        obj: sprite,
        vel: new Vector3((Math.random() - 0.5) * 0.5, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.5),
        age: 0,
        life: 1.4 + Math.random() * 0.6,
        baseScale: scale,
        material: mat,
        texture: this.starTexture,
        fadeAt: 0.6,
        grow: 0,
      });
    } else {
      const mat = new MeshBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.55, depthWrite: false });
      const m = new Mesh(this.co2Geo, mat);
      m.position.copy(em.at);
      m.position.x += (Math.random() - 0.5) * 0.3;
      m.position.z += (Math.random() - 0.5) * 0.3;
      m.renderOrder = 9;
      this.group.add(m);
      em.particles.push({
        obj: m,
        vel: new Vector3((Math.random() - 0.5) * 0.25, 0.45 + Math.random() * 0.25, 0.3 + Math.random() * 0.2),
        age: 0,
        life: CO2_LIFETIME * (0.8 + Math.random() * 0.4),
        baseScale: 1,
        material: mat,
        texture: null,
        fadeAt: 0,
        grow: 0.35,
      });
    }
  }

  private spawnLabel(text: string, at: Vector3): void {
    const tex = makeLabelTexture(text);
    const mat = new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
    const sprite = new Sprite(mat);
    const worldH = 0.55;
    sprite.scale.set(worldH * (tex.image.width / tex.image.height), worldH, 1);
    sprite.position.copy(at);
    sprite.renderOrder = 20;
    this.group.add(sprite);
    const em: Emitter = {
      kind: "label",
      at,
      elapsed: 0,
      duration: LABEL_LIFETIME,
      spawnEvery: 1,
      spawnAcc: 1,
      particles: [
        {
          obj: sprite,
          vel: new Vector3(0, 0.12, 0),
          age: 0,
          life: LABEL_LIFETIME,
          baseScale: 1,
          material: mat,
          texture: tex,
          fadeAt: 0.8,
          grow: 0,
        },
      ],
    };
    this.emitters.push(em);
  }

  // ------------------------------------------------------------------ cleanup

  private disposeParticle(em: Emitter, index: number): void {
    const pt = em.particles[index];
    if (!pt) return;
    this.group.remove(pt.obj);
    pt.material.dispose();
    if (pt.texture && pt.texture !== this.starTexture) pt.texture.dispose();
    em.particles.splice(index, 1);
  }

  private disposeEmitter(em: Emitter): void {
    for (let i = em.particles.length - 1; i >= 0; i--) this.disposeParticle(em, i);
  }
}

function makeStarTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffe066";
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3;
    // 플러스(+) 모양 별
    roundBar(ctx, size / 2 - 5, 4, 10, size - 8, 5);
    roundBar(ctx, 4, size / 2 - 5, size - 8, 10, 5);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function roundBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function makeLabelTexture(text: string): CanvasTexture {
  const font = "600 44px 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  let textWidth = 200;
  if (ctx) {
    ctx.font = font;
    textWidth = ctx.measureText(text).width;
  }
  const pad = 28;
  canvas.width = Math.ceil(textWidth + pad * 2);
  canvas.height = 84;
  const ctx2 = canvas.getContext("2d");
  if (ctx2) {
    // 둥근 배경
    const w = canvas.width;
    const h = canvas.height;
    const r = 18;
    ctx2.beginPath();
    ctx2.moveTo(r, 0);
    ctx2.arcTo(w, 0, w, h, r);
    ctx2.arcTo(w, h, 0, h, r);
    ctx2.arcTo(0, h, 0, 0, r);
    ctx2.arcTo(0, 0, w, 0, r);
    ctx2.closePath();
    ctx2.fillStyle = "rgba(255,255,255,0.92)";
    ctx2.fill();
    ctx2.lineWidth = 4;
    ctx2.strokeStyle = "rgba(84,130,180,0.9)";
    ctx2.stroke();
    ctx2.font = font;
    ctx2.fillStyle = "#23364d";
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";
    ctx2.fillText(text, w / 2, h / 2 + 2);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
