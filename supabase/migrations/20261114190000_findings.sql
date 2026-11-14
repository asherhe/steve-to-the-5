begin;

create table public.spherex_findings (
    id uuid primary key,
    comparison_id text not null check (char_length(comparison_id) between 1 and 256),
    ra double precision not null check (ra >= 0 and ra < 360),
    dec double precision not null check (dec between -90 and 90),
    title text not null check (char_length(btrim(title)) between 1 and 120),
    note text not null check (char_length(btrim(note)) between 1 and 2000),
    marks jsonb not null default '[]' check (
        jsonb_typeof(marks) = 'array' and jsonb_array_length(marks) <= 20
    ),
    author_id uuid references auth.users(id) on delete set null,
    author_display_name text not null check (char_length(author_display_name) between 1 and 80),
    created_at timestamptz not null default now(),
    hidden_at timestamptz
);

create table public.spherex_finding_replies (
    id uuid primary key default gen_random_uuid(),
    finding_id uuid not null references public.spherex_findings(id) on delete cascade,
    author_id uuid references auth.users(id) on delete set null,
    author_display_name text not null check (char_length(author_display_name) between 1 and 80),
    body text not null check (char_length(btrim(body)) between 1 and 2000),
    created_at timestamptz not null default now()
);

create index spherex_visible_findings_dec on public.spherex_findings (dec) where hidden_at is null;
create index spherex_replies_thread on public.spherex_finding_replies (finding_id, created_at desc, id desc);

alter table public.spherex_findings enable row level security;
alter table public.spherex_finding_replies enable row level security;

revoke all on public.spherex_findings, public.spherex_finding_replies from public, anon, authenticated, service_role;
grant select, insert, update on public.spherex_findings to service_role;
grant select, insert on public.spherex_finding_replies to service_role;

create function public.spherex_findings_viewport(
    p_ra double precision, p_dec double precision, p_radius double precision, p_zoom integer
) returns jsonb
language sql stable set search_path = ''
as $$
    with field as (
        select f.id, f.ra, f.dec, f.title, f.created_at,
            power(sin(radians(f.dec - p_dec) / 2), 2)
                + cos(radians(f.dec)) * cos(radians(p_dec))
                * power(sin(radians(f.ra - p_ra) / 2), 2) as distance
        from public.spherex_findings f
        where f.hidden_at is null and f.dec between p_dec - p_radius and p_dec + p_radius
    ),
    visible as (
        select * from field
        where distance <= power(sin(radians(p_radius) / 2), 2)
    ),
    pins as (
        select id, ra, dec, title, distance, created_at from visible
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
            select jsonb_agg(jsonb_build_object('id', id, 'ra', ra, 'dec', dec, 'title', title)
                order by distance, created_at desc, id) from pins
        ) else (
            select jsonb_agg(jsonb_build_object(
                'ra', center_ra - 360 * floor(center_ra / 360), 'dec', center_dec,
                'count', count, 'zoomTo', greatest(p_zoom + 2, 8)
            ) order by distance, ra_cell, dec_cell) from clusters
        ) end, '[]'::jsonb
    );
$$;

create function public.spherex_finding_thread(p_id uuid) returns jsonb
language sql stable set search_path = ''
as $$
    select jsonb_build_object(
        'id', f.id, 'comparisonId', f.comparison_id, 'ra', f.ra, 'dec', f.dec,
        'title', f.title, 'note', f.note, 'marks', f.marks,
        'authorDisplayName', f.author_display_name,
        'createdAtUtc', to_char(f.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'replies', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', r.id, 'authorDisplayName', r.author_display_name, 'text', r.body,
                    'createdAtUtc', to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                ) order by r.created_at, r.id
            )
            from (
                select id, author_display_name, body, created_at
                from public.spherex_finding_replies
                where finding_id = f.id
                order by created_at desc, id desc
                limit 200
            ) r
        ), '[]'::jsonb)
    )
    from public.spherex_findings f
    where f.id = p_id and f.hidden_at is null;
$$;

create function public.spherex_finding_reply(
    p_finding_id uuid, p_author_id uuid, p_author_display_name text, p_text text
) returns jsonb
language sql volatile set search_path = ''
as $$
    -- Serialize replies against a concurrent moderation update on the parent.
    with visible as (
        select id from public.spherex_findings
        where id = p_finding_id and hidden_at is null for share
    ), inserted as (
        insert into public.spherex_finding_replies (finding_id, author_id, author_display_name, body)
        select id, p_author_id, p_author_display_name, p_text from visible
        returning id, author_display_name, body, created_at
    )
    select jsonb_build_object(
        'id', id, 'authorDisplayName', author_display_name, 'text', body,
        'createdAtUtc', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) from inserted;
$$;

revoke all on function
    public.spherex_findings_viewport(double precision, double precision, double precision, integer),
    public.spherex_finding_thread(uuid),
    public.spherex_finding_reply(uuid, uuid, text, text)
from public, anon, authenticated;

grant execute on function
    public.spherex_findings_viewport(double precision, double precision, double precision, integer),
    public.spherex_finding_thread(uuid),
    public.spherex_finding_reply(uuid, uuid, text, text)
to service_role;

notify pgrst, 'reload schema';

commit;
