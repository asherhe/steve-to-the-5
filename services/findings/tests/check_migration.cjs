const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { PGlite } = require("../.venv/node_modules/@electric-sql/pglite");

async function main() {
  const db = new PGlite();
  const findingId = "11111111-1111-4111-8111-111111111111";
  const ownerId = "33333333-3333-4333-8333-333333333333";
  const readerId = "44444444-4444-4444-8444-444444444444";
  async function value(query, params = []) {
    const { rows } = await db.query(query, params);
    return rows[0].result;
  }

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      insert into auth.users values ('${ownerId}'), ('${readerId}');
    `);
    await db.exec(readFileSync(
      resolve(__dirname, "../../../supabase/migrations/20261114190000_findings.sql"), "utf8"
    ));
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from public.spherex_findings"), /permission denied/);
      await assert.rejects(db.query("select public.spherex_finding_thread($1)", [findingId]), /permission denied/);
      await assert.rejects(
        db.query("select public.spherex_finding_reply($1, $2, 'Reader', 'Bypass')", [findingId, readerId]),
        /permission denied/
      );
    }
    await db.exec("set role service_role");
    await db.query(`
      insert into public.spherex_findings
        (id, comparison_id, ra, dec, title, note, marks, author_id, author_display_name)
      values ($1, 'comparison-1', 359.8, -0.25, 'Possible motion', 'Check the second frame',
        '[{"frameId":"frame-2","ra":359.8,"dec":-0.25}]', $2, 'Observer One')
    `, [findingId, ownerId]);
    const viewport = (zoom) => value("select public.spherex_findings_viewport(0.1, 0, 2, $1) as result", [zoom]);
    assert.equal((await viewport(10))[0].id, findingId);
    await db.query(`
      insert into public.spherex_findings
        (id, comparison_id, ra, dec, title, note, author_id, author_display_name)
      values (gen_random_uuid(), 'comparison-1', 0.3, -0.2, 'Nearby', 'Second pin', $1, 'Observer Two')
    `, [readerId]);
    assert.equal((await viewport(2))[0].count, 2);
    assert.deepEqual(await value("select public.spherex_findings_viewport(90, 0, 2, 10) as result"), []);
    const reply = () => value(
      "select public.spherex_finding_reply($1, $2, 'Observer Two', 'I see it too.') as result",
      [findingId, readerId]
    );
    assert.equal((await reply()).authorDisplayName, "Observer Two");
    const thread = () => value("select public.spherex_finding_thread($1) as result", [findingId]);
    const evidence = await thread();
    assert.equal(evidence.comparisonId, "comparison-1");
    assert.equal(evidence.marks[0].frameId, "frame-2");
    assert.equal(evidence.replies[0].text, "I see it too.");
    assert.ok(!JSON.stringify(evidence).includes(ownerId));
    assert.ok(!JSON.stringify(evidence).includes(readerId));
    await db.query("update public.spherex_findings set hidden_at = now() where id = $1", [findingId]);
    assert.equal(await thread(), null);
    assert.equal(await reply(), null);
    assert.equal((await viewport(10)).length, 1);
    assert.ok((await viewport(10)).every((pin) => pin.id !== findingId));
    console.log("Migration passed: access grants, viewport, replay references, replies and moderation.");
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
