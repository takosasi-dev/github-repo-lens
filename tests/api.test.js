// api.js のテスト(仕様書 §9.2 (a)・(c)、AC-8・AC-9・AC-24、AV-1)。偽の fetchImpl・now・session を渡す。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApi, planList, rateView, decodeBase64Utf8 } from "../api.js";

const NOW = Date.parse("2026-10-08T10:30:00Z");
const NOW_SEC = NOW / 1000;
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

// reply(url, init) → { status, body, headers }
function fakeFetch(reply) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url, init });
		const r = reply(url, init);
		const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
		return new Response(body, { status: r.status ?? 200, headers: r.headers ?? {} });
	};
	return { fetchImpl, calls };
}

const rateHeaders = (remaining, resetSec = NOW_SEC + 600) => ({
	"x-ratelimit-limit": "60", "x-ratelimit-remaining": String(remaining), "x-ratelimit-reset": String(resetSec),
});

test("getJson: URL・GET・credentials omit・Accept だけ・signal、ok の形と rate の写し", async () => {
	const session = fakeSession();
	const { fetchImpl, calls } = fakeFetch(() => ({
		body: fx("repo-other"),
		headers: { ...rateHeaders(57), link: '<https://api.github.com/x?page=2>; rel="next"' },
	}));
	const api = createApi({ fetchImpl, now: () => NOW, session });
	const r = await api.getJson("/repos/octo/tool");
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, "https://api.github.com/repos/octo/tool");
	assert.equal(calls[0].init.method, "GET");
	assert.equal(calls[0].init.credentials, "omit");
	assert.deepEqual(calls[0].init.headers, { Accept: "application/vnd.github+json" });
	assert.ok(calls[0].init.signal instanceof AbortSignal);
	assert.equal(r.ok, true);
	assert.equal(r.status, 200);
	assert.equal(r.data.full_name, "octo/tool");
	assert.match(r.link, /rel="next"/);
	assert.deepEqual(await api.rate(), { remaining: 57, reset: (NOW_SEC + 600) * 1000, seenAt: NOW, guessed: false });
});

test("getJson: kind と reason の分類", async () => {
	const cases = [
		[{ status: 404, body: fx("not-found") }, "not-found"],
		[{ status: 409, body: fx("empty-409") }, "empty"],
		[{ status: 403, body: { message: "Forbidden" }, headers: rateHeaders(30) }, "forbidden", "GitHub が断った(403)"],
		[{ status: 500, body: {} }, "server", "500"],
		[{ status: 502, body: "<html>" }, "server", "502"],
		[{ status: 200, body: "{not json" }, "bad-json", "応答を読めない"],
		[{ status: 429, body: {}, headers: rateHeaders(0) }, "rate-limited", "API の上限"],
	];
	for (const [reply, kind, reason] of cases) {
		const { fetchImpl } = fakeFetch(() => reply);
		const r = await createApi({ fetchImpl, now: () => NOW, session: fakeSession() }).getJson("/x");
		assert.equal(r.ok, false);
		assert.equal(r.kind, kind, `${reply.status} → ${kind}`);
		assert.equal(r.status, reply.status);
		if (reason) assert.equal(r.reason, reason);
	}
	const api = createApi({ fetchImpl: async () => { throw new TypeError("Failed"); }, now: () => NOW, session: fakeSession() });
	assert.deepEqual(await api.getJson("/x"), { ok: false, status: 0, kind: "network", reason: "通信の失敗" });
});

test("AC-9: 403・remaining 0・reset 今+600 で rate-limited、続けて見積もると呼ばない", async () => {
	const session = fakeSession();
	const { fetchImpl, calls } = fakeFetch(() => ({ status: 403, body: fx("rate-limited-403"), headers: rateHeaders(0) }));
	const api = createApi({ fetchImpl, now: () => NOW, session });
	const r = await api.getJson("/repos/octo/tool");
	assert.equal(r.kind, "rate-limited");
	assert.deepEqual(await api.estimate(3), { ok: false, kind: "rate-limited", reset: (NOW_SEC + 600) * 1000, guessed: false });
	assert.deepEqual(await api.estimate(1), { ok: false, kind: "rate-limited", reset: (NOW_SEC + 600) * 1000, guessed: false });
	assert.equal(calls.length, 1);
});

