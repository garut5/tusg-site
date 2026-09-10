// autopost 系の軽いユニットテスト
// node tests/autopost.test.mjs で実行

import { genreOfDate, GENRES, buildCaption, assertCaption } from "../functions/api/autopost/_content.js";

let passed = 0;
let failed = 0;

function ok(name, cond, extra = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`);
    failed++;
  }
}

function eq(name, a, b) {
  ok(name, a === b, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function throws(name, fn) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  ok(name, threw);
}

console.log("== GENRES ==");
eq("7 keys", Object.keys(GENRES).length, 7);
eq("MON label", GENRES.MON.label, "MEO");
eq("SUN key", GENRES.SUN.key, "tusg_way");

console.log("== genreOfDate ==");
// 2026-09-14 (Mon) JST → MEO
const mon = genreOfDate(new Date("2026-09-14T00:00:00+09:00"));
eq("Monday JST → MEO", mon.key, "meo");
// 2026-09-13 (Sun) JST → tusg_way
const sun = genreOfDate(new Date("2026-09-13T20:00:00+09:00"));
eq("Sunday JST → tusg_way", sun.key, "tusg_way");
// 2026-09-19 (Sat) JST → pitfalls
const sat = genreOfDate(new Date("2026-09-19T15:00:00+09:00"));
eq("Saturday JST → pitfalls", sat.key, "pitfalls");

console.log("== buildCaption ==");
const cap = buildCaption({
  title: "MEO の順位が上がる 3 つの基本",
  body: "本日のポイントはこちら。",
  genreKey: "meo",
});
ok("has title bracket", cap.includes("【MEO の順位が上がる"));
ok("has body", cap.includes("本日のポイント"));
ok("has CTA URL", cap.includes("https://tusg.site/hearing"));
ok("has base hashtag", cap.includes("#TUSG"));
ok("has genre hashtag", cap.includes("#MEO"));
assertCaption(cap);
ok("caption within limit", cap.length <= 2200);

console.log("== assertCaption ==");
throws("non-string throws", () => assertCaption(123));
throws("too-long throws", () => assertCaption("x".repeat(2201)));

console.log(`\n== ${passed} passed, ${failed} failed ==`);
process.exit(failed === 0 ? 0 : 1);
