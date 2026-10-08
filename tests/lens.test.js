// lens.js のテスト(仕様書 §9.2 (b)・(d)・(e)、AC-8・AC-9、V-12、AV-3・AV-4、INV-5)。偽の fetchImpl・session で回数を数える。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApi } from "../api.js";
import { loadRepo, runCheckup, buildCopy } from "../lens.js";
import { DEFAULTS } from "../settings.js";

const NOW = Date.parse("2026-10-08T10:30:00Z");
const NOW_SEC = NOW / 1000;
const nowIso = new Date(NOW).toISOString();
const SETTINGS = { ...structuredClone(DEFAULTS), ownerLogin: "me" };
const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/; // AC-16・AC-17
const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/api/${name}.json`, import.meta.url), "utf8"));

function fakeSession(init = {}) {
	const map = new Map(Object.entries(init));
	return {
		map,
		get: async (k) => structuredClone(map.get(k)),
		set: async (o) => { for (const [k, v] of Object.entries(o)) map.set(k, structuredClone(v)); },
		remove: async (k) => { map.delete(k); },
	};
}

const ok = (body, extra = {}) => ({ status: 200, body, ...extra });

// overrides: [[RegExp, reply], …] を先に当てる。残りは docs.github.com の形の fixtures
function defaultRoute(path) {
	if (/^\/repos\/octo\/tool$/.test(path)) return ok(fx("repo-other"));
	if (/^\/repos\/me\/disk-sift$/.test(path)) return ok(fx("repo-own"));
	if (/\/commits\?/.test(path)) return ok(fx("commits"));
	if (/\/releases\/latest$/.test(path)) return ok(fx("release-latest"));
	if (/\/git\/trees\//.test(path)) return ok(fx("tree"));
	if (/\/readme$/.test(path)) return ok(fx("readme"));
	if (/\/contents\//.test(path)) return ok(fx("contents-workflow"));
	if (/^\/users\/me$/.test(path)) return ok(fx("user"));
	if (/^\/users\/me\/repos\?/.test(path)) return ok(fx("user-repos"));
	return { status: 404, body: fx("not-found") };
}

// 残りはヘッダで 1 回ごとに 1 減る(start から)
function world({ overrides = [], start = 50, session = fakeSession(), now = NOW } = {}) {
	const calls = [];
	let rem = start;
	const fetchImpl = async (url) => {
		const path = url.slice("https://api.github.com".length);
		calls.push(path);
		const hit = overrides.find(([re]) => re.test(path));
		const r = typeof hit?.[1] === "function" ? hit[1](path) : hit?.[1] ?? defaultRoute(path);
		rem = Math.max(0, rem - 1);
		const headers = { "x-ratelimit-remaining": String(r.remaining ?? rem), "x-ratelimit-reset": String(NOW_SEC + 600), ...(r.headers ?? {}) };
		return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status, headers });
	};
	const api = createApi({ fetchImpl, now: () => now, session });
	return { api, session, calls };
}

const manyRepos = (n) => Array.from({ length: n }, (_, i) => ({
	...fx("user-repos")[0],
	name: `r${i}`, full_name: `me/r${i}`, html_url: `https://github.com/me/r${i}`,
	pushed_at: new Date(NOW - i * 3600000).toISOString(),
}));

const repoArgs = (w, extra = {}) => ({ owner: "octo", repo: "tool", settings: SETTINGS, api: w.api, session: w.session, nowIso, ...extra });
const ownArgs = (w, extra = {}) => repoArgs(w, { owner: "me", repo: "disk-sift", ...extra });

test("P-8: popup(他人)は 3 回。commits は per_page=1。own false・checks null", async () => {
	const w = world();
	const r = await loadRepo(repoArgs(w));
	assert.equal(w.calls.length, 3);
	assert.equal(w.calls[0], "/repos/octo/tool");
	assert.ok(w.calls.includes("/repos/octo/tool/commits?sha=main&per_page=1"));
	assert.ok(w.calls.includes("/repos/octo/tool/releases/latest"));
	assert.equal(r.ok, true);
	assert.equal(r.own, false);
	assert.equal(r.fromCache, false);
	assert.equal(r.checks, null);
	assert.equal(r.checkStage, null);
	assert.deepEqual(r.facts.lastCommit, { ok: true, iso: "2026-09-30T03:00:00Z" });
	assert.deepEqual(r.facts.release, { ok: true, tag: "v1.2.0", iso: "2026-09-01T00:00:00Z" });
	assert.deepEqual(r.facts.license, { spdx: "MIT" });
	assert.equal(r.facts.ownerLogin, "octo");
	assert.equal(r.facts.fetchedIso, nowIso);
	assert.ok(w.session.map.has("cache:repo:octo/tool"));
});