test("estimate: rate が無い・reset を過ぎた → 呼んでよい。足りる → ok。AC-8 の rate で 3 回は足りない", async () => {
	const api = (rate, now = NOW) => createApi({ fetchImpl: () => assert.fail("呼ばない"), now: () => now, session: fakeSession(rate ? { rate } : {}) });
	assert.deepEqual(await api(null).estimate(60), { ok: true });
	assert.deepEqual(await api({ remaining: 0, reset: NOW - 1, seenAt: NOW - 10 }).estimate(3), { ok: true });
	assert.deepEqual(await api({ remaining: 3, reset: NOW + 600000, seenAt: NOW }).estimate(3), { ok: true });
	const r = await api({ remaining: 2, reset: NOW + 600000, seenAt: NOW }).estimate(3);
	assert.equal(r.ok, false);
	assert.equal(r.kind, "rate-limited");
});

test("x-ratelimit-reset が読めない(CORS)→ seenAt + 3600 秒・guessed", async () => {
	const session = fakeSession();
	const { fetchImpl } = fakeFetch(() => ({ status: 403, body: {}, headers: { "x-ratelimit-remaining": "0" } }));
	const api = createApi({ fetchImpl, now: () => NOW, session });
	assert.equal((await api.getJson("/x")).kind, "rate-limited");
	assert.deepEqual(await api.rate(), { remaining: 0, reset: NOW + 3600000, seenAt: NOW, guessed: true });
	assert.deepEqual(await api.estimate(1), { ok: false, kind: "rate-limited", reset: NOW + 3600000, guessed: true });
});

test("残りのヘッダが無い応答は rate を書かない", async () => {
	const session = fakeSession({ rate: { remaining: 9, reset: NOW + 1000, seenAt: NOW, guessed: false } });
	const { fetchImpl } = fakeFetch(() => ({ body: {} }));
	await createApi({ fetchImpl, now: () => NOW, session }).getJson("/x");
	assert.equal(session.map.get("rate").remaining, 9);
});

test("AV-1: 10 秒で打ち切り、network・時間切れ(10秒)。自動で再試行しない", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let n = 0;
	const fetchImpl = (url, { signal }) => {
		n++;
		return new Promise((_, reject) => {
			signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
		});
	};
	const api = createApi({ fetchImpl, now: () => NOW, session: fakeSession() });
	const p = api.getJson("/repos/octo/tool");
	t.mock.timers.tick(9999);
	await Promise.resolve();
	t.mock.timers.tick(1);
	assert.deepEqual(await p, { ok: false, status: 0, kind: "network", reason: "時間切れ(10秒)" });
	assert.equal(n, 1);
});

test("AC-24: planList", () => {
	assert.equal(planList(5, 4, true), 2);
	assert.equal(planList(5, 4, false), 2);
	assert.equal(planList(60, 25, false), 25);
	assert.equal(planList(0, 3, true), 0);
	assert.equal(planList(9, 19, true), 4); // AV-4
	assert.equal(planList(0, 3, false), 0); // 0 未満にしない
});

test("rateView", () => {
	assert.deepEqual(rateView(null, NOW), { state: "unknown" });
	assert.deepEqual(rateView({ remaining: 5, reset: NOW, seenAt: NOW - 1 }, NOW), { state: "unknown" });
	assert.deepEqual(rateView({ remaining: 0, reset: NOW + 1, seenAt: NOW, guessed: true }, NOW),
		{ state: "known", remaining: 0, resetMs: NOW + 1, guessed: true });
});

test("decodeBase64Utf8: 改行入りの base64 の README を日本語のまま読む", () => {
	const text = decodeBase64Utf8(fx("readme").content);
	assert.match(text, /^# disk-sift\n/);
	assert.match(text, /## 概要\nディスクの中身をふるいにかける小さな道具。/);
	assert.ok(!text.includes("�"));
	// UTF-8 として読めないバイトは U+FFFD(C-9 の M-153 の材料)
	assert.equal(decodeBase64Utf8(Buffer.from([0x41, 0xff, 0x42]).toString("base64")), "A�B");
});
