-- 공지사항(오늘의 프로그램), 배구일기, 연수 후기
alter table public.sv_features drop constraint if exists sv_features_feature_check;
alter table public.sv_features add constraint sv_features_feature_check check (feature in ('survey','videos','diary','review'));

create table if not exists public.sv_notices (
  id bigint generated always as identity primary key,
  kind text not null default 'notice' check (kind in ('notice','program')), -- 공지 / 오늘의 연수 프로그램
  title text not null,
  body text not null default '',
  date date,                                  -- 프로그램 날짜 (그날 홈 화면 맨 위에 표시)
  batches text[] not null default '{}',       -- 비어 있으면 모든 기수
  pinned boolean not null default false,
  author text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.sv_notice_reads (
  notice_id bigint not null references public.sv_notices(id) on delete cascade,
  trainee_id bigint not null,
  at timestamptz not null default now(),
  primary key (notice_id, trainee_id)
);
create table if not exists public.sv_diary (
  id bigint generated always as identity primary key,
  trainee_id bigint not null,
  date date not null,
  content text not null default '',
  attack int check (attack between 1 and 10),   -- 공격 자기 점수
  defense int check (defense between 1 and 10), -- 수비
  setting int check (setting between 1 and 10), -- 세트
  record_ids bigint[] not null default '{}',    -- 연결한 AI 성장 기록(vball_records.id)
  ai_feedback text,                             -- JSON {cheer, feedback[], tomorrow}
  ai_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trainee_id, date)
);
create table if not exists public.sv_reviews (
  trainee_id bigint primary key,
  rating int check (rating between 1 and 5),
  content text not null default '',
  best text,                                    -- 가장 좋았던 점 한 줄
  name_mode text not null default 'initial' check (name_mode in ('name','initial','anon')),
  consent boolean not null default false,       -- 홍보 활용 동의
  picked boolean not null default false,        -- 강사가 홍보용으로 고름
  updated_at timestamptz not null default now()
);
alter table public.sv_notices enable row level security;
alter table public.sv_notice_reads enable row level security;
alter table public.sv_diary enable row level security;
alter table public.sv_reviews enable row level security;
insert into public.sv_features (batch, feature, enabled) values
  ('1기','diary',true), ('2기','diary',true), ('1기','review',false), ('2기','review',false)
on conflict do nothing;
