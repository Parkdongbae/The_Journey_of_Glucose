/**
 * 퀴즈 패널 — 수업 화면 오른쪽 패널 자리에 들어가 한 번에 한 문제를 보여 준다.
 * 종류: 객관식(보기 순서 매번 섞음) · O/X · 기관 찾기(3D에서 직접 누르기) · 순서 맞추기.
 * 틀리면 고른 보기에 맞는 힌트를 주고 바로 다시 고를 수 있다. 맞히면 해설과 "다음 단계".
 */
import type { CourseId, McqQuiz, OrganClickQuiz, OrderQuiz, OxQuiz, Quiz, Scene } from "../types";
import { organLabel } from "../data/organs";
import { figureUrl, ICON } from "./assets";

export interface QuizPanelCallbacks {
  scene: Scene;
  onSolved(quizId: string, wrongCount: number): void;
  /** 설명으로 돌아가기 */
  onRequestClose(): void;
  /** 맞힌 뒤 다음 단계로 */
  onNext(): void;
}

export interface QuizOpenOptions {
  courseId: CourseId;
  wrongCount: number;
  alreadySolved: boolean;
  isLastStep: boolean;
}

export interface QuizPanelHandle {
  root: HTMLElement;
  open(quiz: Quiz, opts: QuizOpenOptions): void;
  close(): void;
  isOpen(): boolean;
}

const QUIZ_TAGS: Record<Quiz["kind"], string> = {
  mcq: "객관식",
  ox: "O / X",
  organClick: "기관 찾기",
  order: "순서 맞추기",
};

const MASCOT: Record<CourseId, { ok: string; bad: string }> = {
  glucose: { ok: "mGlucoseJoy", bad: "mGlucoseWow" },
  oxygen: { ok: "mOxygen", bad: "mOxygen" },
};

function shuffled<T>(items: readonly T[]): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = a;
  }
  return arr;
}

function requireEl<T extends Element>(scope: ParentNode, selector: string): T {
  const el = scope.querySelector<T>(selector);
  if (el === null) throw new Error(`QuizPanel: 요소를 찾을 수 없음 — ${selector}`);
  return el;
}

