/**
 * 퀴즈 패널 — 한 번에 하나의 퀴즈를 담는 오버레이(데스크톱 우측 카드 / ≤760px 바텀시트).
 * kind별 렌더: mcq · ox · organClick(3D 펄스+클릭 판정) · order(순서 배열+경로 재생 보상).
 * 정답 판정 즉시 onSolved로 진도 저장을 위임하고, 해설은 정답 후에만 노출한다.
 */
import type { McqQuiz, OrganClickQuiz, OrderQuiz, OxQuiz, Quiz, SceneApi } from "../types";
import { organLabel } from "../data/organs";

export interface QuizPanelCallbacks {
  scene: SceneApi;
  onSolved(quizId: string, wrongCount: number): void;
  /** 닫기 버튼/계속하기 등 패널 스스로 닫고 싶을 때 — 앱이 정리 후 닫아준다 */
  onRequestClose(): void;
}

export interface QuizPanelHandle {
  root: HTMLElement;
  open(quiz: Quiz, startWrongCount: number): void;
  close(): void;
  isOpen(): boolean;
}

const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

const QUIZ_TAGS: Record<Quiz["kind"], string> = {
  mcq: "객관식",
  ox: "O/X 퀴즈",
  organClick: "기관 찾기",
  order: "순서 맞추기",
};

