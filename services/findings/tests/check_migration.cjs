const assert = require("node:assert/strict");
const { createDatabase, ownerId, readerId } = require("./database.cjs");

async function main() {
  const db = await createDatabase();
  const findingId = "11111111-1111-4111-8111-111111111111";
  async function value(query, params = []) {
    const { rows } = await db.query(query, params);
    return rows[0].result;
  }

  try {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from public.spherex_findings"), /permission denied/);
      for (const table of ["spherex_findings", "spherex_finding_replies", "spherex_candidate_reviews"]) {
        await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
        await assert.rejects(db.query(`insert into public.${table} (id) values (gen_random_uuid())`), /permission denied/);
        await assert.rejects(db.query(`update public.${table} set author_id = $1`, [ownerId]), /permission denied/);
      }
      await assert.rejects(db.query("select public.spherex_findings_viewport(0, 0, 2, 10)"), /permission denied/);
      await assert.rejects(db.query("select public.spherex_finding_thread($1)", [findingId]), /permission denied/);
      await assert.rejects(db.query("select public.spherex_review_leaderboard('allTime')"), /permission denied/);
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
    // Keep only the most recent 200 replies, deterministically ordered by time/id.
    await db.query(`
      insert into public.spherex_finding_replies
        (id, finding_id, author_id, author_display_name, body, created_at)
      select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
        $1, $2, 'Reader', n::text, '2099-01-01T00:00:00Z'::timestamptz
      from generate_series(1, 205) n
    `, [findingId, readerId]);
    const bounded = await thread();
    assert.equal(bounded.replies.length, 200);
    assert.equal(bounded.replies[0].text, "6");
    assert.equal(bounded.replies[199].text, "205");
    assert.equal(bounded.comparisonId, evidence.comparisonId);
    assert.deepEqual(bounded.marks, evidence.marks);
    await db.query("update public.spherex_findings set hidden_at = now() where id = $1", [findingId]);
    assert.equal(await thread(), null);
    assert.equal(await reply(), null);
    assert.equal((await viewport(10)).length, 1);
    assert.ok((await viewport(10)).every((pin) => pin.id !== findingId));

    // Reviews are immutable, anonymous reads are filtered through the public API,
    // duplicates cannot award another entry, and hidden findings leave the board.
    const reviewId = "66666666-6666-4666-8666-666666666666";
    const rankedId = "77777777-7777-4777-8777-777777777777";
    const report = {scoreVersion: "review-effort-v1", score: 50, reasons: ["+10: saved evidence"], catalogReview: {checks: []}};
    await db.query(`insert into public.spherex_candidate_reviews
      (id, author_id, comparison_id, survey, ra, dec, candidate_key, fov_arcmin, score, report)
      values ($1,$2,'saved-wise','wise',1,2,$3,6,50,$4::jsonb)`,
      [reviewId, ownerId, "a".repeat(64), JSON.stringify(report)]);
    await assert.rejects(db.query("update public.spherex_candidate_reviews set score=10 where id=$1", [reviewId]), /permission denied/);
    await db.query(`insert into public.spherex_findings
      (id, comparison_id, survey, ra, dec, title, note, author_id, author_display_name, review_id, candidate_key)
      values ($1,'saved-wise','wise',1,2,'Cold-object review','Please check',$2,'Observer',$3,$4)`,
      [rankedId, ownerId, reviewId, "a".repeat(64)]);
    const board = (period) => value("select public.spherex_review_leaderboard($1) as result", [period]);
    assert.equal((await board("daily"))[0].findingId, rankedId);
    assert.equal((await board("allTime"))[0].rarityScore, 50);
    assert.equal((await board("allTime"))[0].survey, "wise");
    assert.equal((await board("allTime"))[0].rank, 1);
    const rankedThread = await value("select public.spherex_finding_thread($1) as result", [rankedId]);
    assert.deepEqual(rankedThread.candidateReview, report);
    assert.equal(rankedThread.survey, "wise");
    assert.ok(!JSON.stringify(rankedThread).includes(ownerId));
    await assert.rejects(db.query(`insert into public.spherex_findings
      (id, comparison_id, ra, dec, title, note, author_id, author_display_name, candidate_key)
      values (gen_random_uuid(),'saved-wise',1,2,'Duplicate','Duplicate',$1,'Observer',$2)`,
      [ownerId, "a".repeat(64)]), /unique constraint/);
    await db.query("update public.spherex_findings set created_at=now()-interval '2 days' where id=$1", [rankedId]);
    assert.deepEqual(await board("daily"), []);
    assert.equal((await board("allTime")).length, 1);
    await db.query("update public.spherex_findings set hidden_at=now() where id=$1", [rankedId]);
    assert.deepEqual(await board("allTime"), []);
    assert.equal(await value("select public.spherex_finding_thread($1) as result", [rankedId]), null);
    const before = await value("select count(*)::int as result from public.spherex_finding_replies");
    assert.equal(await value("select public.spherex_finding_reply(gen_random_uuid(), $1, 'Reader', 'Missing') as result", [readerId]), null);
    assert.equal(await value("select count(*)::int as result from public.spherex_finding_replies"), before);

    for (const [ra, dec, title, note, marks] of [
      [-1, 0, "Title", "Note", []], [360, 0, "Title", "Note", []],
      [0, 91, "Title", "Note", []], [0, -91, "Title", "Note", []],
      [0, 0, "t".repeat(121), "Note", []], [0, 0, "Title", "n".repeat(2001), []],
      [0, 0, " ", "Note", []], [0, 0, "Title", "Note", Array(21).fill({})],
    ]) {
      await assert.rejects(db.query(`
        insert into public.spherex_findings
          (id, comparison_id, ra, dec, title, note, marks, author_id, author_display_name)
        values (gen_random_uuid(), 'comparison-1', $1, $2, $3, $4, $5::jsonb, $6, 'Reader')
      `, [ra, dec, title, note, JSON.stringify(marks), readerId]), /check constraint/);
    }

    const antipodalId = "55555555-5555-4555-8555-555555555555";
    await db.query(`
      insert into public.spherex_findings
        (id, comparison_id, ra, dec, title, note, author_display_name)
      values ($1, 'comparison-1', 180, 89.963, 'Antipode', 'Roundoff regression', 'Observer')
    `, [antipodalId]);
    const sky = await value("select public.spherex_findings_viewport(0, -89.963, 180, 10) as result");
    assert.ok(sky.some((pin) => pin.id === antipodalId), "full sky must include antipodal point");
    const pole = await value("select public.spherex_findings_viewport(0, 90, 0.1, 10) as result");
    assert.ok(pole.some((pin) => pin.id === antipodalId), "cone must work across pole longitudes");

    await db.query(`
      insert into public.spherex_findings
        (id, comparison_id, ra, dec, title, note, author_display_name)
      select gen_random_uuid(), 'comparison-1', x * 5.0, y * 5.0, 'Pin', 'Note', 'Observer'
      from generate_series(0, 71) x cross join generate_series(-17, 17) y
    `);
    for (const zoom of [2, 10]) {
      const items = await value("select public.spherex_findings_viewport(0, 0, 180, $1) as result", [zoom]);
      assert.equal(items.length, 100, `zoom ${zoom} must cap results`);
    }
    console.log("Migration passed: grants, limits, RA wrap/poles/antipodes, evidence references, replies and moderation.");
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
