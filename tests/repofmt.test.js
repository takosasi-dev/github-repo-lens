// repofmt.js(仕様書 §9.3)のテスト。V-1〜V-11・V-13 は仕様書 (h) の見本のまま(V-12 は lens.js の担当)。
import test from "node:test";
import assert from "node:assert/strict";
import { formatBullet, formatRow, ROW_HEADER, REPOLENS_FORMAT_VERSION } from "../repofmt.js";

const base = {
	fullName: "octo/tool",
	htmlUrl: "https://github.com/octo/tool",
	ownerLogin: "octo",
	description: "Obsidian 向けの CLI",
	stars: 1234,
	forks: 56,
	license: { spdx: "MIT" },
	language: "Python",
	topics: ["cli", "obsidian"],
	archived: false,
	fork: false,
	parent: null,
	homepage: "",
	defaultBranch: "main",
	pushedAt: "2026-09-30T03:00:00Z",
	lastCommit: { ok: true, iso: "2026-09-30T03:00:00Z" },
	release: { ok: true, tag: "v1.2.0", iso: "2026-09-01T00:00:00Z" },
	fetchedIso: "2026-10-08T10:30:00Z",
};
const v2 = { ...base, description: null, license: null, topics: [], language: null, release: { ok: true, none: true } };
const settings = { bullet: true };
const opt = { offsetMinutes: 540 };
const bullet = (over) => formatBullet({ ...base, ...over }, settings, opt);
const lines = (over) => bullet(over).split("\n");

const V1 = `- [octo/tool](https://github.com/octo/tool)
  - 説明: Obsidian 向けの CLI
  - スター: 1234 / フォーク: 56
  - ライセンス: MIT
  - 言語: Python
  - トピック: cli, obsidian
  - 最終コミット: 2026-09-30(8日前・main)
  - 最新リリース: v1.2.0(2026-09-01)
  - 取得: 2026-10-08 19:30(RepoLens)`;

const V2 = `- [octo/tool](https://github.com/octo/tool)
  - 説明: (説明なし)
  - スター: 1234 / フォーク: 56
  - ライセンス: なし
  - 最終コミット: 2026-09-30(8日前・main)
  - 最新リリース: なし
  - 取得: 2026-10-08 19:30(RepoLens)`;

test("版", () => assert.equal(REPOLENS_FORMAT_VERSION, 1));

test("V-1: 見本のまま。末尾に改行なし", () => assert.equal(bullet({}), V1));

test("V-2: 説明・ライセンス・トピック・言語が無く、Release が無い", () => assert.equal(formatBullet(v2, settings, opt), V2));

test("V-3: NOASSERTION", () => {
	assert.ok(lines({ license: { spdx: "NOASSERTION" } }).includes("  - ライセンス: 不明(GitHub が判別できない)"));
});

test("V-4: アーカイブ済み・フォークは最新リリースの次の行", () => {
	const l = lines({ archived: true, fork: true, parent: "orig/tool" });
	assert.equal(l[l.indexOf("  - 最新リリース: v1.2.0(2026-09-01)") + 1], "  - 状態: アーカイブ済み・フォーク(元: orig/tool)");
});

test("V-5: 説明の # | _ < > を逃がす", () => {
	assert.equal(lines({ description: "メモ #obsidian | 速い_版 <b>" })[1], "  - 説明: メモ \\#obsidian \\| 速い\\_版 \\<b\\>");
});

test("V-6: 説明の $ = [ ] を逃がす", () => {
	assert.equal(lines({ description: "$100 の ==強調== と [[リンク]]" })[1], "  - 説明: \\$100 の \\=\\=強調\\=\\= と \\[\\[リンク\\]\\]");
});

test("V-7: commits と releases の失敗", () => {
	const l = lines({ lastCommit: { ok: false, kind: "network" }, release: { ok: false, kind: "server" } });
	assert.ok(l.includes("  - 最終コミット: (取れなかった)"));
	assert.ok(l.includes("  - 最新リリース: (取れなかった)"));
});

test("V-8: http・https でないホームページは出さない", () => {
	const l = lines({ homepage: "javascript:alert(1)" });
	assert.equal(l[l.length - 2], "  - ホームページ: (http・https の URL でないので出さない)");
});

test("V-9: ホームページは取得の行の前", () => {
	const l = lines({ homepage: " https://octo.dev/tool " });
	assert.equal(l[l.length - 2], "  - ホームページ: https://octo.dev/tool");
});

test("V-10: 表の行・見出しあり", () => {
	const want = `| リポジトリ | スター | ライセンス | 最終コミット | 最新リリース | 状態 | 説明 | 取得 |
|---|---:|---|---|---|---|---|---|
| [octo/tool](https://github.com/octo/tool) | 1234 | MIT | 2026-09-30 | v1.2.0(2026-09-01) | - | Obsidian 向けの CLI | 2026-10-08(RepoLens) |`;
	assert.equal(formatRow(base, settings, opt, { header: true }), want);
	assert.equal(formatRow(base, settings, opt, { header: true }).split("\n").slice(0, 2).join("\n"), ROW_HEADER);
});

test("V-11: V-2 の facts で表の行・見出しなし", () => {
	assert.equal(
		formatRow(v2, settings, opt, { header: false }),
		"| [octo/tool](https://github.com/octo/tool) | 1234 | なし | 2026-09-30 | なし | - | (説明なし) | 2026-10-08(RepoLens) |",
	);
});

test("V-13: commits が 409 は(コミットなし)", () => {
	assert.ok(lines({ lastCommit: { ok: true, none: true } }).includes("  - 最終コミット: (コミットなし)"));
	assert.match(formatRow({ ...base, lastCommit: { ok: true, none: true } }, settings, opt, {}), /\| \(コミットなし\) \|/);
});

test("bullet が false なら 1 行目の「- 」だけ外す。表の行の状態と説明の縦棒", () => {
	assert.equal(formatBullet(base, { bullet: false }, opt).split("\n")[0], "[octo/tool](https://github.com/octo/tool)");
	const row = formatRow({ ...base, archived: true, description: "a|b" }, settings, opt, {});
	assert.match(row, /\| アーカイブ済み \| a\\\|b \|/);
});

test("言語・トピック・タグ・フォーク元も逃がす。0 日前", () => {
	const l = lines({
		language: "C#",
		topics: ["a_b", "c"],
		release: { ok: true, tag: "v1_0", iso: "2026-09-01T00:00:00Z" },
		fork: true,
		parent: "x/y_z",
		lastCommit: { ok: true, iso: "2026-10-08T10:00:00Z" },
	});
	assert.ok(l.includes("  - 言語: C\\#"));
	assert.ok(l.includes("  - トピック: a\\_b, c"));
	assert.ok(l.includes("  - 最新リリース: v1\\_0(2026-09-01)"));
	assert.ok(l.includes("  - 状態: フォーク(元: x/y\\_z)"));
	assert.ok(l.includes("  - 最終コミット: 2026-10-08(0日前・main)"));
});
