begin;

-- Additive spectral bonuses. Saved v3 reports and scores remain immutable.
create or replace function public.spherex_submit_point_finding(p_id uuid, p_ra double precision,
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
    if reviewed.id is null or coalesce(reviewed.report->>'scoreVersion', '') not in ('point-check-v3', 'point-check-v4')
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

-- Preserve v3 base scores; v4 adds earned spectral bonuses without rewriting old reports.
create or replace function public.spherex_review_leaderboard(p_board text) returns jsonb
language sql stable set search_path = '' as $$
    with entries as (
        select f.*, r.score, r.fov_arcmin, r.report,
            row_number() over (order by r.score desc, f.created_at, f.id) as rank
        from public.spherex_findings f join public.spherex_candidate_reviews r on r.id = f.review_id
        where f.hidden_at is null and r.report->>'scoreVersion' in ('point-check-v3', 'point-check-v4')
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
