-- Map pins carry what the Community findings list shows: author, time, reply count, survey.
-- Clusters are unchanged. Hidden replies cannot exist (replies cascade with their finding),
-- so every stored reply is counted.
begin;

create or replace function public.spherex_findings_viewport(
    p_ra double precision, p_dec double precision, p_radius double precision, p_zoom integer
) returns jsonb
language sql stable set search_path = ''
as $$
    with field as (
        select f.id, f.ra, f.dec, f.title, f.created_at, f.author_display_name, f.survey,
            power(sin(radians(f.dec - p_dec) / 2), 2)
                + cos(radians(f.dec)) * cos(radians(p_dec))
                * power(sin(radians(f.ra - p_ra) / 2), 2) as distance
        from public.spherex_findings f
        where f.hidden_at is null and f.dec between p_dec - p_radius and p_dec + p_radius
    ),
    visible as (
        select * from field
        where least(1.0, greatest(0.0, distance)) <= power(sin(radians(p_radius) / 2), 2)
    ),
    pins as (
        select id, ra, dec, title, distance, created_at, author_display_name, survey from visible
        where p_zoom >= 8
        order by distance, created_at desc, id
        limit 100
    ),
    clusters as (
        select avg(p_ra + ra_offset) as center_ra, avg(dec) as center_dec, count(*) as count,
            min(distance) as distance, floor((ra_offset + 2.5) / 5) as ra_cell, floor(dec / 5) as dec_cell
        from (
            -- Group longitudes around the viewport center so 359 and 1 can be adjacent.
            select *, ra - p_ra - 360 * floor((ra - p_ra + 180) / 360) as ra_offset
            from visible where p_zoom < 8
        ) grouped
        group by floor((ra_offset + 2.5) / 5), floor(dec / 5)
        order by distance, ra_cell, dec_cell
        limit 100
    )
    select coalesce(
        case when p_zoom >= 8 then (
            select jsonb_agg(jsonb_build_object(
                'id', p.id, 'ra', p.ra, 'dec', p.dec, 'title', p.title,
                'authorDisplayName', p.author_display_name,
                'createdAtUtc', to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                'replyCount', (select count(*) from public.spherex_finding_replies r where r.finding_id = p.id),
                'survey', p.survey
            ) order by p.distance, p.created_at desc, p.id) from pins p
        ) else (
            select jsonb_agg(jsonb_build_object(
                -- A tiny negative center can round to 360 when wrapped.
                'ra', case when normalized_ra >= 360 then 0 else normalized_ra end,
                'dec', center_dec,
                'count', count, 'zoomTo', greatest(p_zoom + 2, 8)
            ) order by distance, ra_cell, dec_cell)
            from (
                select *, center_ra - 360 * floor(center_ra / 360) as normalized_ra
                from clusters
            ) wrapped
        ) end, '[]'::jsonb
    );
$$;

notify pgrst, 'reload schema';
commit;
