begin;

create table public.spherex_candidate_reviews (
    id uuid primary key,
    author_id uuid references auth.users(id) on delete set null,
    comparison_id text not null,
    survey text not null check (survey in ('spherex', 'wise')),
    ra double precision not null check (ra >= 0 and ra < 360),
    dec double precision not null check (dec between -90 and 90),
    candidate_key text not null check (length(candidate_key) = 64),
    fov_arcmin double precision not null check (fov_arcmin > 0 and fov_arcmin <= 30),
    score integer not null check (score between 10 and 50),
    report jsonb not null check (jsonb_typeof(report) = 'object'),
    created_at timestamptz not null default now()
);
alter table public.spherex_candidate_reviews enable row level security;
revoke all on public.spherex_candidate_reviews from public, anon, authenticated, service_role;
grant select, insert on public.spherex_candidate_reviews to service_role;

alter table public.spherex_findings
    add column survey text not null default 'spherex' check (survey in ('spherex', 'wise')),
    add column review_id uuid unique references public.spherex_candidate_reviews(id),
    add column candidate_key text;
create unique index spherex_one_candidate_per_author
    on public.spherex_findings(author_id, candidate_key) where candidate_key is not null;

-- Keep the existing thread/reply ordering and moderation behavior.
alter function public.spherex_finding_thread(uuid) rename to spherex_finding_thread_base;
create function public.spherex_finding_thread(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
    select public.spherex_finding_thread_base(p_id) || jsonb_build_object(
        'survey', f.survey, 'candidateReview', r.report)
    from public.spherex_findings f
    left join public.spherex_candidate_reviews r on r.id = f.review_id
    where f.id = p_id and f.hidden_at is null;
$$;

create function public.spherex_review_leaderboard(p_board text) returns jsonb
language sql stable set search_path = '' as $$
    with entries as (
        select f.*, r.score, r.fov_arcmin, r.report,
            row_number() over (order by r.score desc, f.created_at, f.id) as rank
        from public.spherex_findings f join public.spherex_candidate_reviews r on r.id = f.review_id
        where f.hidden_at is null and r.report->>'scoreVersion' = 'review-effort-v1'
            and (p_board = 'allTime' or (p_board = 'daily' and
                f.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'))
        order by r.score desc, f.created_at, f.id limit 100
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'findingId', id, 'comparisonId', comparison_id, 'survey', survey,
        'rank', rank, 'displayName', author_display_name, 'title', title,
        'rarityScore', score, 'tier', null, 'reasons', report->'reasons',
        'ra', ra, 'dec', dec, 'fovArcmin', fov_arcmin,
        'enteredAtUtc', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) order by rank), '[]'::jsonb) from entries;
$$;

revoke all on function public.spherex_finding_thread(uuid), public.spherex_review_leaderboard(text)
    from public, anon, authenticated;
grant execute on function public.spherex_finding_thread(uuid), public.spherex_review_leaderboard(text) to service_role;
notify pgrst, 'reload schema';
commit;
