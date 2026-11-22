# 포도당과 산소의 여행 — 3D 인체 탐험

중학교 과학 "동물과 에너지" 단원용 학습 웹앱. 떡볶이 속 녹말이 포도당이 되어, 들이마신 산소와
근육 세포에서 만나 에너지가 되기까지를 3D 인체 속에서 따라간다.

- **포도당의 여행** 14단계 · 퀴즈 14문항 / **산소의 여행** 12단계 · 퀴즈 12문항
- 퀴즈 4종: 객관식(보기 순서 매번 섞임) · O/X · 기관 찾기(3D에서 직접 누르기) · 순서 맞추기
- 자유 탐색: 기관 목록·설명·관련 수업 단계로 바로 가기
- 설치·인터넷 없이 `dist/index.html` 한 파일로 실행 (더블클릭)

## 실행

```
npm install
npm run dev      # 개발 서버
npm run build    # 타입 검사 + dist/index.html 단일 파일 빌드
npm run images   # images/ 원본 삽화 → src/assets/figures/*.webp (삽화를 바꿨을 때만)
```

## 구조

| 경로 | 내용 |
|---|---|
| `src/data/courses.ts` | 두 코스의 단계(설명·핵심 정리·용어·확대 자료·카메라 시점)와 퀴즈 |
| `src/data/organs.ts` · `paths.ts` | 기관 정의, 포도당·산소가 지나가는 3D 경로 |
| `src/3d/` | three.js 엔진 — 장면·조명(`SceneManager`), 몸·기관(`BodyBuilder`, `AnatomyRig`), 강조·클릭(`OrganHighlighter`), 경로(`PathAnimator`), 이름표(`LabelLayer`) |
| `src/ui/` | 화면 — `app.ts`(상태·주소), 홈·수업·퀴즈·탐색·결과, `styles.css`(디자인 토큰) |
| `images/` | 원본 삽화. 앱은 `src/assets/figures`의 경량 WebP를 쓴다 |

주소(해시): `#/` 홈 · `#/c/glucose/3` 수업 단계 · `#/explore` · `#/result`

저장: 진도 `journey_of_glucose_3d_v1`, 화면 설정 `journey_of_glucose_3d_prefs` (localStorage)

## 알아 둘 점

- **3D 모델의 한계**: `organs.glb`에는 폐·콩팥·오줌관이 한쪽만, 간·큰창자·대동맥·대정맥은 일부만 들어 있다.
  그래서 폐·콩팥·오줌관은 거울 복사로 반대쪽을 채우고(`AnatomyRig`의 `MIRRORED`),
  간·큰창자·혈관은 절차적으로 만든 형태를 쓴다(`KEEP_PROCEDURAL`). 왼쪽 폐는 실제와 달리 오른쪽 폐의 거울상이다.
- **경로 좌표**는 실제 메시 위치에 맞춘 값이다. 모델을 바꾸면 브라우저 콘솔에서
  `__scene.debugOrganCenters()`로 중심·경계를 확인해 `paths.ts`와 `courses.ts`의 시점을 다시 맞춘다.
- 허파꽈리와 근육 세포는 실제 크기로는 보이지 않아 크게 키운 **확대 모형**이며, 해당 단계에서만 나타난다.
- 성능 확인: `__scene.debugFrameMs()` (프레임당 ms).

## 라이선스

3D 골격·기관 모델은 Z-Anatomy(CC BY-SA 4.0) 파생물이다. `ATTRIBUTION.md` 참고.