export function createQuizPanel(cb: QuizPanelCallbacks): QuizPanelHandle {
  const root = document.createElement("section");
  root.className = "quiz";
  root.hidden = true;
  root.setAttribute("aria-label", "퀴즈");
  root.innerHTML = `
    <div class="quiz-scroll">
      <header class="quiz-head">
        <span class="quiz-tag"></span>
        <button type="button" class="btn-chip quiz-back">${ICON.arrowLeft}설명 보기</button>
      </header>
      <p class="quiz-question"></p>
      <div class="quiz-content"></div>
      <div class="quiz-feedback" role="status" aria-live="polite" hidden>
        <img class="quiz-mascot" alt="" draggable="false" />
        <div class="quiz-feedback-text">
          <b class="quiz-verdict"></b>
          <p class="quiz-explain"></p>
        </div>
      </div>
    </div>
    <footer class="lesson-nav quiz-nav">
      <span class="quiz-tries"></span>
      <button type="button" class="btn btn-primary quiz-next" hidden><span class="quiz-next-label"></span>${ICON.arrowRight}</button>
    </footer>`;

  const tagEl = requireEl<HTMLElement>(root, ".quiz-tag");
  const questionEl = requireEl<HTMLElement>(root, ".quiz-question");
  const contentEl = requireEl<HTMLElement>(root, ".quiz-content");
  const feedbackEl = requireEl<HTMLElement>(root, ".quiz-feedback");
  const mascotEl = requireEl<HTMLImageElement>(root, ".quiz-mascot");
  const verdictEl = requireEl<HTMLElement>(root, ".quiz-verdict");
  const explainEl = requireEl<HTMLElement>(root, ".quiz-explain");
  const triesEl = requireEl<HTMLElement>(root, ".quiz-tries");
  const nextBtn = requireEl<HTMLButtonElement>(root, ".quiz-next");
  const nextLabel = requireEl<HTMLElement>(root, ".quiz-next-label");
  const scrollEl = requireEl<HTMLElement>(root, ".quiz-scroll");

  let current: Quiz | null = null;
  let opts: QuizOpenOptions = { courseId: "glucose", wrongCount: 0, alreadySolved: false, isLastStep: false };
  let wrongCount = 0;
  let resolved = false;
  let gen = 0;
  const pulsed = new Set<string>();
  /** 객관식: 화면 순서 → 원래 보기 번호 */
  let mcqOrder: number[] = [];
  /** 순서 맞추기: 현재 화면 순서 */
  let currentOrder: string[] = [];

  root.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (target === null) return;
    if (target.closest(".quiz-back") !== null) return cb.onRequestClose();
    if (target.closest(".quiz-next") !== null) return cb.onNext();
    const quiz = current;
    if (quiz === null) return;
    const choice = target.closest<HTMLButtonElement>(".quiz-choice[data-choice]");
    if (choice !== null && quiz.kind === "mcq") handleMcqPick(quiz, Number.parseInt(choice.dataset.choice ?? "", 10), choice);
    const ox = target.closest<HTMLButtonElement>(".ox-btn[data-ox]");
    if (ox !== null && quiz.kind === "ox") handleOxPick(quiz, ox.dataset.ox === "true", ox);
    const move = target.closest<HTMLButtonElement>("[data-move]");
    if (move !== null && quiz.kind === "order") handleOrderMove(quiz, move.dataset.move === "up", move);
    if (target.closest(".quiz-check") !== null && quiz.kind === "order") void handleOrderCheck(quiz);
  });

  // ---------- 공용 피드백 ----------
  function showFeedback(kind: "ok" | "bad", verdict: string, text: string): void {
    feedbackEl.hidden = false;
    feedbackEl.dataset.kind = kind;
    mascotEl.src = figureUrl(MASCOT[opts.courseId][kind]);
    mascotEl.className = `quiz-mascot mascot-${opts.courseId}`;
    verdictEl.textContent = verdict;
    explainEl.textContent = text;
    if (kind === "bad") {
      feedbackEl.classList.remove("shake");
      void feedbackEl.offsetWidth; // 애니메이션 재시작
      feedbackEl.classList.add("shake");
    }
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function showTries(): void {
    triesEl.textContent = resolved ? (wrongCount === 0 ? "한 번에 맞혔어요" : `${wrongCount}번 틀리고 맞혔어요`) : wrongCount > 0 ? `오답 ${wrongCount}번` : "";
  }

  function markWrong(hint: string): void {
    wrongCount++;
    showFeedback("bad", "다시 생각해 볼까요?", hint);
    showTries();
  }

  function markSolved(quiz: Quiz): void {
    const first = !resolved;
    resolved = true;
    if (first && !opts.alreadySolved) cb.onSolved(quiz.id, wrongCount);
    showFeedback("ok", "정답이에요!", quiz.explanation);
    nextLabel.textContent = opts.isLastStep ? "결과 보기" : "다음 단계";
    nextBtn.hidden = false;
    showTries();
  }

  function clearPulses(): void {
    for (const id of pulsed) cb.scene.pulseOrgan(id, false);
    pulsed.clear();
  }

  // ---------- 열기/닫기 ----------
  function open(quiz: Quiz, o: QuizOpenOptions): void {
    clearPulses();
    cb.scene.setOrganInteractivity(false);
    gen++;
    current = quiz;
    opts = o;
    wrongCount = o.alreadySolved ? 0 : o.wrongCount;
    resolved = false;
    root.hidden = false;
    root.classList.remove("is-playing");
    tagEl.textContent = QUIZ_TAGS[quiz.kind];
    questionEl.innerHTML = quiz.question; // 데이터 파일의 신뢰된 HTML
    feedbackEl.hidden = true;
    nextBtn.hidden = true;
    showTries();
    if (quiz.kind === "mcq") buildMcq(quiz);
    else if (quiz.kind === "ox") buildOx();
    else if (quiz.kind === "organClick") buildOrganClick(quiz);
    else buildOrder(quiz);
    scrollEl.scrollTop = 0;
  }

  function close(): void {
    gen++;
    clearPulses();
    cb.scene.setOrganInteractivity(false);
    cb.scene.isolateOrgans(null);
    current = null;
    resolved = false;
    root.hidden = true;
  }

  function isOpen(): boolean {
    return !root.hidden;
  }

  // ---------- 객관식 ----------
  function buildMcq(quiz: McqQuiz): void {
    mcqOrder = shuffled(quiz.choices.map((_, i) => i));
    contentEl.innerHTML = `<ul class="quiz-choices">${mcqOrder
      .map(
        (orig, shown) =>
          `<li><button type="button" class="quiz-choice" data-choice="${orig}"><span class="choice-num">${shown + 1}</span><span>${quiz.choices[orig] ?? ""}</span></button></li>`,
      )
      .join("")}</ul>`;
  }

  function handleMcqPick(quiz: McqQuiz, index: number, btn: HTMLButtonElement): void {
    if (resolved || Number.isNaN(index) || btn.disabled) return;
    if (index === quiz.answerIndex) {
      btn.classList.add("is-correct");
      for (const other of contentEl.querySelectorAll<HTMLButtonElement>(".quiz-choice")) other.disabled = true;
      markSolved(quiz);
    } else {
      btn.classList.add("is-wrong");
      btn.disabled = true;
      markWrong(quiz.hints?.[index] || "다른 보기를 골라 보세요.");
    }
  }

  // ---------- O/X ----------
  function buildOx(): void {
    contentEl.innerHTML = `<div class="ox-row">
      <button type="button" class="ox-btn ox-o" data-ox="true" aria-label="O, 맞다"><span>O</span><small>맞다</small></button>
      <button type="button" class="ox-btn ox-x" data-ox="false" aria-label="X, 틀리다"><span>X</span><small>틀리다</small></button>
    </div>`;
  }

  function handleOxPick(quiz: OxQuiz, picked: boolean, btn: HTMLButtonElement): void {
    if (resolved || btn.disabled) return;
    if (picked === quiz.answer) {
      btn.classList.add("is-correct");
      for (const other of contentEl.querySelectorAll<HTMLButtonElement>(".ox-btn")) other.disabled = true;
      markSolved(quiz);
      if (quiz.replayOrganIds !== undefined) {
        cb.scene.highlight(quiz.replayOrganIds);
        cb.scene.setFocusLabels(quiz.replayOrganIds);
      }
    } else {
      btn.classList.add("is-wrong");
      btn.disabled = true;
      markWrong(quiz.hint ?? "문장을 한 번 더 꼼꼼히 읽어 보세요.");
    }
  }

  // ---------- 기관 찾기 ----------
  function buildOrganClick(quiz: OrganClickQuiz): void {
    contentEl.innerHTML = `<p class="quiz-hint">${ICON.pointer}<span>3D 몸에서 <b>깜빡이는 기관</b> 가운데 하나를 직접 눌러 보세요. 끌어서 돌려 볼 수도 있어요.</span></p>
      <ul class="organ-options">${quiz.optionOrganIds.map((id) => `<li data-organ="${id}">${organLabel(id)}</li>`).join("")}</ul>`;
    if (quiz.view !== undefined) void cb.scene.flyTo(quiz.view).catch(() => {});
    cb.scene.clearHighlight();
    cb.scene.isolateOrgans(quiz.optionOrganIds);
    cb.scene.setFocusLabels([]);
    for (const id of quiz.optionOrganIds) {
      cb.scene.pulseOrgan(id, true);
      pulsed.add(id);
    }
    cb.scene.setOrganInteractivity(true);
    cb.scene.onOrganClick((organId) => {
      if (current !== quiz || resolved) return;
      if (!quiz.optionOrganIds.includes(organId)) return;
      const chip = contentEl.querySelector<HTMLElement>(`[data-organ="${organId}"]`);
      if (organId === quiz.answerOrganId) {
        chip?.classList.add("is-correct");
        clearPulses();
        cb.scene.setOrganInteractivity(false);
        cb.scene.highlight([organId]);
        cb.scene.setFocusLabels([organId]);
        markSolved(quiz);
      } else {
        if (chip?.classList.contains("is-wrong") === true) return;
        chip?.classList.add("is-wrong");
        cb.scene.pulseOrgan(organId, false);
        pulsed.delete(organId);
        markWrong(`방금 누른 곳은 ${organLabel(organId)}예요. ${quiz.hint ?? "다른 기관을 눌러 보세요."}`);
      }
    });
  }

  // ---------- 순서 맞추기 ----------
  function buildOrder(quiz: OrderQuiz): void {
    do {
      currentOrder = shuffled(quiz.items.map((it) => it.id));
    } while (currentOrder.every((id, i) => id === quiz.answerOrder[i]) && quiz.items.length > 1);
    contentEl.innerHTML = `<ol class="order-list"></ol>
      <button type="button" class="btn btn-primary quiz-check">${ICON.check}확인</button>`;
    renderOrderRows(quiz);
  }

  function renderOrderRows(quiz: OrderQuiz, wrongIndex = -1): void {
    const list = contentEl.querySelector<HTMLOListElement>(".order-list");
    if (list === null) return;
    const labels = new Map(quiz.items.map((it) => [it.id, it.label]));
    list.innerHTML = currentOrder
      .map((id, i) => {
        const label = labels.get(id) ?? id;
        return `<li class="order-row${i === wrongIndex ? " is-wrong" : ""}" data-oid="${id}">
          <span class="order-num" aria-hidden="true">${i + 1}</span>
          <span class="order-label">${label}</span>
          <span class="order-btns">
            <button type="button" class="btn-icon" data-move="up" aria-label="${label} 위로"${i === 0 ? " disabled" : ""}>${ICON.up}</button>
            <button type="button" class="btn-icon" data-move="down" aria-label="${label} 아래로"${i === currentOrder.length - 1 ? " disabled" : ""}>${ICON.down}</button>
          </span>
        </li>`;
      })
      .join("");
  }

  function handleOrderMove(quiz: OrderQuiz, up: boolean, btn: HTMLElement): void {
    if (resolved) return;
    const id = btn.closest<HTMLElement>(".order-row")?.dataset.oid;
    if (id === undefined) return;
    const i = currentOrder.indexOf(id);
    const j = up ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= currentOrder.length) return;
    const a = currentOrder[i] as string;
    currentOrder[i] = currentOrder[j] as string;
    currentOrder[j] = a;
    renderOrderRows(quiz);
    // 옮긴 항목의 같은 방향 버튼에 초점을 유지 (키보드 조작)
    contentEl.querySelector<HTMLButtonElement>(`[data-oid="${id}"] [data-move="${up ? "up" : "down"}"]:not(:disabled)`)?.focus();
  }

  async function handleOrderCheck(quiz: OrderQuiz): Promise<void> {
    if (resolved) return;
    const firstWrong = quiz.answerOrder.findIndex((id, i) => currentOrder[i] !== id);
    if (firstWrong >= 0) {
      renderOrderRows(quiz, firstWrong);
      markWrong(`${firstWrong + 1}번째 자리부터 다시 살펴보세요.`);
      return;
    }
    // 정답: 순서대로 기관을 하나씩 비추며 보여 준 뒤 해설
    resolved = true;
    if (!opts.alreadySolved) cb.onSolved(quiz.id, wrongCount);
    for (const b of contentEl.querySelectorAll<HTMLButtonElement>("button")) b.disabled = true;
    const myGen = gen;
    root.classList.add("is-playing");
    feedbackEl.hidden = true;
    triesEl.textContent = "정답! 3D에서 순서대로 따라가 볼게요…";
    try {
      await cb.scene.flyThroughOrganIds(quiz.answerOrder, 1.3);
    } catch {
      // 재생이 끊겨도 정답 처리는 유지
    }
    if (gen !== myGen || current !== quiz) return;
    root.classList.remove("is-playing");
    markSolved(quiz);
  }

  return { root, open, close, isOpen };
}
