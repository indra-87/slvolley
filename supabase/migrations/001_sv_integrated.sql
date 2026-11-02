-- 슬기로운 배구생활 통합 앱 (sv_*) 테이블
-- 기존 AI 동작 분석 테이블(vball_*)은 그대로 두고, 회원 명단은 vball_trainees 를 함께 사용한다.
-- 모든 sv_* 테이블은 RLS 를 켜고 정책을 두지 않아 브라우저에서 직접 접근할 수 없다 (sv-api 서버 함수만 접근).

-- 기수별 기능 ON/OFF (survey: 희망 조사, videos: 영상 자료실)
-- AI 동작 분석(ai)은 기존 vball_batch_config 를 그대로 사용한다.
create table if not exists public.sv_features (
  batch      text not null,
  feature    text not null check (feature in ('survey','videos')),
  enabled    boolean not null default false,
  ends       date,
  updated_at timestamptz not null default now(),
  primary key (batch, feature)
);

-- 희망 조사 (연수생 1명당 1행)
create table if not exists public.sv_survey (
  trainee_id bigint primary key,
  part       text,                    -- 리시브/수비/공격/세터(토스)
  memo       text,                    -- 집중 연습하고 싶은 점, 받고 싶은 피드백
  positions  text[] not null default '{}', -- 시스템훈련 희망 포지션 (9칸 코트)
  updated_at timestamptz not null default now()
);

-- 영상 자료실 (유튜브 일부공개 영상)
create table if not exists public.sv_videos (
  id         bigint generated always as identity primary key,
  video_id   text not null,
  title      text not null,
  date       date not null,
  category   text not null default '수업',
  batches    text[] not null default '{}', -- 비어 있으면 모든 기수에게 보임
  players    text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.sv_video_logs (
  id         bigint generated always as identity primary key,
  trainee_id bigint,
  name       text,
  video_id   text,
  at         timestamptz not null default now()
);
create index if not exists sv_video_logs_at on public.sv_video_logs (at desc);

-- 공지 등 설정값
create table if not exists public.sv_config (
  key   text primary key,
  value jsonb
);

-- 로그인 실패 잠금
create table if not exists public.sv_login_lock (
  key          text primary key,
  fails        int not null default 0,
  locked_until timestamptz
);

alter table public.sv_features   enable row level security;
alter table public.sv_survey     enable row level security;
alter table public.sv_videos     enable row level security;
alter table public.sv_video_logs enable row level security;
alter table public.sv_config     enable row level security;
alter table public.sv_login_lock enable row level security;

-- 기본값: 희망 조사는 1기·2기 모두 열림, 영상 자료실은 닫힘
insert into public.sv_features (batch, feature, enabled) values
  ('1기','survey',true), ('2기','survey',true), ('1기','videos',false), ('2기','videos',false)
on conflict do nothing;
insert into public.vball_batch_config (batch) values ('1기'), ('2기') on conflict do nothing;
insert into public.sv_config (key, value) values ('notice', '""'::jsonb) on conflict do nothing;
