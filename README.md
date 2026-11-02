# 슬기로운 배구생활 · 연수생 통합 앱

겨울방학 배구 연수 「슬기로운 배구생활」 연수생과 강사가 함께 쓰는 통합 앱입니다.
연수생은 한 번 로그인하면 아래 기능을 모두 쓸 수 있고, 강사는 기수(1기·2기)별로 기능을 열고 닫을 수 있습니다.

| 화면 | 주소 | 내용 |
|---|---|---|
| 연수생 홈 | `/index.html` | 로그인, 공지, 기능 바로가기 |
| 연습 희망 조사 | `/index.html#survey` | ① 선택연습 희망 파트(리시브/수비/공격/세터) + 자유 의견 ② 시스템훈련 희망 포지션(9칸 코트) |
| AI 동작 분석 | `/ai.html` | 기존 AI 동작 분석 앱 (촬영 → AI 피드백, 성장 기록, 영상 주고받기) |
| 영상 자료실 | `/index.html#videos` | 유튜브 일부공개 영상을 링크 유출 없이 보기 (이름 워터마크, 열람 기록) |
| 강사 관리자 | `/admin.html` | 명단, 기수별 기능 ON/OFF, 희망 조사 결과, 영상 등록, 열람 기록, 공지 |

## 구조

```
index.html      연수생 앱 (홈 · 희망 조사 · 영상 자료실)
ai.html         AI 동작 분석 (기존 앱, 통합 로그인으로 연결)
admin.html      강사 관리자
config.js       서버 주소 설정 (여기만 바꾸면 됨)
supabase/
  functions/sv-api/index.ts         통합 API (Supabase Edge Function)
  migrations/001_sv_integrated.sql  통합 앱용 테이블
```

- 서버와 DB는 기존 AI 동작 분석 앱과 같은 Supabase 프로젝트(`ibgrow`)를 씁니다.
- 회원 명단은 AI 동작 분석의 `vball_trainees`를 그대로 함께 씁니다. 그래서 AI 분석 기록·보관함·영상 주고받기가 같은 계정에 그대로 이어집니다.
- 기수를 **강사**로 넣은 계정이 강사 계정입니다. 강사는 모든 기능을 항상 쓸 수 있고 관리자 화면에 들어갈 수 있습니다.
- 기존 `vball-api` 함수와 기존 AI 관리자 화면은 건드리지 않았습니다. 기수별 AI ON/OFF는 둘 다 같은 설정(`vball_batch_config`)을 보므로 어느 쪽에서 바꿔도 같습니다.

## GitHub Pages로 실행하기

1. GitHub에서 새 저장소를 만들고 이 폴더의 파일을 모두 올립니다. (`.nojekyll` 포함)
2. 저장소 **Settings → Pages → Build and deployment**에서 Source를 `Deploy from a branch`, Branch를 `main` / `/ (root)`로 저장합니다.
3. 1~2분 뒤 `https://<계정>.github.io/<저장소>/` 주소로 접속합니다.
4. 관리자 화면은 같은 주소 뒤에 `admin.html`을 붙입니다.

> 카메라 촬영(AI 동작 분석)은 https 주소에서만 동작합니다. GitHub Pages는 기본이 https라 그대로 됩니다.

## 처음 설정

1. `admin.html`에 강사 계정으로 로그인합니다. (처음에는 관리자 비밀번호 로그인도 가능: AI 분석 관리자 비밀번호와 같은 `ADMIN_PASSWORD`)
2. **연수생·강사** 탭에서 강사 5명(기수: 강사)과 연수생 명단(기수: 1기/2기)을 등록합니다. 엑셀 양식 업로드 또는 붙여넣기로 한 번에 넣을 수 있습니다.
3. **기수별 기능** 탭에서 기수마다 연습 희망 조사 / AI 동작 분석 / 영상 자료실을 켜고 끕니다.

## 서버 다시 배포할 때 (수정했을 때만)

```bash
supabase link --project-ref pqjuvuflinnrpemqcafl
supabase functions deploy sv-api --no-verify-jwt
```

선택: 토큰 서명 키를 따로 두려면 `supabase secrets set SV_TOKEN_SECRET=<긴 랜덤 문자열>` (없으면 서비스 키로 서명)

## 보안 참고

- 브라우저에는 공개 키만 있고, 통합 앱 데이터(`sv_*`)는 서버 함수만 읽고 쓸 수 있습니다(RLS로 직접 접근 차단).
- 로그인 5회 실패 시 10분 잠금, 토큰 12시간(관리자 비밀번호 6시간). 매 요청마다 계정 상태를 다시 확인해 계정 중지가 바로 반영됩니다.
- 영상 자료실은 화면 녹화까지 막을 수는 없어서, 이름 워터마크와 열람 기록으로 억제·추적합니다.
