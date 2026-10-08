// badge.js のテスト(仕様書 §9.8 (c)・画面設計書 §4.4)。偽の chrome.action と node:test の偽の時計で、色・文字・2 秒で消すこと・tooltip を戻すことを確かめる。
// 実行: github-repo-lens フォルダで `node --test tests/badge.test.js`
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const text = new Map(); // tabId → バッジの文字
const title = new Map(); // tabId → tooltip
const color = new Map();
let calls = 0;
// index.js で一緒に読まれるほかのテストの偽物を消さないよう、足すだけにする
globalThis.chrome = {
	...globalThis.chrome,
	action: {
		setBadgeBackgroundColor: async ({ tabId, color: c }) => void (calls++, color.set(tabId, c)),
		setBadgeText: async ({ tabId, text: t }) => void (calls++, text.set(tabId, t)),
		setTitle: async ({ tabId, title: t }) => void (calls++, title.set(tabId, t)),
	},
};
const { showResult, IDLE_TITLE } = await import("../badge.js");

test("§9.8 (c) の色と文字。2 秒後にバッジを消し tooltip を M-112 に戻す", async () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		await showResult(1, "ok", "コピーした(箇条)");
		await showResult(2, "partial", "コピーした。取れなかった項目: 最新リリース");
		await showResult(3, "error", "コピーしていない。リポジトリのページでない");
		assert.deepEqual([color.get(1), color.get(2), color.get(3)], ["#2e7d32", "#ef6c00", "#c62828"]);
		assert.deepEqual([text.get(1), text.get(2), text.get(3)], ["OK", "OK", "ERR"]);
		assert.equal(title.get(3), "コピーしていない。リポジトリのページでない");
		mock.timers.tick(1999);
		assert.equal(text.get(1), "OK");
		mock.timers.tick(1);
		for (const id of [1, 2, 3]) {
			assert.equal(text.get(id), "");
			assert.equal(title.get(id), "RepoLens");
		}
		assert.equal(IDLE_TITLE, "RepoLens");
	} finally {
		mock.timers.reset();
	}
});

test("1.5 秒あけて 2 回出すと、2 回目のバッジは 2 回目から 2 秒残る。ほかのタブのタイマーは取り消さない", async () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		await showResult(1, "ok", "a");
		await showResult(2, "ok", "b");
		mock.timers.tick(1500);
		await showResult(1, "error", "c");
		mock.timers.tick(600);
		assert.equal(text.get(1), "ERR", "1 回目のタイマーで 2 回目のバッジが消えた");
		assert.equal(title.get(1), "c");
		assert.equal(text.get(2), "");
		mock.timers.tick(1400);
		assert.equal(text.get(1), "");
	} finally {
		mock.timers.reset();
	}
});

test("tabId が無いときは何も出さない(全部のタブに効かないように)", async () => {
	calls = 0;
	await showResult(undefined, "error", "x");
	await showResult(-1, "error", "x");
	assert.equal(calls, 0);
});
