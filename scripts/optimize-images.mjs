// 원본 삽화(images/)를 앱용 WebP로 경량화한다 → src/assets/figures/
// 실행: node scripts/optimize-images.mjs
import sharp from "sharp";
import fs from "node:fs";

const OUT = "src/assets/figures";
fs.mkdirSync(OUT, { recursive: true });

/** key: [원본 경로, 최대 폭] */
const FIGURES = {
  starch: ["images/녹말에서 포도당으로—소화 개념도.jpg", 1200],
  digestive: ["images/기본 소화관 모식도.jpg", 900],
  villi: ["images/작은창자 내부와 융털 확대도.jpg", 1200],
  portal: ["images/소장에서 흡수된 포도당의 간문맥 이동 경로.jpg", 1200],
  heart: ["images/심장과 주요 혈관 모식도.jpg", 1000],
  circulation: ["images/허파순환과 온몸순환 경로.jpg", 1000],
  pulmonary: ["images/oxygen/폐순환.png", 1200],
  systemic: ["images/oxygen/Systemic Circulation – Oxygen to the Body.jpg", 1000],
  respiratory: ["images/oxygen/Basic Respiratory System Diagram – Front View.png", 1000],
  breath: ["images/oxygen/Diaphragm Movement – Inhalation and Exhalation.jpg", 1200],
  alveoli: ["images/허파꽈리와 기체 교환.jpg", 1200],
  rbc: ["images/oxygen/Oxygen Binding to Red Blood Cells.jpg", 1200],
  exchange: ["images/모세혈관과 조직세포의 물질 교환.png", 1200],
  cellresp: ["images/세포호흡 반응식 개념도.jpg", 1200],
  cellrespO2: ["images/oxygen/Cellular Respiration Focused on Oxygen.jpg", 1200],
  co2: ["images/oxygen/Carbon Dioxide Leaving via Lungs.jpg", 1200],
  nephron: ["images/콩팥단위의 여과와 재흡수.jpg", 1200],
  excretory: ["images/기본 배설계 모식도.jpg", 800],
  waste: ["images/oxygen/Water and Wastes Leaving via Kidneys.jpg", 1200],
  journey: ["images/포도당의 여행 통합 경로 지도.jpg", 1200],
  mGlucose: ["images/포도당_기본.jpg", 320],
  mGlucoseWalk: ["images/포도당_걷는모습.jpg", 320],
  mGlucoseWow: ["images/포도당_놀라는모습.jpg", 320],
  mGlucoseJoy: ["images/포도당_즐거운모습.jpg", 320],
  mOxygen: ["images/oxygen/Oxygen Mascot Character.jpg", 360],
};

let total = 0;
for (const [key, [src, width]] of Object.entries(FIGURES)) {
  const out = `${OUT}/${key}.webp`;
  const info = await sharp(src).resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toFile(out);
  total += info.size;
  console.log(`${key.padEnd(14)} ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)}KB`);
}
console.log(`합계 ${(total / 1024 / 1024).toFixed(2)}MB`);
