begin;

-- point-check-v3: points are scored for a marked sky point. 10 for a known object, 20 for a
-- point no catalog lists that is bright in two surveys, 0 otherwise (still postable).
-- A point review needs no saved comparison, so comparison and field width become optional.
alter table public.spherex_candidate_reviews
    alter column comparison_id drop not null,
    alter column fov_arcmin drop not null,
    drop constraint spherex_candidate_reviews_score_check,
    add constraint spherex_candidate_reviews_score_check check (score between 0 and 50),
    add column object_key text check (object_key is null or length(object_key) = 64);
alter table public.spherex_findings
    alter column comparison_id drop not null,
    add column object_key text check (object_key is null or length(object_key) = 64);

-- One visible leaderboard entry per catalogued object, whoever submits it.
create unique index spherex_one_entry_per_object
    on public.spherex_findings(object_key) where object_key is not null and hidden_at is null;

create function public.spherex_angular_arcsec(ra1 double precision, dec1 double precision,
        ra2 double precision, dec2 double precision) returns double precision
language sql immutable set search_path = '' as $$
    select degrees(2 * asin(least(1, sqrt(
        power(sin(radians(dec2 - dec1) / 2), 2)
        + cos(radians(dec1)) * cos(radians(dec2)) * power(sin(radians(ra2 - ra1) / 2), 2))))) * 3600;
$$;

-- The visible leaderboard entry holding the same object, or the nearest within the radius.
create function public.spherex_point_entry_near(p_ra double precision, p_dec double precision,
        p_radius_arcsec double precision, p_object_key text) returns jsonb
language sql stable set search_path = '' as $$
    select jsonb_build_object('findingId', f.id, 'title', f.title, 'displayName', f.author_display_name,
            'separationArcsec', round(public.spherex_angular_arcsec(p_ra, p_dec, f.ra, f.dec)::numeric, 1),
            'sameObject', p_object_key is not null and f.object_key = p_object_key)
    from public.spherex_findings f
    where f.hidden_at is null and f.review_id is not null
        and ((p_object_key is not null and f.object_key = p_object_key)
             or (abs(f.dec - p_dec) <= p_radius_arcsec / 3600.0
                 and public.spherex_angular_arcsec(p_ra, p_dec, f.ra, f.dec) <= p_radius_arcsec))
    order by (p_object_key is not null and f.object_key = p_object_key) desc,
        public.spherex_angular_arcsec(p_ra, p_dec, f.ra, f.dec)
    limit 1;
$$;

-- Creates a point entry unless one already holds the object or a point within the radius.
-- The transaction lock serialises submissions, so two users cannot both pass the check.
create function public.spherex_submit_point_finding(p_id uuid, p_ra double precision,
        p_dec double precision, p_title text, p_note text, p_author_id uuid,
        p_author_display_name text, p_review_id uuid, p_object_key text, p_survey text,
        p_radius_arcsec double precision) returns jsonb
language plpgsql set search_path = '' as $$
declare
    existing jsonb;
    reviewed public.spherex_candidate_reviews;
begin
    perform pg_advisory_xact_lock(hashtext('spherex-leaderboard-points'));
    select * into reviewed from public.spherex_candidate_reviews
        where id = p_review_id and author_id = p_author_id;
    if reviewed.id is null or reviewed.report->>'scoreVersion' <> 'point-check-v3'
            or reviewed.ra <> p_ra or reviewed.dec <> p_dec then
        raise exception 'invalid point review' using errcode = '22023';
    end if;
    existing := public.spherex_point_entry_near(p_ra, p_dec, p_radius_arcsec, reviewed.object_key);
    if existing is not null then
        return jsonb_build_object('duplicate', existing);
    end if;
    insert into public.spherex_findings
        (id, comparison_id, survey, ra, dec, title, note, marks, author_id, author_display_name,
         review_id, candidate_key, object_key)
    values (p_id, null, p_survey, p_ra, p_dec, p_title, p_note, '[]', p_author_id,
            p_author_display_name, p_review_id, reviewed.candidate_key, reviewed.object_key);
    return jsonb_build_object('id', p_id);
end;
$$;

-- Rank only the current rules; older review versions are not comparable with them.
create or replace function public.spherex_review_leaderboard(p_board text) returns jsonb
language sql stable set search_path = '' as $$
    with entries as (
        select f.*, r.score, r.fov_arcmin, r.report,
            row_number() over (order by r.score desc, f.created_at, f.id) as rank
        from public.spherex_findings f join public.spherex_candidate_reviews r on r.id = f.review_id
        where f.hidden_at is null and r.report->>'scoreVersion' = 'point-check-v3'
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

revoke all on function public.spherex_review_leaderboard(text),
    public.spherex_point_entry_near(double precision, double precision, double precision, text),
    public.spherex_submit_point_finding(uuid, double precision, double precision, text, text, uuid, text, uuid, text, text, double precision),
    public.spherex_angular_arcsec(double precision, double precision, double precision, double precision)
    from public, anon, authenticated;
grant execute on function public.spherex_review_leaderboard(text),
    public.spherex_point_entry_near(double precision, double precision, double precision, text),
    public.spherex_submit_point_finding(uuid, double precision, double precision, text, text, uuid, text, uuid, text, text, double precision),
    public.spherex_angular_arcsec(double precision, double precision, double precision, double precision)
    to service_role;
notify pgrst, 'reload schema';
commit;
