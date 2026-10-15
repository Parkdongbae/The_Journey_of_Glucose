/**
 * 공용 타입 계약 — 3D 코어(/src/3d)와 UI(/src/ui)가 모두 의존하는 단일 진실 원천.
 * 좌표계: Y-up, 신장 16유닛 (발끝 y=0, 머리 꼭대기 y≈15.4). x=좌우(+: 신체 기준 왼쪽), z=앞(+가 몸 앞).
 */

export type SystemName = "digestive" | "respiratory" | "circulatory" | "excretory";

/** 기관이 속한 계통 (근육 세포 표적은 계통 외 "cell") */
export type OrganSystem = SystemName | "cell";

/**
 * 절차적 기관 형상 지시서 — 3D 엔진이 이 스펙을 보고 메시를 생성한다.
 * kind별 세부 지오메트리 구현은 엔진(BodyBuilder)의 몫.
 */
export type OrganShape =
  | { kind: "sphere"; radius: number; scale?: Vec3 }
  | { kind: "pair"; radius: number; gap: number; scaleY?: number; tilt?: number } // 좌우 1쌍 (폐·콩팥)
  | { kind: "tube"; radius: number; through: Vec3[]; tipRadius?: number } // 식도·기관·혈관
  | { kind: "bronchi" } // 숨관가지 2갈래
  | { kind: "lips" } // 입: 윗입술(큐피드 활)+아랫입술 익스트루드
  | { kind: "nasal" }
  | { kind: "stomach" }
  | { kind: "liver" }
  | { kind: "gallbladder" }
  | { kind: "pancreas" }
  | { kind: "intestineCoil" } // 작은창자: 뱀처럼 군일된 관
  | { kind: "intestineFrame" } // 큰창자: 몸통을 두른 테두리
  | { kind: "heart" } // 4방 + 폐혈관 단
  | { kind: "beanPair"; gap: number } // 콩팥 1쌍(콩 모양)
  | { kind: "ureterPair" } // 오줌관 1쌍
  | { kind: "bladder" }
  | { kind: "alveoli" } // 허파꽈리 포도송이 클러스터
  | { kind: "diaphragm" } // 가로막 돔
  | { kind: "muscleCell" }; // 세포호흡 표적 근육세포

export const SYSTEM_LABELS: Record<SystemName, string> = {
  digestive: "소화계",
  respiratory: "호흡계",
  circulatory: "순환계",
  excretory: "배설계",
};

/** 경로 애니메이션에 등장하는 캐릭터/물질 */
export type CharacterType = "starch" | "glucose" | "oxygen" | "co2" | "water" | "nutrient";

export type QuizKind = "organClick" | "order" | "ox" | "mcq";

export type CourseId = "glucose" | "oxygen";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraView {
  position: Vec3;
  target: Vec3;
}

export interface OrganMeta {
  id: string; // 예: "mouth"
  label: string; // 한글: "입"
  system: OrganSystem;
  position: Vec3; // 기관 중심 (신체 좌표계)
  shape: OrganShape; // 절차적 지오메트리 지시서
  color: number; // 기본 머티리얼 색 (0xrrggbb)
  description: string; // 자유 탐색에서 기관 클릭 시 표시되는 설명
}

/** 3D 스플라인 경로 정의 */
export interface PathDef {
  id: string;
  points: Vec3[];
  closed?: boolean;
}

/** 스텝 연출용 부가 이펙트 */
export type FxSpec =
  | { kind: "energy"; at: Vec3; count?: number } // 세포호흡 에너지(번개/별)
  | { kind: "co2"; at: Vec3; count?: number } // 이산화탄소 방출
  | { kind: "label"; text: string; at: Vec3 }; // 공간 라벨

/** 코스의 한 스텝 = 카메라 이동 + 하이라이트 + (선택) 경로 애니메이션 + (선택) 퀴즈 */
export interface CourseStep {
  id: string;
  title: string;
  body: string; // 설명 텍스트 (HTML 문자열 허용: <b>, <br>)
  view: CameraView;
  focusOrganIds: string[];
  /** 스텝 진입 시 켜질 계통 레이어 (나머지는 자동 반투명/숨김) */
  showSystems: SystemName[];
  pathId?: string;
  character?: CharacterType;
  pathDurationSec?: number;
  pathLoops?: number;
  fx?: FxSpec[];
  quizId?: string;
  /** 들숨/날숨 데모: 폐·가로막·갈비뼈를 천천히 움직임 */
  breathing?: boolean;
}

export interface OrganClickQuiz {
  kind: "organClick";
  id: string;
  question: string;
  explanation: string;
  /** 3D 씬에서 깜빡일 보기 기관들 */
  optionOrganIds: string[];
  answerOrganId: string;
  /** 퀴즈 열림 시 이동할 카메라 뷰 (보기 기관이 한눈에 보이는 넓은 시점 권장) */
  view?: CameraView;
}

