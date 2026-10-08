// popup-view.js の純関数(残り回数の文・20 件で切る・点検の行・事実の行・案内の枠)のテスト。DOM の部分は ext_check で見る。
import test from "node:test";
import assert from "node:assert/strict";
import { rateParts, cutList, checkRows, factRows, errorNote, checkLimitText, whyItems } from "../popup-view.js";

const hm = (ms) => `hm${ms}`;
const join = (parts) => parts.map((p) => p.t).join("");

test("残り回数の文は §3.3 の 4 つ", () => {
	assert.equal(join(rateParts({ state: "known", remaining: 48, resetMs: 1, guessed: false }, hm)), "残り 48 回");
	assert.equal(join(rateParts({ state: "known", remaining: 0, resetMs: 7, guessed: false }, hm)), "残り 0 回(hm7 に戻る)");
	assert.equal(join(rateParts({ state: "known", remaining: 0, resetMs: 7, guessed: true }, hm)), "残り 0 回(hm7 までに戻る)");
	assert.equal(join(rateParts({ state: "unknown" }, hm)), "残り 不明");
	assert.deepEqual(rateParts({ state: "known", remaining: 5, resetMs: 1 }, hm).filter((p) => p.num).map((p) => p.t), ["5"]);
});

test("20 件で切り、残りの数を返す", () => {
	const list = Array.from({ length: 23 }, (_, i) => `p${i}`);
	assert.deepEqual(cutList(list), { shown: list.slice(0, 20), rest: 3 });
	assert.deepEqual(cutList(["a"]), { shown: ["a"], rest: 0 });
	const why = whyItems({ result: "fail", reason: "外れたパス:", paths: list });
	assert.deepEqual(why.map((x) => x.t ?? x.paths.length), ["外れたパス:", 20, "ほか 3 件"]);
	const f = whyItems({ result: "fail", reason: "当てはまる所: 21 件", findings: Array.from({ length: 21 }, (_, i) => `f${i}`) });
	assert.equal(f.length, 1 + 20 + 1);
	assert.equal(f.at(-1).t, "ほか 1 件");
});

test("点検の行は C-1〜C-14 の 14 行。【ルール外】を分け、○・− の文は行の中、× ? だけ理由を持つ", () => {
	const rows = checkRows({
		"C-2": { result: "fail", reason: "大文字がある: X" },
		"C-4": { result: "pass", extra: "MIT" },
		"C-8": { result: "fail", reason: "許可していないアドレス 1 種類", emails: ["外れたアドレス: a***@x(author 1件)"], extra: "新しい100件を見た。全件は git log で" },
		"C-10": { result: "na", extra: "README が無い" },
		"C-11": { result: "pass" },
	});
	assert.deepEqual(rows.map((r) => r.id), ["C-1", "C-2", "C-3", "C-4", "C-5", "C-6", "C-7", "C-8", "C-9", "C-10", "C-11", "C-12", "C-13", "C-14"]);
	const by = Object.fromEntries(rows.map((r) => [r.id, r]));
	assert.equal(by["C-1"].result, "unknown"); // 無い結果を ○ にしない
	assert.deepEqual(by["C-2"].why, [{ t: "大文字がある: X" }]);
	assert.equal(by["C-4"].aside, "MIT");
	assert.equal(by["C-4"].why, null);
	assert.deepEqual(by["C-8"].why.map((x) => x.t), ["許可していないアドレス 1 種類", "外れたアドレス: a***@x(author 1件)", "新しい100件を見た。全件は git log で"]);
	assert.equal(by["C-10"].sub, "README が無い");
	assert.equal(by["C-11"].name, "説明文(About)がある");
	assert.equal(by["C-11"].outside, true);
});

test("事実の行は §9.3 (a) の順と定型。値の無い行は出さない", () => {
	const f = {
		fullName: "octo/tool", htmlUrl: "https://github.com/octo/tool", description: " ", stars: 1234, forks: 56, license: { spdx: "NOASSERTION" },
		language: null, topics: [], archived: true, fork: true, parent: "a/b", homepage: "javascript:alert(1)", defaultBranch: "main",
		lastCommit: { ok: true, iso: "2026-09-30T03:00:00Z" }, release: { ok: false, kind: "server" }, fetchedIso: "2026-10-08T10:30:00Z",
	};
	const rows = factRows(f, 540);
	assert.deepEqual(rows.map((r) => r.label), ["説明", "スター", "フォーク", "ライセンス", "最終コミット", "最新リリース", "状態", "ホームページ", "取得"]);
	const t = Object.fromEntries(rows.map((r) => [r.label, join(r.parts)]));
	assert.equal(t["説明"], "(説明なし)");
	assert.equal(t["ライセンス"], "不明(GitHub が判別できない)");
	assert.equal(t["最終コミット"], "2026-09-30(8日前・main)");
	assert.equal(t["最新リリース"], "(取れなかった)");
	assert.equal(t["状態"], "アーカイブ済み・フォーク(元: a/b)");
	assert.equal(t["ホームページ"], "(http・https の URL でないので出さない)");
	assert.equal(rows.find((r) => r.label === "ホームページ").href, undefined);
	assert.equal(t["取得"], "2026-10-08 19:30");
	const ok = factRows({ ...f, homepage: "https://example.com", lastCommit: { ok: true, none: true }, release: { ok: true, none: true } }, 540);
	assert.equal(ok.find((r) => r.label === "ホームページ").href, "https://example.com");
	assert.equal(join(ok.find((r) => r.label === "最終コミット").parts), "(コミットなし)");
	assert.equal(join(ok.find((r) => r.label === "最新リリース").parts), "なし");
});

test("案内の枠の文と種類(M-20・M-21・M-22・M-23)", () => {
	assert.deepEqual(errorNote({ error: "not-found" }, hm), { tone: "info", text: "非公開か、存在しないリポジトリ。RepoLens は公開リポジトリだけ扱う" });
	assert.deepEqual(errorNote({ error: "rate-limited", reset: 9 }, hm), { tone: "wait", text: "API の上限。hm9 以降にもう一度" });
	assert.deepEqual(errorNote({ error: "server", reason: "503" }, hm), { tone: "err", text: "GitHub に繋がらない(503)", retry: true });
	assert.deepEqual(errorNote({ error: "bad-json", reason: "応答を読めない" }, hm).text, "GitHub に繋がらない(応答を読めない)");
	assert.deepEqual(errorNote({ error: "forbidden", reason: "GitHub が断った(403)" }, hm).text, "GitHub が断った(403)");
	assert.equal(checkLimitText({ kind: "rate-limited", reset: 3 }, hm), "API の上限のため点検しない(hm3 以降)");
});