test("P-8: popup(自分)は 6 回+ワークフローの本数。users の写しがあれば 5 回+本数", async () => {
	const w = world();
	const r = await loadRepo(ownArgs(w));
	assert.equal(w.calls.length, 6 + 1);
	assert.ok(w.calls.includes("/repos/me/disk-sift/commits?sha=main&per_page=100"));
	assert.ok(w.calls.includes("/repos/me/disk-sift/git/trees/main?recursive=1"));
	assert.ok(w.calls.includes("/repos/me/disk-sift/readme"));
	assert.ok(w.calls.includes("/users/me"));
	assert.ok(w.calls.includes("/repos/me/disk-sift/contents/.github/workflows/ci.yml?ref=main"));
	assert.equal(r.own, true);
	assert.equal(r.checkStage, "done");
	for (const id of ["C-1", "C-3", "C-8", "C-9", "C-10", "C-13", "C-14"]) assert.ok(r.checks[id], id);
	assert.equal(r.checks["C-8"].result, "pass");
	assert.equal(r.checks["C-9"].result, "pass"); // 日本語の README を読めている
	assert.deepEqual(w.session.map.get("cache:user:me"), { savedAt: NOW, id: 123 });

	const w2 = world({ session: fakeSession({ "cache:user:me": { savedAt: NOW - 3600000, id: 123 } }) });
	await loadRepo(ownArgs(w2));
	assert.equal(w2.calls.length, 5 + 1);
	assert.ok(!w2.calls.includes("/users/me"));
});

test("P-8: ショートカット(m1Only)は自分のリポジトリでも 3 回・per_page=1、写しを書かない", async () => {
	const w = world();
	const r = await loadRepo(ownArgs(w, { m1Only: true }));
	assert.equal(w.calls.length, 3);
	assert.ok(w.calls.includes("/repos/me/disk-sift/commits?sha=main&per_page=1"));
	assert.equal(r.ok, true);
	assert.equal(r.checks, null);
	assert.equal(r.checkStage, null);
	assert.ok(!w.session.map.has("cache:repo:me/disk-sift"));
});

test("§9.2 (e): 10 分の写し。fromCache・force・10 分を過ぎた写しは出さない", async () => {
	const session = fakeSession();
	const w = world({ session });
	await loadRepo(repoArgs(w));
	assert.equal(w.calls.length, 3);

	const later = world({ session, now: NOW + 300000 });
	const r = await loadRepo(repoArgs(later, { nowIso: new Date(NOW + 300000).toISOString() }));
	assert.equal(later.calls.length, 0);
	assert.equal(r.fromCache, true);
	assert.equal(r.savedAt, NOW);
	assert.equal(r.facts.fetchedIso, nowIso); // 写しの取得日時

	const forced = world({ session });
	const f = await loadRepo(repoArgs(forced, { force: true }));
	assert.equal(forced.calls.length, 3);
	assert.equal(f.fromCache, false);

	const old = world({ session: fakeSession({ "cache:repo:octo/tool": { savedAt: NOW - 600001, facts: { ownerLogin: "octo" }, checks: null } }) });
	const o = await loadRepo(repoArgs(old));
	assert.equal(old.calls.length, 3);
	assert.equal(o.fromCache, false);

	// 上限でも 10 分を過ぎた写しは出さない
	const stale = world({ session: fakeSession({
		rate: { remaining: 0, reset: NOW + 600000, seenAt: NOW, guessed: false },
		"cache:repo:octo/tool": { savedAt: NOW - 600001, facts: { ownerLogin: "octo" }, checks: null },
	}) });
	const s = await loadRepo(repoArgs(stale));
	assert.equal(s.ok, false);
	assert.equal(s.cache, null);
});

test("INV-5: 写しの checks にアドレスが無い。写しの C-8 の × は M-157", async () => {
	const commits = fx("commits");
	commits[1].commit.author.email = "Taro.Yamada@Gmail.com";
	const w = world({ overrides: [[/\/commits\?/, ok(commits)]] });
	const r = await loadRepo(ownArgs(w));
	assert.equal(r.checks["C-8"].result, "fail");
	assert.ok(r.checks["C-8"].emails.length > 0); // 点検した直後の画面には伏せ字が出る

	const cached = w.session.map.get("cache:repo:me/disk-sift");
	const json = JSON.stringify(cached.checks);
	assert.ok(!EMAIL_RX.test(json), json);
	assert.ok(!json.includes("***@"));
	assert.ok(!/taro|yamada/i.test(json));
	assert.equal(cached.checks["C-8"].emails, undefined);

	const again = world({ session: w.session });
	const c = await loadRepo(ownArgs(again));
	assert.equal(again.calls.length, 0);
	assert.equal(c.checkStage, "done");
	assert.equal(c.checks["C-8"].reason, "アドレスは写していない。「最新の値を取る」で見る");
});

