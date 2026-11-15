import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { namedTargets, normalizeName, localTarget, targetSuggestions, nameIssue, partialNameIssue, validIdentity } from "./targetNames.ts";
import { createViewerDataSource } from "./production.ts";
const vectors=JSON.parse(await readFile(new URL("../../../fixtures/catalogs/name-vectors.json",import.meta.url),"utf8"));
for(const vector of vectors) test(`shared naming vector: ${vector.query}`,()=>{
 assert.equal(normalizeName(vector.query),vector.normalized);
 assert.equal(localTarget(vector.query)?.identity.objectId??null,vector.target);
});
test("five names, one common name, no invented Gaia links or inherited components",()=>{
 assert.equal(namedTargets.length,5);
 assert.equal(namedTargets.filter(t=>t.identity.commonName).length,1);
 assert.deepEqual(namedTargets.filter(t=>t.identity.catalogIds.some(id=>id.catalog==="Gaia")).map(t=>t.identity.objectId),["barnards-star","r-draconis"]);
 for(const name of ["epsilon indi","epsilon indi b","ε Indi b"]) assert.equal(nameIssue(name)?.code,"ambiguous_name");
 for(const name of ["RW Aur A","Epsilon Indi A","Epsilon Indi Ba","WISE 0855-071"]) assert.equal(localTarget(name),null);
 for(const target of namedTargets) assert.ok(validIdentity(target.identity));
});
test("partial filtering ranks exact aliases and never returns arbitrary catalog stars",()=>{
 assert.equal(targetSuggestions("hip879")[0].target.identity.objectId,"barnards-star");
 assert.equal(targetSuggestions("0855")[0].target.identity.objectId,"wise-0855");
 assert.equal(targetSuggestions("aur")[0].target.identity.objectId,"rw-aurigae");
 assert.equal(targetSuggestions("drac")[0].target.identity.objectId,"r-draconis");
 assert.equal(targetSuggestions("epsilon indi")[0].target.identity.objectId,"epsilon-indi-b");
 assert.deepEqual(targetSuggestions("r"),[]);
 assert.deepEqual(targetSuggestions("definitely unknown"),[]);
});
test("offline references are returned as copies; aborted bundled requests stay canceled",async()=>{
 const source=createViewerDataSource(()=>{throw new Error("No network allowed")});
 const first=await source.resolveName("GJ 699");first.identity.displayName="Changed locally";
 assert.equal((await source.resolveName("GJ 699")).identity.displayName,"Barnard’s Star");
 await assert.rejects(source.resolveName("GJ 699",AbortSignal.abort()),{name:"AbortError"});
});

test("malformed nested identity and epoch metadata fail without breaking rendering",async()=>{
 for(const update of [
  value=>{value.provenance[0].retrievedAtUtc=3},
  value=>{value.provenance=[null]},
  value=>{value.catalogIds=[null]},
 ]) {
  const identity=structuredClone(namedTargets[0].identity);update(identity);
  assert.equal(validIdentity(identity),false);
  await assert.rejects(createViewerDataSource(async()=>Response.json({name:"external",ra:1,dec:2,identity})).resolveName("external"),error=>error.code==="invalid_response");
 }
 await assert.rejects(createViewerDataSource(async()=>Response.json({name:"external",ra:1,dec:2,positionProvenance:{source:"catalog",role:"reference",refEpochJulianYear:"2000"}})).resolveName("external"),error=>error.code==="invalid_response");
});


test("direct partial queries ask for selection locally without resolver traffic",async()=>{
 const source=createViewerDataSource(()=>{throw new Error("No upstream request allowed")});
 for(const query of ["barnard","HIP879","0855","aur","drac"]) {
  assert.equal(partialNameIssue(query).code,"incomplete_name");
  await assert.rejects(source.resolveName(query),error=>error.code==="incomplete_name"&&error.message.includes("Choose a matching target"));
 }
 assert.equal(partialNameIssue("R Dra"),null);
 assert.equal((await source.resolveName("Gaia DR3 1648328016354496384")).identity.displayName,"R Draconis");
 assert.equal(localTarget("Epsilon Indi Ba"),null); // source label is not a sixth preset
});
