const { readFileSync, readdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { PGlite } = require("../.venv/node_modules/@electric-sql/pglite");

const ownerId = "33333333-3333-4333-8333-333333333333";
const readerId = "44444444-4444-4444-8444-444444444444";

async function createDatabase() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      insert into auth.users values ('${ownerId}'), ('${readerId}');
    `);
    const directory = resolve(__dirname, "../../../supabase/migrations");
    for (const file of readdirSync(directory).filter((name) => /^\d+_findings.*\.sql$/.test(name)).sort()) {
      await db.exec(readFileSync(resolve(directory, file), "utf8"));
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

module.exports = { createDatabase, ownerId, readerId };
