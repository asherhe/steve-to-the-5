// Test-only JSON-lines bridge: actual migration SQL, simulated PostgREST transport.
const { createInterface } = require("node:readline");
const { createDatabase } = require("./database.cjs");

async function main() {
  const db = await createDatabase();
  await db.exec("set role service_role");
  console.log(JSON.stringify({ ready: true }));
  try {
    for await (const line of createInterface({ input: process.stdin })) {
      const { endpoint, payload: p, method = "POST" } = JSON.parse(line);
      try {
      let result;
      if (endpoint === "spherex_findings") {
        await db.query(`insert into public.spherex_findings
          (id, comparison_id, ra, dec, title, note, marks, author_id, author_display_name, survey, review_id, candidate_key)
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)`,
          [p.id, p.comparison_id, p.ra, p.dec, p.title, p.note, JSON.stringify(p.marks), p.author_id, p.author_display_name, p.survey ?? "spherex", p.review_id ?? null, p.candidate_key ?? null]);
        result = null;
      } else if (endpoint === "spherex_candidate_reviews" && method === "GET") {
        result = (await db.query("select * from public.spherex_candidate_reviews where id=$1 and author_id=$2", [p.id.replace(/^eq\./, ""), p.author_id.replace(/^eq\./, "")])).rows;
      } else if (endpoint === "spherex_candidate_reviews") {
        await db.query(`insert into public.spherex_candidate_reviews
          (id, author_id, comparison_id, survey, ra, dec, candidate_key, fov_arcmin, score, report)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [p.id, p.author_id, p.comparison_id, p.survey, p.ra, p.dec, p.candidate_key, p.fov_arcmin, p.score, JSON.stringify(p.report)]);
        result = null;
      } else if (endpoint === "rpc/spherex_review_leaderboard") {
        result = (await db.query("select public.spherex_review_leaderboard($1) as result", [p.p_board])).rows[0].result;
      } else if (endpoint === "rpc/spherex_finding_thread") {
        result = (await db.query("select public.spherex_finding_thread($1) as result", [p.p_id])).rows[0].result;
      } else if (endpoint === "rpc/spherex_finding_reply") {
        result = (await db.query("select public.spherex_finding_reply($1,$2,$3,$4) as result",
          [p.p_finding_id, p.p_author_id, p.p_author_display_name, p.p_text])).rows[0].result;
      } else if (endpoint === "rpc/spherex_findings_viewport") {
        result = (await db.query("select public.spherex_findings_viewport($1,$2,$3,$4) as result",
          [p.p_ra, p.p_dec, p.p_radius, p.p_zoom])).rows[0].result;
      } else if (endpoint === "hide") {
        await db.query("update public.spherex_findings set hidden_at=now() where id=$1", [p.id]);
        result = null;
      } else {
        throw new Error("Unknown test command");
      }
      console.log(JSON.stringify({ result }));
      } catch (error) { console.log(JSON.stringify({ error: { code: error.code, message: error.message } })); }
    }
  } finally {
    await db.close();
  }
}
main().catch(() => { console.error("Test database bridge failed."); process.exitCode = 1; });