test("2段目が上限: M1 は出し、checkStage が rate-limited", async () => {
	const w = world({ start: 5 }); // 1段目の後の残り 2、2段目は 3 回要る
	const r = await loadRepo(ownArgs(w));
	assert.equal(w.calls.length, 3);
	assert.equal(r.ok, true);
	assert.equal(r.own, true);
	assert.equal(r.checks, null);
	assert.deepEqual(r.checkStage, { kind: "rate-limited", reset: (NOW_SEC + 600) * 1000, guessed: false });
	assert.equal(r.facts.fullName, "me/disk-sift");
});

test("3段目が上限: workflows は rate-limited で、C-13・C-14 は ?", async () => {
	const w = world({ start: 6, session: fakeSession({ "cache:user:me": { savedAt: NOW, id: 123 } }) }); // 1段目 3・2段目 2 の後に残り 1、ワークフローは… 1 本は足りる
	const r = await loadRepo(ownArgs(w));
	assert.equal(r.checkStage, "done");
	assert.equal(w.calls.length, 6);

	const tree = fx("tree");
	tree.tree.push({ path: ".github/workflows/b.yml", mode: "100644", type: "blob", sha: "9".repeat(40) });
	const w2 = world({ start: 6, overrides: [[/\/git\/trees\//, ok(tree)]], session: fakeSession({ "cache:user:me": { savedAt: NOW, id: 123 } }) });
	const r2 = await loadRepo(ownArgs(w2));
	assert.equal(w2.calls.length, 5);
	assert.equal(r2.checks["C-13"].result, "unknown");
	assert.equal(r2.checks["C-14"].result, "unknown");
});

test("ワークフローが 6 本以上なら呼ばずに too-many", async () => {
	const tree = fx("tree");
	for (let i = 0; i < 5; i++) tree.tree.push({ path: `.github/workflows/w${i}.yaml`, mode: "100644", type: "blob", sha: String(i).repeat(40) });
	const w = world({ overrides: [[/\/git\/trees\//, ok(tree)]] });
	const r = await loadRepo(ownArgs(w));
	assert.equal(w.calls.length, 6);
	assert.equal(r.checks["C-13"].result, "unknown");
	assert.match(r.checks["C-13"].reason, /6 本/);
});

test("V-12: repo が 404 なら ok:false・not-found、写しも無い", async () => {
	const w = world({ overrides: [[/^\/repos\/octo\/tool$/, { status: 404, body: fx("not-found") }]] });
	const r = await loadRepo(repoArgs(w));
	assert.equal(w.calls.length, 1);
	assert.equal(r.ok, false);
	assert.equal(r.error, "not-found");
	assert.equal(r.cache, null);
});

test("AV-3: commits だけ 500 → 最終コミットは (取れなかった)、ほかは出てコピーもできる", async () => {
	const w = world({ overrides: [[/\/commits\?/, { status: 500, body: {} }]] });
	const r = await loadRepo(repoArgs(w));
	assert.equal(r.ok, true);
	assert.deepEqual(r.facts.lastCommit, { ok: false, kind: "server" });
	const text = await buildCopy(r.facts, "bullet", false, SETTINGS);
	assert.match(text, /最終コミット: \(取れなかった\)/);
	assert.match(text, /スター: 1234/);
	assert.match(text, /最新リリース: v1\.2\.0/);
	const row = await buildCopy(r.facts, "row", true, SETTINGS);
	assert.equal(row.split("\n").length, 3);
	assert.match(row.split("\n")[2], /^\| \[/);
});

test("409(空のリポジトリ)は (コミットなし)、releases の 404 は なし", async () => {
	const w = world({ overrides: [[/\/commits\?/, { status: 409, body: fx("empty-409") }], [/\/releases\/latest$/, { status: 404, body: fx("not-found") }]] });
	const r = await loadRepo(repoArgs(w));
	assert.deepEqual(r.facts.lastCommit, { ok: true, none: true });
	assert.deepEqual(r.facts.release, { ok: true, none: true });
});

test("AC-8: rate { remaining 2, reset 今+600 } で popup を要求すると 0 回・rate-limited", async () => {
	const w = world({ session: fakeSession({ rate: { remaining: 2, reset: NOW + 600000, seenAt: NOW, guessed: false } }) });
	const r = await loadRepo(repoArgs(w));
	assert.equal(w.calls.length, 0);
	assert.equal(r.ok, false);
	assert.equal(r.error, "rate-limited");
	assert.equal(r.reset, NOW + 600000);
	assert.equal(r.guessed, false);
	assert.equal(r.cache, null);
});

test("AC-9: 403・残り 0 の後、同じ操作で呼ばない。写しがあれば上限の画面に出す", async () => {
	const session = fakeSession();
	await loadRepo(repoArgs(world({ session })));
	const limited = { status: 403, body: fx("rate-limited-403"), remaining: 0 };
	const w = world({ session, overrides: [[/./, limited]] });
	const r = await loadRepo(repoArgs(w, { force: true }));
	assert.equal(w.calls.length, 1);
	assert.equal(r.error, "rate-limited");
	assert.equal(r.reset, (NOW_SEC + 600) * 1000);
	assert.equal(r.cache.fromCache, true); // SC-01-S8
	assert.equal(r.cache.facts.fullName, "octo/tool");
	const again = await loadRepo(repoArgs(w, { force: true }));
	assert.equal(w.calls.length, 1);
	assert.equal(again.error, "rate-limited");
});

test("P-8: 一覧は 1 + (0か1) + 2N + ワークフロー。フォークを除き pushed_at の新しい順", async () => {
	const w = world();
	const progress = [];
	const r = await runCheckup({ settings: SETTINGS, api: w.api, session: w.session, nowIso, prev: null, onProgress: (p) => progress.push(p) });
	const n = 3; // disk-sift・ScoreSmith・timer-board(アーカイブ済みは含める、フォークは除く)
	assert.equal(r.ok, true);
	assert.equal(r.n, n);
	assert.equal(r.k, n);
	assert.equal(w.calls.length, 1 + 1 + 2 * n + n);
	assert.deepEqual(r.checkup.rows.map((x) => x.fullName), ["me/disk-sift", "me/ScoreSmith", "me/timer-board"]);
	assert.equal(r.checkup.login, "me");
	assert.equal(r.checkup.checkedAt, nowIso);
	assert.equal(r.hasMore, false);
	const last = progress.at(-1);
	assert.deepEqual([last.done, last.total, last.current], [n, n, null]);
	assert.equal(progress.filter((p) => p.finished).length, n); // 終わった行ごとに結果を渡す(CK-16)
	assert.ok(progress.filter((p) => p.finished).every((p) => p.results?.["C-1"]));
	for (const row of r.checkup.rows) {
		assert.equal(row.results["C-9"], undefined); // K-17
		assert.ok(row.results["C-13"]);
	}
	assert.ok(!w.session.map.has("lock:checkup"));

	const w2 = world({ session: fakeSession({ "cache:user:me": { savedAt: NOW, id: 123 } }) });
	await runCheckup({ settings: SETTINGS, api: w2.api, session: w2.session, nowIso, prev: null });
	assert.equal(w2.calls.length, 1 + 0 + 2 * n + n);
});

test("一覧: 保存する形にアドレスが無い(C-8 は M-150)。liveRows には伏せ字", async () => {
	const commits = fx("commits");
	commits[0].commit.author.email = "Taro.Yamada@Gmail.com";
	const w = world({ overrides: [[/\/commits\?/, ok(commits, { headers: { link: '<https://api.github.com/x?page=2>; rel="next"' } })]] });
	const r = await runCheckup({ settings: SETTINGS, api: w.api, session: w.session, nowIso, prev: null });
	const json = JSON.stringify(r.checkup);
	assert.ok(!EMAIL_RX.test(json));
	assert.ok(!json.includes("***@"));
	assert.equal(r.checkup.rows[0].results["C-8"].reason, "許可していないアドレス 1 種類");
	assert.ok(r.liveRows["me/disk-sift"]["C-8"].emails.length > 0);
});

test("AV-4: 残り 9・userCached で planList(9,19,true)=4。4 件だけ新しく、残り 15 件は前回の行", async () => {
	const repos = manyRepos(19);
	const prevAt = "2026-10-01T00:00:00.000Z";
	const prev = { schemaVersion: 1, login: "me", checkedAt: prevAt, rows: repos.map((x) => ({ fullName: x.full_name, htmlUrl: x.html_url, pushedAt: x.pushed_at, archived: false, fork: false, checkedAt: prevAt, results: { "C-1": { result: "pass" } } })) };
	const treeNoWf = fx("tree");
	treeNoWf.tree = treeNoWf.tree.filter((e) => !e.path.startsWith(".github"));
	const w = world({
		start: 10, // 一覧の応答の残りが 9
		overrides: [[/\/git\/trees\//, ok(treeNoWf)], [/^\/users\/me\/repos\?/, ok(repos)]],
		session: fakeSession({ "cache:user:me": { savedAt: NOW, id: 123 } }),
	});
	const r = await runCheckup({ settings: SETTINGS, api: w.api, session: w.session, nowIso, prev });
	assert.equal(r.k, 4);
	assert.equal(r.n, 19);
	assert.equal(w.calls.length, 1 + 2 * 4);
	const fresh = r.checkup.rows.filter((x) => !x.stale);
	const stale = r.checkup.rows.filter((x) => x.stale);
	assert.deepEqual(fresh.map((x) => x.fullName), ["me/r0", "me/r1", "me/r2", "me/r3"]);
	assert.ok(fresh.every((x) => x.checkedAt === nowIso && x.results["C-2"]));
	assert.equal(stale.length, 15);
	assert.ok(stale.every((x) => x.checkedAt === prevAt && x.results["C-1"].result === "pass"));
	assert.deepEqual(Object.keys(r.liveRows), ["me/r0", "me/r1", "me/r2", "me/r3"]);
});

test("一覧: 前回も無い行は results null(未点検)", async () => {
	const w = world({ start: 4, session: fakeSession({ "cache:user:me": { savedAt: NOW, id: 123 } }) }); // 一覧の後の残り 3 → k=1
	const r = await runCheckup({ settings: SETTINGS, api: w.api, session: w.session, nowIso, prev: null });
	assert.equal(r.k, 1);
	assert.deepEqual(r.checkup.rows.map((x) => x.results === null), [false, true, true]);
});

test("lock:checkup が 5 分以内なら locked で呼ばない。5 分を過ぎていれば進む", async () => {
	const w = world({ session: fakeSession({ "lock:checkup": { savedAt: NOW - 60000 } }) });
	const r = await runCheckup({ settings: SETTINGS, api: w.api, session: w.session, nowIso, prev: null });
	assert.deepEqual(r, { ok: false, error: "locked" });
	assert.equal(w.calls.length, 0);
	assert.ok(w.session.map.has("lock:checkup"));

	const w2 = world({ session: fakeSession({ "lock:checkup": { savedAt: NOW - 300001 } }) });
	assert.equal((await runCheckup({ settings: SETTINGS, api: w2.api, session: w2.session, nowIso, prev: null })).ok, true);
	assert.ok(!w2.session.map.has("lock:checkup"));
});

test("一覧: 上限・404 のとき error と reset。lock は消す", async () => {
	const w = world({ session: fakeSession({ rate: { remaining: 0, reset: NOW + 600000, seenAt: NOW, guessed: true } }) });
	const r = await runCheckup({ settings: SETTINGS, api: w.api, session: w.session, nowIso, prev: null });
	assert.deepEqual(r, { ok: false, error: "rate-limited", reason: "API の上限", reset: NOW + 600000, guessed: true });
	assert.equal(w.calls.length, 0);
	assert.ok(!w.session.map.has("lock:checkup"));

	const w2 = world({ overrides: [[/^\/users\/me\/repos\?/, { status: 404, body: fx("not-found") }]] });
	const r2 = await runCheckup({ settings: SETTINGS, api: w2.api, session: w2.session, nowIso, prev: null });
	assert.equal(r2.error, "not-found");
});

test("一覧: 101 件目以降があれば hasMore", async () => {
	const w = world({ overrides: [[/^\/users\/me\/repos\?/, ok(fx("user-repos"), { headers: { link: '<https://api.github.com/user/1/repos?page=2>; rel="next"' } })]] });
	const r = await runCheckup({ settings: SETTINGS, api: w.api, session: w.session, nowIso, prev: null });
	assert.equal(r.hasMore, true);
});

test("一覧: isAlive が false になったら残りを呼ばず closed", async () => {
	const w = world({ overrides: [[/^\/users\/me\/repos\?/, ok(manyRepos(19))]] });
	let alive = true;
	const r = await runCheckup({ settings: SETTINGS, api: w.api, session: w.session, nowIso, prev: null, isAlive: () => alive, onProgress: (p) => { if (p.done === 1) alive = false; } });
	assert.deepEqual(r, { ok: false, error: "closed" });
	assert.ok(w.calls.length < 1 + 1 + 2 * 19 + 19);
});
