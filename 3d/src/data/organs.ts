import type { OrganMeta, Vec3 } from "../types";

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/**
 * 신체 좌표계: Y-up, 발끝 y=0 ~ 머리 꼭대기 y≈15.4 (신장 16유닛 ≈ 1.71m).
 * x: 신체 기준 왼쪽이 +, z: 몸 앞이 +.
 * 기관 위치는 2D 앱 ORGANS 좌표(정면 실루엣 %)를 3D 신장으로 환산한 뒤 해부학적으로 보정한 값.
 */
export const ORGANS: OrganMeta[] = [
  {
    id: "mouth",
    label: "입",
    system: "digestive",
    position: v(0, 13.9, 0.68),
    shape: { kind: "lips" },
    color: 0xc94b55,
    description:
      "입에서는 이와 혀, 침이 함께 작용하여 음식물을 잘게 부수고, 침 속 아밀레이스가 녹말을 분해하기 시작합니다.",
  },
  {
    id: "esophagus",
    label: "식도",
    system: "digestive",
    position: v(0, 12.3, -0.18),
    shape: {
      kind: "tube",
      radius: 0.16,
      through: [v(0, 13.5, 0.35), v(0, 13.0, -0.1), v(0, 12.2, -0.15), v(0, 11.4, -0.1), v(0.6, 10.85, 0.1), v(0.9, 10.7, 0.3)],
    },
    color: 0xdf8f9a,
    description:
      "식도는 입에서 잘게 부서진 음식물을 위로 내려 보내는 통로입니다. 소화효소는 분비되지 않고, 근육의 움직임으로 음식물이 이동합니다.",
  },
  {
    id: "stomach",
    label: "위",
    system: "digestive",
    position: v(0.95, 10.6, 0.32),
    shape: { kind: "stomach" },
    color: 0xe8919c,
    description:
      "위에서는 위액 속 펩신이 단백질을 작은 조각으로 분해하고, 위의 운동으로 음식물이 잘 섞입니다.",
  },
  {
    id: "liver",
    label: "간",
    system: "digestive",
    position: v(-1.05, 10.95, 0.25),
    shape: { kind: "liver" },
    color: 0x8d4f3d,
    description: "간에서는 쓸개즙이 만들어져 지방의 소화를 돕습니다.",
  },
  {
    id: "gallbladder",
    label: "쓸개",
    system: "digestive",
    position: v(-0.65, 10.4, 0.4),
    shape: { kind: "gallbladder" },
    color: 0x5d8f57,
    description:
      "쓸개는 간에서 만들어진 쓸개즙을 저장했다가 작은창자로 보내는 기관입니다. 쓸개즙에는 소화효소가 들어 있지 않습니다.",
  },
  {
    id: "pancreas",
    label: "이자",
    system: "digestive",
    position: v(0.15, 10.45, 0.05),
    shape: { kind: "pancreas" },
    color: 0xd9b23f,
    description:
      "이자는 이자액을 분비하는데, 이자액에는 아밀레이스, 트립신, 라이페이스 등이 들어 있어 탄수화물, 단백질, 지방의 소화를 돕습니다.",
  },
  {
    id: "smallIntestine",
    label: "작은창자",
    system: "digestive",
    position: v(0, 8.75, 0.15),
    shape: { kind: "intestineCoil" },
    color: 0xdf9a86,
    description:
      "작은창자는 탄수화물, 단백질, 지방의 소화와 영양소의 흡수가 모두 일어나는 곳입니다. 이자액과 쓸개즙 등이 분비되어 소화가 계속되고, 융털을 통해 영양소가 흡수됩니다.",
  },
  {
    id: "largeIntestine",
    label: "큰창자",
    system: "digestive",
    position: v(0, 8.7, -0.1),
    shape: { kind: "intestineFrame" },
    color: 0xc47b6a,
    description:
      "큰창자에서는 소화효소가 분비되지 않아 소화작용은 일어나지 않고, 물과 일부 비타민이 흡수됩니다. 남은 찌꺼기는 항문을 통해 몸 밖으로 배출됩니다.",
  },
  {
    id: "nasal",
    label: "코",
    system: "respiratory",
    position: v(0, 14.32, 0.68),
    shape: { kind: "nasal" },
    color: 0xdb8f7a,
    description:
      "코로 들어온 공기는 코안에서 따뜻하게 데워지고 촉촉해지며, 먼지는 걸러집니다.",
  },
  {
    id: "trachea",
    label: "숨관(기관)",
    system: "respiratory",
    position: v(0, 12.5, 0.12),
    shape: {
      kind: "tube",
      radius: 0.18,
      through: [v(0, 13.55, 0.25), v(0, 13.0, 0.15), v(0, 12.4, 0.12), v(0, 11.95, 0.1)],
    },
    color: 0xb8c4d8,
    description:
      "숨관은 코(또는 입)에서 들어온 공기가 폐로 들어가는 통로입니다. 불 때 나오는 소리는 이곳의 성대에서 만들어집니다.",
  },
  {
    id: "bronchi",
    label: "숨관가지(기관지)",
    system: "respiratory",
    position: v(0, 11.85, 0.1),
    shape: { kind: "bronchi" },
    color: 0xa9b8cf,
    description:
      "숨관가지는 숨관이 갈라진 길로, 왼쪽·오른쪽 폐로 공기를 나누어 보냅니다.",
  },
  {
    id: "lungs",
    label: "폐",
    system: "respiratory",
    position: v(0, 12.35, 0.1),
    shape: { kind: "pair", radius: 0.85, gap: 1.45, scaleY: 1.45 },
    color: 0xe98a92,
    description:
      "폐는 허파꽈리와 이를 둘러싼 모세혈관으로 이루어져 있으며, 산소와 이산화 탄소를 교환하는 기관입니다.",
  },
  {
    id: "alveoli",
    label: "허파꽈리",
    system: "respiratory",
    position: v(1.3, 11.85, 0.3),
    shape: { kind: "alveoli" },
    color: 0xf2b3b8,
    description:
      "허파꽈리는 폐 안의 아주 작은 주머니로, 겉을 모세혈관이 둘러쌓아 산소와 이산화 탄소의 기체 교환이 일어납니다.",
  },
  {
    id: "diaphragm",
    label: "가로막",
    system: "respiratory",
    position: v(0, 11.35, 0),
    shape: { kind: "diaphragm" },
    color: 0xd0788a,
    description:
      "가로막은 가슴과 배를 가르는 근육으로, 들숨에 내려가 평평해지고 날숨에 올라가 둥글어집니다.",
  },
  {
    id: "heart",
    label: "심장",
    system: "circulatory",
    position: v(0.25, 11.9, 0.3),
    shape: { kind: "heart" },
    color: 0xc9454f,
    description:
      "심장은 펌프처럼 작용하여 혈액을 온몸으로 내보내고 되돌려 받는 기관입니다. 네 개의 방(우심방, 우심실, 좌심방, 좌심실)과 판막이 있어 혈액이 한 방향으로 흐르도록 돕습니다.",
  },
  {
    id: "aorta",
    label: "대동맥",
    system: "circulatory",
    position: v(0, 11.6, -0.35),
    shape: {
      kind: "tube",
      radius: 0.17,
      through: [
        v(0.3, 12.15, 0.1),
        v(0.15, 12.55, -0.05),
        v(-0.2, 12.4, -0.3),
        v(-0.25, 11.5, -0.42),
        v(-0.2, 10.2, -0.45),
        v(-0.1, 9.0, -0.4),
        v(0.15, 7.9, -0.15),
        v(0.7, 6.4, 0.1),
        v(0.85, 5.2, 0.28),
        v(0.85, 4.5, 0.32),
      ],
    },
    color: 0xd64545,
    description:
      "대동맥은 심장에서 나가는 혈액이 흐르는 가장 굵은 동맥으로, 산소가 가득한 혈액을 온몸으로 내보냅니다.",
  },
  {
    id: "venaCava",
    label: "대정맥",
    system: "circulatory",
    position: v(0.55, 11.5, -0.3),
    shape: {
      kind: "tube",
      radius: 0.19,
      through: [
        v(0.85, 4.6, 0.05),
        v(0.8, 5.6, -0.1),
        v(0.6, 7.2, -0.3),
        v(0.55, 9.0, -0.35),
        v(0.5, 10.6, -0.3),
        v(0.4, 11.6, -0.2),
        v(0.3, 11.95, 0.0),
      ],
    },
    color: 0x4d79d6,
    description:
      "대정맥은 온몸에서 돌아온 혈액이 심장(우심방)으로 들어오는 가장 굵은 정맥입니다.",
  },
  {
    id: "kidneys",
    label: "콩팥",
    system: "excretory",
    position: v(0, 10.35, -0.55),
    shape: { kind: "beanPair", gap: 1.15 },
    color: 0x8f4d3f,
    description:
      "콩팥은 토리, 보먼주머니, 세뇨관으로 이루어진 콩팥단위를 통해 오줌을 만드는 기관입니다.",
  },
  {
    id: "ureters",
    label: "오줌관",
    system: "excretory",
    position: v(0, 9.2, -0.35),
    shape: { kind: "ureterPair" },
    color: 0xc9b8a8,
    description: "오줌관은 콩팥에서 만들어진 오줌을 방광으로 내려보내는 통로입니다.",
  },
  {
    id: "bladder",
    label: "방광",
    system: "excretory",
    position: v(0, 7.25, 0.35),
    shape: { kind: "bladder" },
    color: 0xd8c27a,
    description: "방광은 오줌을 일시적으로 저장하는 기관입니다.",
  },
  {
    id: "thighCell",
    label: "다리 근육 세포",
    system: "cell",
    position: v(0.85, 4.55, 0.35),
    shape: { kind: "muscleCell" },
    color: 0xf6c445,
    description:
      "근육 세포 안의 미토콘드리아에서 포도당과 산소로 세포호흡이 일어나 에너지를 만듭니다.",
  },
];

export const ORGAN_MAP: Map<string, OrganMeta> = new Map(ORGANS.map((o) => [o.id, o]));

export function organLabel(id: string): string {
  return ORGAN_MAP.get(id)?.label ?? id;
}