/** 퀴즈 id에 대해 항상 같은 셔플 결과를 내는 시드 (세션 내 순서 고정) */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function stableShuffle<T>(items: readonly T[], seedKey: string): T[] {
  const arr = items.slice();
  let seed = hashString(seedKey) || 1; // xorshift32 시드 0 금지
  const rand = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = arr[i] as T;
    const b = arr[j] as T;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

export function createQuizPanel(cb: QuizPanelCallbacks): QuizPanelHandle {
  const root = document.createElement("div");
  root.className = "quiz-overlay";
  root.hidden = true;
  root.innerHTML = `
    <div class="quiz-pill" role="status">경로 재생 중…</div>
    <section class="quiz-card glass" aria-label="퀴즈">
      <header class="quiz-head">
        <span class="quiz-tag"></span>
        <button class="btn-icon quiz-close" aria-label="퀴즈 닫기">${ICON_CLOSE}</button>
      </header>
      <p class="quiz-question"></p>
      <div class="quiz-content"></div>
      <div class="quiz-banner" role="status" hidden></div>
      <p class="quiz-explanation" hidden></p>
      <footer class="quiz-footer">
        <button class="btn btn-ghost quiz-retry" hidden>다시 풀어보기</button>
        <button class="btn btn-primary quiz-continue" hidden>계속하기</button>
      </footer>
    </section>`;

  const card = requireEl<HTMLElement>(root, ".quiz-card");
  const tagEl = requireEl<HTMLElement>(root, ".quiz-tag");
  const questionEl = requireEl<HTMLElement>(root, ".quiz-question");
  const contentEl = requireEl<HTMLElement>(root, ".quiz-content");
  const bannerEl = requireEl<HTMLElement>(root, ".quiz-banner");
  const explanationEl = requireEl<HTMLElement>(root, ".quiz-explanation");
  const retryBtn = requireEl<HTMLButtonElement>(root, ".quiz-retry");
  const continueBtn = requireEl<HTMLButtonElement>(root, ".quiz-continue");

  let current: Quiz | null = null;
  let wrongCount = 0;
  let resolved = false;
  let gen = 0;
  const pulsed = new Set<string>();
  /** order 퀴즈: 현재 화면 표시 순서(정답 여부와 무관) */
  let currentOrder: string[] = [];

  root.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (target === null) return;
    if (target.closest(".quiz-close") !== null) {
      cb.onRequestClose();
      return;
    }
    if (target.closest(".quiz-continue") !== null) {
      cb.onRequestClose();
      return;
    }
    if (target.closest(".quiz-retry") !== null) {
      resetWrongFeedback();
      resetKindWrongState();
      return;
    }
    const choice = target.closest<HTMLButtonElement>(".quiz-choice[data-choice]");
    if (choice !== null && current?.kind === "mcq") handleMcqPick(current, Number.parseInt(choice.dataset.choice ?? "", 10));
    const ox = target.closest<HTMLButtonElement>(".btn-ox[data-ox]");
    if (ox !== null && current?.kind === "ox") handleOxPick(current, ox.dataset.ox === "true");
    const move = target.closest<HTMLButtonElement>(".order-btns [data-move]");
    if (move !== null && current?.kind === "order") handleOrderMove(current, move.dataset.move === "up", move);
    if (target.closest(".quiz-play") !== null && current?.kind === "order") void handleOrderPlay(current);
  });

  // ---------- 공용 피드백 ----------
  function showBanner(kind: "ok" | "bad", text: string): void {
    bannerEl.className = `quiz-banner ${kind}`;
    bannerEl.textContent = text;
    bannerEl.hidden = false;
  }

  function showExplanation(text: string): void {
    explanationEl.textContent = text;
    explanationEl.hidden = false;
  }

  function resetWrongFeedback(): void {
    bannerEl.hidden = true;
    retryBtn.hidden = true;
  }

  function shake(): void {
    card.classList.remove("shake");
    void card.offsetWidth; // 애니메이션 재시작 트릭
    card.classList.add("shake");
  }

  function markSolved(quiz: Quiz): void {
    if (resolved) return;
    resolved = true;
    cb.onSolved(quiz.id, wrongCount);
  }

  /** 오답 상태 초기화는 kind별로 다르게 동작 */
  function resetKindWrongState(): void {
    const quiz = current;
    if (quiz === null) return;
    if (quiz.kind === "mcq") {
      for (const btn of contentEl.querySelectorAll<HTMLButtonElement>(".quiz-choice.wrong")) {
        btn.classList.remove("wrong");
        btn.disabled = false;
      }
    } else if (quiz.kind === "ox") {
      // O/X는 버튼이 항상 활성 상태라 별도 복구 없음
    } else if (quiz.kind === "order") {
      for (const row of contentEl.querySelectorAll<HTMLElement>(".order-row.order-wrong")) {
        row.classList.remove("order-wrong");
      }
    }
  }

  function clearPulses(): void {
    for (const id of pulsed) cb.scene.pulseOrgan(id, false);
    pulsed.clear();
  }

  // ---------- kind별 빌더 ----------
  function open(quiz: Quiz, startWrongCount: number): void {
    clearPulses();
    cb.scene.setOrganInteractivity(false);
    gen++;
    current = quiz;
    wrongCount = startWrongCount;
    resolved = false;
    root.classList.remove("quiz-min");
    root.hidden = false;
    tagEl.textContent = QUIZ_TAGS[quiz.kind];
    questionEl.innerHTML = quiz.question; // 데이터 파일의 신뢰된 HTML
    bannerEl.hidden = true;
    explanationEl.hidden = true;
    retryBtn.hidden = true;
    continueBtn.hidden = true;
    if (quiz.kind === "mcq") buildMcq(quiz);
    else if (quiz.kind === "ox") buildOx(quiz);
    else if (quiz.kind === "organClick") buildOrganClick(quiz);
    else buildOrder(quiz);
  }

  function close(): void {
    gen++;
    clearPulses();
    cb.scene.setOrganInteractivity(false);
    cb.scene.isolateOrgans(null);
    current = null;
    resolved = false;
    root.hidden = true;
    root.classList.remove("quiz-min");
  }

  function isOpen(): boolean {
    return root.hidden === false;
  }

  // ---------- 객관식 ----------
  function buildMcq(quiz: McqQuiz): void {
    contentEl.innerHTML = `<ul class="quiz-choices">${quiz.choices
      .map((c, i) => `<li><button class="quiz-choice" data-choice="${i}">${c}</button></li>`)
      .join("")}</ul>`;
  }

  function handleMcqPick(quiz: McqQuiz, index: number): void {
    if (resolved || Number.isNaN(index)) return;
    const btn = contentEl.querySelector<HTMLButtonElement>(`.quiz-choice[data-choice="${index}"]`);
    if (btn === null || btn.disabled) return;
    if (index === quiz.answerIndex) {
      markSolved(quiz);
      btn.classList.add("correct");
      for (const other of contentEl.querySelectorAll<HTMLButtonElement>(".quiz-choice")) other.disabled = true;
      resetWrongFeedback();
      showBanner("ok", "정답!");
      showExplanation(quiz.explanation);
      continueBtn.hidden = false;
    } else {
      wrongCount++;
      btn.classList.add("wrong");
      btn.disabled = true;
      showBanner("bad", "아쉬워요! 다시 생각해 보세요.");
      retryBtn.hidden = false;
      shake();
    }
  }

  // ---------- O/X ----------
  function buildOx(_quiz: OxQuiz): void {
    contentEl.innerHTML = `<div class="ox-row">
      <button class="btn btn-ox ox-yes" data-ox="true" aria-label="O, 참">O</button>
      <button class="btn btn-ox ox-no" data-ox="false" aria-label="X, 거짓">X</button>
    </div>`;
  }

  function handleOxPick(quiz: OxQuiz, picked: boolean): void {
    if (resolved) return;
    if (picked === quiz.answer) {
      markSolved(quiz);
      resetWrongFeedback();
      showBanner("ok", "정답!");
      showExplanation(quiz.explanation);
      continueBtn.hidden = false;
      if (quiz.replayOrganIds !== undefined) cb.scene.highlight(quiz.replayOrganIds);
    } else {
      wrongCount++;
      showBanner("bad", "아쉬워요! 다시 생각해 보세요.");
      retryBtn.hidden = false;
      shake();
    }
  }

  // ---------- 기관 찾기 ----------
  function buildOrganClick(quiz: OrganClickQuiz): void {
    contentEl.innerHTML = `<p class="quiz-hint">3D 몸에서 깜빡이는 기관을 직접 클릭하세요!</p>`;
    if (quiz.view !== undefined) void cb.scene.flyTo(quiz.view).catch(() => {});
    cb.scene.isolateOrgans(quiz.optionOrganIds);
    for (const id of quiz.optionOrganIds) {
      cb.scene.pulseOrgan(id, true);
      pulsed.add(id);
    }
    cb.scene.setOrganInteractivity(true);
    cb.scene.onOrganClick((organId) => {
      if (current !== quiz || resolved) return;
      if (organId === quiz.answerOrganId) {
        markSolved(quiz);
        clearPulses();
        cb.scene.setOrganInteractivity(false);
        resetWrongFeedback();
        showBanner("ok", "정답!");
        showExplanation(quiz.explanation);
        continueBtn.hidden = false;
      } else {
        wrongCount++;
        // 방금 틀린 기관은 보기 목록에서 제외하고 남은 보기 라벨을 안내
        const remaining = quiz.optionOrganIds.filter((id) => id !== organId).map(organLabel);
        showBanner("bad", `다시 시도! 남은 보기: ${remaining.join(", ")}`);
        shake();
      }
    });
  }

  // ---------- 순서 맞추기 ----------
  function buildOrder(quiz: OrderQuiz): void {
    const labels = new Map(quiz.items.map((it) => [it.id, it.label]));
    currentOrder = stableShuffle(quiz.items, quiz.id).map((it) => it.id);
    contentEl.innerHTML = `<ol class="order-list"></ol>
      <button class="btn btn-primary quiz-play">재생</button>`;
    renderOrderRows(labels);
  }

  function renderOrderRows(labels: Map<string, string>): void {
    const list = contentEl.querySelector<HTMLOListElement>(".order-list");
    if (list === null) return;
    list.innerHTML = currentOrder
      .map((id, i) => {
        const label = labels.get(id) ?? id;
        return `<li class="order-row" data-oid="${id}">
          <span class="order-num" aria-hidden="true">${i + 1}</span>
          <span class="order-label">${label}</span>
          <span class="order-btns">
            <button class="btn-icon" data-move="up" aria-label="${label} 위로 이동"${i === 0 ? " disabled" : ""}>↑</button>
            <button class="btn-icon" data-move="down" aria-label="${label} 아래로 이동"${i === currentOrder.length - 1 ? " disabled" : ""}>↓</button>
          </span>
        </li>`;
      })
      .join("");
  }

  function handleOrderMove(quiz: OrderQuiz, up: boolean, btn: HTMLElement): void {
    if (resolved) return;
    const row = btn.closest<HTMLElement>(".order-row");
    const id = row?.dataset.oid;
    if (id === undefined) return;
    const i = currentOrder.indexOf(id);
    const j = up ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= currentOrder.length) return;
    const a = currentOrder[i] as string;
    const b = currentOrder[j] as string;
    currentOrder[i] = b;
    currentOrder[j] = a;
    const labels = new Map(quiz.items.map((it) => [it.id, it.label]));
    renderOrderRows(labels);
  }

  async function handleOrderPlay(quiz: OrderQuiz): Promise<void> {
    if (resolved) return;
    for (const row of contentEl.querySelectorAll<HTMLElement>(".order-row.order-wrong")) {
      row.classList.remove("order-wrong");
    }
    let firstWrong = -1;
    for (let i = 0; i < quiz.answerOrder.length; i++) {
      if (currentOrder[i] !== quiz.answerOrder[i]) {
        firstWrong = i;
        break;
      }
    }
    if (firstWrong >= 0) {
      wrongCount++;
      const rows = contentEl.querySelectorAll<HTMLElement>(".order-row");
      const wrongRow = rows[firstWrong];
      if (wrongRow !== undefined) wrongRow.classList.add("order-wrong");
      showBanner("bad", "순서를 다시 보세요.");
      shake();
      return;
    }
    // 정답: 저장 → 패널 축소 → 경로 재생 보상 → 복원
    markSolved(quiz);
    const myGen = gen;
    root.classList.add("quiz-min");
    try {
      await cb.scene.flyThroughOrganIds(quiz.answerOrder, 1.6);
    } catch {
      // 재생 실패해도 정답 처리는 유지
    }
    if (gen !== myGen || current !== quiz) return;
    root.classList.remove("quiz-min");
    showBanner("ok", "정답!");
    showExplanation(quiz.explanation);
    continueBtn.hidden = false;
  }

  return { root, open, close, isOpen };
}

function requireEl<T extends Element>(scope: ParentNode, selector: string): T {
  const el = scope.querySelector<T>(selector);
  if (el === null) throw new Error(`QuizPanel: 요소를 찾을 수 없음 — ${selector}`);
  return el;
}
