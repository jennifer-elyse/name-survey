create table if not exists public.survey_state (
  key text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