export interface OrderQuiz {
  kind: "order";
  id: string;
  question: string;
  explanation: string;
  /** 화면에 섞여 보여줄 항목(정답 순서 아님) — 재생 시 이 순서대로 카메라가 순회 */
  items: { id: string; label: string }[];
  /** 정답 순서의 item id 배열 */
  answerOrder: string[];
}

export interface OxQuiz {
  kind: "ox";
  id: string;
  question: string;
  explanation: string;
  answer: boolean;
  /** 오답 해설 시 함께 강조할 기관(예: 동맥/정맥 색 설명) */
  replayOrganIds?: string[];
}

export interface McqQuiz {
  kind: "mcq";
  id: string;
  question: string;
  explanation: string;
  choices: string[];
  answerIndex: number;
}

export type Quiz = OrganClickQuiz | OrderQuiz | OxQuiz | McqQuiz;

export interface Course {
  id: CourseId;
  title: string;
  subtitle: string;
  accentColor: string; // UI 강조색 (#rrggbb)
  steps: CourseStep[];
  quizzes: Record<string, Quiz>;
  /** 코스 완료 화면용 여정 요약 (기관 id 나열) */
  journeySummary: { organId: string; label: string }[];
}

/** localStorage 저장 구조 */
export interface QuizResult {
  solved: boolean;
  wrongCount: number;
}

export interface CourseProgress {
  visitedStepIds: string[];
  quizResults: Record<string, QuizResult>;
}

export interface SaveData {
  glucose: CourseProgress;
  oxygen: CourseProgress;
}

/** 진도 저장소 (localStorage 폴백: 메모리) */
export interface ProgressStore {
  load(): SaveData;
  save(data: SaveData): void;
  reset(): void;
}

/** 3D 씬이 UI에 노출하는 API — UI는 three.js를 직접 import하지 않고 이 인터페이스만 사용 */
export interface SceneApi {
  /** 계통 레이어 가시성 토글 (지정 외 계통은 숨김) */
  setSystemsVisible(visible: SystemName[]): void;
  /** 카메라를 뷰로 부드럽게 이동 (easing) */
  flyTo(view: CameraView, durationSec?: number): Promise<void>;
  /** 전신 기본 뷰로 복귀 */
  resetView(durationSec?: number): Promise<void>;
  /** 기관 강조 (윤곽선/밝기), 나머지는 살짝 어둡게 */
  highlight(organIds: string[]): void;
  clearHighlight(): void;
  /** 퀴즈 보기 기관 링 펄스 */
  pulseOrgan(organId: string, on: boolean): void;
  /** 스플라인 따라 캐릭터 이동. 완료 시 resolve. */
  playPath(def: PathDef, character: CharacterType, opts: { durationSec: number; loops: number }): Promise<void>;
  stopPath(): void;
  /** 퀴즈 '경로 재구성' 재생용: 기관 목록을 순서대로 카메라 순회 */
  flyThroughOrganIds(organIds: string[], perStopSec: number): Promise<void>;
  spawnFx(fx: FxSpec): void;
  clearFx(): void;
  /** 들숨/날숨 데모 애니메이션 토글 (폐 확장·수축 + 가로막 이동 + 갈비뼈 미세 회전) */
  setBreathing(on: boolean): void;
  /** 자유 탐색용: 기관 클릭 콜백 등록 (이미 등록된 콜백을 대체) */
  onOrganClick(cb: (organId: string) => void): void;
  /** 기관 클릭 레이캐스트 on/off (퀴즈 정답 판정 시 true) */
  setOrganInteractivity(enabled: boolean): void;
  /** 기관 고립 표시: 지정 기관만 남기고 나머지 숨김 (null이면 계통 레이어 상태로 복원) */
  isolateOrgans(organIds: string[] | null): void;
  /** 계통(또는 전체) 머티리얼 불투명도 0..1 — Zygote식 계통 투명도 조절 */
  setSystemOpacity(target: SystemName | "all", opacity: number): void;
  /** 저사양 감소 옵션 */
  setQuality(level: "low" | "high"): void;
  resize(): void;
  dispose(): void;
}

export type AppScreen = "home" | "course" | "explore" | "result";

/**
 * 3D 엔진이 UI에 노출하는 상위집합 (SceneApi + 탐험 도구).
 * 구현은 src/3d/index.ts createScene.
 */
export interface Scene extends SceneApi {
  setSkeletonVisible(on: boolean): void;
  /** 주요 기관 이름 라벨(리더선) 토글 */
  setLabelsVisible(on: boolean): void;
  /** 자유 탐색 호버 기관 변경 콜백 (null = 벗어남) */
  onHoverChange(cb: (organId: string | null) => void): void;
  /** 인터랙티브 상태에서 빈 공간 클릭 (탐색 격리 해제용) */
  onEmptyClick(cb: () => void): void;
}
