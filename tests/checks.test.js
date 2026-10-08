// checks.js(仕様書 §9.4・INTERFACES.md §2.5・§4)のテスト。K-1〜K-17 は仕様書 (e) の見本、C-13・C-14 は INTERFACES.md §4 の決め方。
import test from "node:test";
import assert from "node:assert/strict";
import { runChecks, maskEmail, formatCheckupTable, CHECK_DEFS, CHECKS_VERSION } from "../checks.js";
import { auditWorkflow } from "../actions.js";

const settings = {
	ownerLogin: "me",
	extraAllowedEmails: [],
	binaryExts: ["exe", "dll", "msi", "pdb", "obj", "apk", "aab", "so", "dylib"],
	junkNames: ["build", ".vs", ".idea", "__pycache__", "node_modules", ".DS_Store", "Thumbs.db", "desktop.ini"],
	readmeHeadingKeywords: {
		概要: ["概要", "About", "Overview", "Description"],
		主な機能: ["機能", "Features"],
		動作環境: ["動作環境", "環境", "Requirements"],
		"ビルド・実行方法": ["ビルド", "実行", "使い方", "インストール", "Build", "Usage", "Install", "Getting Started"],
		ライセンス: ["ライセンス", "License"],
		開発状況: ["開発状況", "状況", "Status", "Roadmap"],
	},
};
const ME = "123+me@users.noreply.github.com";
const okCommits = (n = 3) => ({ ok: true, hasMore: false, list: Array.from({ length: n }, () => ({ authorEmail: ME, committerEmail: "noreply@github.com" })) });
const blobs = (...paths) => paths.map((path) => ({ path, type: "blob" }));
const FULL_README = "# tool\n## 概要\n## Features\n## 動作環境\n## 使い方\n## License\nMIT License\n## 開発状況\n";
const input = (over = {}) => ({
	name: "disk-sift",
	description: "ディスクを調べる",
	topics: ["cli"],
	license: { spdx: "MIT" },
	login: "me",
	userId: 123,
	tree: { ok: true, truncated: false, entries: blobs("README.md", "LICENSE", ".gitignore", "src/main.py") },
	commits: okCommits(),
	readme: { ok: true, text: FULL_README },
	...over,
});
const run = (over, scope = "popup") => runChecks(input(over), settings, { scope });
const results = (r, ids) => ids.map((id) => r[id].result);
const C3_7 = ["C-3", "C-4", "C-5", "C-6", "C-7"];

test("版と CHECK_DEFS の並び・見出し", () => {
	assert.equal(CHECKS_VERSION, 1);
	assert.deepEqual(CHECK_DEFS.map((d) => d.id), Array.from({ length: 14 }, (_, i) => `C-${i + 1}`));
	assert.deepEqual(CHECK_DEFS.filter((d) => d.scope === "popup").map((d) => d.id), ["C-9", "C-10"]);
	assert.deepEqual(CHECK_DEFS.filter((d) => d.outside).map((d) => d.id), ["C-11", "C-12", "C-13", "C-14"]);
	assert.equal(CHECK_DEFS[12].label, "Actions に危ない書き方が無い【ルール外】");
	assert.equal(CHECK_DEFS[13].head, "Actions守り");
});

test("K-1: そろったリポジトリは C-1〜C-7 が ○。C-4 の ○ に spdx", () => {
	const r = run({});
	assert.deepEqual(results(r, ["C-1", "C-2", ...C3_7]), Array(7).fill("pass"));
	assert.equal(r["C-4"].extra, "MIT");
	assert.equal(run({ license: null })["C-4"].extra, "なし");
});

test("K-2: MIDI&DAW は C-1 ×・C-2 ×", () => {
	const r = run({ name: "MIDI&DAW" });
	assert.deepEqual(r["C-1"], { result: "fail", reason: "半角英数とハイフン以外の文字: &" });
	assert.deepEqual(r["C-2"], { result: "fail", reason: "大文字がある: MIDI&DAW" });
});

test("K-3: ScoreSmith は C-1 ○・C-2 ×", () => {
	const r = run({ name: "ScoreSmith" });
	assert.equal(r["C-1"].result, "pass");
	assert.equal(r["C-2"].result, "fail");
});

test("K-4: build/ と build/app.exe", () => {
	const tree = { ok: true, truncated: false, entries: [...input().tree.entries, { path: "build", type: "tree" }, { path: "build/app.exe", type: "blob" }] };
	assert.deepEqual(run({ tree })["C-6"], { result: "fail", reason: "外れたパス:", paths: ["build/", "build/app.exe"] });
});

test("C-6: 拡張子と名前は大小を区別しない", () => {
	const tree = { ok: true, truncated: false, entries: blobs("README.md", "bin/App.EXE", "sub/thumbs.db", "src/build.py") };
	assert.deepEqual(run({ tree })["C-6"].paths, ["bin/App.EXE", "sub/thumbs.db"]);
});

test("K-5: .env.example だけなら C-7 ○", () => {
	assert.equal(run({ tree: { ok: true, truncated: false, entries: blobs(".env.example", "a/.env.sample", ".env.template") } })["C-7"].result, "pass");
});

test("K-6: config/.env と .env.local", () => {
	const r = run({ tree: { ok: true, truncated: false, entries: blobs("config/.env", ".env.local", ".env.example") } });
	assert.deepEqual(r["C-7"], { result: "fail", reason: "外れたパス:", paths: ["config/.env", ".env.local"] });
});

test("K-7: noreply の author と noreply@github.com の committer は C-8 ○", () => {
	assert.deepEqual(run({})["C-8"], { result: "pass" });
	const list = [{ authorEmail: "ME@users.noreply.github.com", committerEmail: "Me@Users.Noreply.GitHub.com" }];
	assert.equal(run({ commits: { ok: true, hasMore: false, list } })["C-8"].result, "pass");
});

test("K-8: 外れたアドレスは伏せ字だけ。元の文字は結果に残らない", () => {
	const commits = okCommits();
	commits.list[1].authorEmail = "Taro.Yamada@Gmail.com";
	const r = run({ commits });
	assert.equal(r["C-8"].result, "fail");
	assert.deepEqual(r["C-8"].emails, ["外れたアドレス: ta***@gmail.com(author 1件)"]);
	assert.equal(r["C-8"].reason, "許可していないアドレス 1 種類");
	const json = JSON.stringify(r);
	assert.ok(!/taro/i.test(json) && !/yamada/i.test(json));
});

test("C-8: アドレスごとに 1 行、author と committer の件数。100 件より多いと M-149", () => {
	const list = [
		{ authorEmail: "x@a.jp", committerEmail: "x@a.jp" },
		{ authorEmail: "X@A.jp", committerEmail: "y@b.jp" },
	];
	const r = run({ commits: { ok: true, hasMore: true, list } });
	assert.deepEqual(r["C-8"].emails, ["外れたアドレス: x***@a.jp(author 2件・committer 1件)", "外れたアドレス: y***@b.jp(committer 1件)"]);
	assert.equal(r["C-8"].extra, "新しい100件を見た。全件は git log で");
	assert.deepEqual(run({ commits: { ...okCommits(), hasMore: true } })["C-8"], { result: "pass", extra: "新しい100件を見た。全件は git log で" });
	const allowed = runChecks(input({ commits: { ok: true, hasMore: false, list } }), { ...settings, extraAllowedEmails: ["X@a.jp", "y@b.jp"] }, { scope: "list" });
	assert.equal(allowed["C-8"].result, "pass");
});

test("K-9: truncated は C-3〜C-7 が ?", () => {
	const r = run({ tree: { ...input().tree, truncated: true } });
	assert.deepEqual(results(r, C3_7), Array(5).fill("unknown"));
	assert.equal(r["C-3"].reason, "ファイルの一覧が途中で切れている(truncated)");
});

test("tree の失敗は ? と理由(M-23 の言葉・API の上限・状態コード)", () => {
	assert.equal(run({ tree: { ok: false, kind: "network" } })["C-5"].reason, "ファイルの一覧を取れなかった(通信の失敗)");
	assert.equal(run({ tree: { ok: false, kind: "rate-limited" } })["C-5"].reason, "ファイルの一覧を取れなかった(API の上限)");
	assert.equal(run({ tree: { ok: false, kind: "server", status: 502 } })["C-5"].reason, "ファイルの一覧を取れなかった(502)");
	assert.equal(run({ tree: { ok: false, kind: "server", reason: "503" } })["C-5"].reason, "ファイルの一覧を取れなかった(503)");
	assert.equal(run({ commits: { ok: false, kind: "bad-json" } })["C-8"].reason, "コミットを取れなかった(応答を読めない)");
});

test("K-10: tree・commits が 409 は C-3〜C-10 が −(空のリポジトリ)", () => {
	const r = run({ tree: { ok: false, kind: "empty" }, commits: { ok: false, kind: "empty" }, readme: { ok: false, kind: "not-found" } });
	const ids = [...C3_7, "C-8", "C-9", "C-10"];
	assert.deepEqual(results(r, ids), Array(8).fill("na"));
	for (const id of ids) assert.equal(r[id].extra, "空のリポジトリ");
});

test("K-11: 開発状況の見出しが無い", () => {
	const text = "## 概要\n## Features\n## 動作環境\n## 使い方\n## License\n";
	assert.deepEqual(run({ readme: { ok: true, text } })["C-9"], { result: "fail", reason: "足りない項目: 開発状況" });
});

test("K-12: 囲みの中の見出しは数えない", () => {
	const text = "## 概要\n## Features\n## 動作環境\n## 使い方\n## License\n```\n## 開発状況\n```\n~~~\n```\n## Status\n~~~\n";
	assert.deepEqual(run({ readme: { ok: true, text } })["C-9"], { result: "fail", reason: "足りない項目: 開発状況" });
});

test("C-9: そろえば ○。#### と === の下線は数えない。読めない文字は理由に足す", () => {
	assert.deepEqual(run({})["C-9"], { result: "pass" });
	const text = "概要\n===\n#### Features\n## 動作環境\n## 使い方\n## License\n## Roadmap\n�";
	assert.deepEqual(run({ readme: { ok: true, text } })["C-9"], {
		result: "fail",
		reason: "足りない項目: 概要・主な機能\nREADME に UTF-8 として読めない文字がある",
	});
	assert.deepEqual(run({ readme: { ok: true, text: FULL_README + "�" } })["C-9"], { result: "pass", extra: "README に UTF-8 として読めない文字がある" });
});

test("C-9・C-10: README が 404 は −、ほかの失敗は ?", () => {
	const nf = run({ readme: { ok: false, kind: "not-found" } });
	assert.deepEqual([nf["C-9"], nf["C-10"]], [{ result: "na", extra: "README が無い" }, { result: "na", extra: "README が無い" }]);
	assert.deepEqual(run({ readme: { ok: false, kind: "network" } })["C-10"], { result: "unknown", reason: "README を取れなかった(通信の失敗)" });
});

test("K-13: MIT と README の MIT License は C-10 ○。無ければ ×", () => {
	assert.equal(run({ readme: { ok: true, text: "# x\nMIT License" } })["C-10"].result, "pass");
	assert.deepEqual(run({ readme: { ok: true, text: "# x\nmit license" }, license: { spdx: "Apache-2.0" } })["C-10"], { result: "fail", reason: "README に「Apache-2.0」の文字が無い" });
});

test("K-14: license null は C-10 −(NOASSERTION も)", () => {
	const want = { result: "na", extra: "ライセンスが無いか、GitHub が判別できない" };
	assert.deepEqual(run({ license: null })["C-10"], want);
	assert.deepEqual(run({ license: { spdx: "NOASSERTION" } })["C-10"], want);
});

test("K-15: 空白だけの説明は C-11 ×。トピックが無ければ C-12 ×", () => {
	assert.deepEqual(run({ description: "  " })["C-11"], { result: "fail", reason: "説明文が空" });
	assert.deepEqual(run({ description: null })["C-11"].result, "fail");
	assert.deepEqual(run({ topics: [] })["C-12"], { result: "fail", reason: "トピックが無い" });
});

test("K-16: ID が無ければ C-8 ?", () => {
	assert.deepEqual(run({ userId: null })["C-8"], { result: "unknown", reason: "ID を取れなかった" });
});

test("K-17: 範囲 list は C-9・C-10 のキーが無い", () => {
	const r = run({ readme: undefined }, "list");
	assert.ok(!("C-9" in r) && !("C-10" in r));
	assert.deepEqual(Object.keys(r).sort(), CHECK_DEFS.filter((d) => d.scope === "both").map((d) => d.id).sort());
});

test("maskEmail: §9.4 (c)", () => {
	assert.equal(maskEmail("Taro.Yamada@Gmail.com"), "ta***@gmail.com");
	assert.equal(maskEmail("ab@x.jp"), "a***@x.jp");
	assert.equal(maskEmail("a@x.jp"), "a***@x.jp");
	assert.equal(maskEmail("no-at-mark"), "***");
	assert.equal(maskEmail(""), "***");
});

// C-13・C-14(INTERFACES.md §4)
const WF = ".github/workflows/ci.yml";
const withWf = (workflows, extra = []) => ({
	tree: { ok: true, truncated: false, entries: [...input().tree.entries, ...blobs(WF, ...extra)] },
	workflows,
});
const both = (r) => [r["C-13"], r["C-14"]];
const CLEAN = `name: ci
on: [push]
permissions:
  contents: read
concurrency:
  group: ci
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
        with:
          persist-credentials: false
      - run: echo ok
`;
const BAD = `on: pull_request_target
jobs:
  a:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - run: echo "\${{ github.event.pull_request.title }}"
`;

test("C-13・C-14: 空のリポジトリ・tree の失敗・truncated", () => {
	const empty = run({ tree: { ok: false, kind: "empty" }, commits: { ok: false, kind: "empty" } });
	assert.deepEqual(both(empty), [{ result: "na", extra: "空のリポジトリ" }, { result: "na", extra: "空のリポジトリ" }]);
	const failed = run({ tree: { ok: false, kind: "network" } });
	assert.deepEqual(both(failed), Array(2).fill({ result: "unknown", reason: "ファイルの一覧を取れなかった(通信の失敗)" }));
	const cut = run({ tree: { ok: true, truncated: true, entries: blobs(WF) } });
	assert.deepEqual(both(cut), Array(2).fill({ result: "unknown", reason: "ファイルの一覧が途中で切れている(truncated)" }));
});

test("C-13・C-14: ワークフローが無ければ −(workflows/ の外の yml・tree の型は数えない)", () => {
	const r = run({ tree: { ok: true, truncated: false, entries: [...blobs("ci.yml", ".github/workflows/sub/x.yml"), { path: ".github/workflows/x.yml", type: "tree" }] } });
	assert.deepEqual(both(r), Array(2).fill({ result: "na", extra: "ワークフローが無い" }));
});

test("C-13・C-14: 6 本以上・取れなかった・取っていないは ?", () => {
	assert.deepEqual(both(run(withWf({ ok: false, kind: "too-many", tooMany: 7 }))), Array(2).fill({ result: "unknown", reason: "ワークフローが 7 本ある(点検は 5 本まで)" }));
	assert.deepEqual(both(run(withWf({ ok: false, kind: "rate-limited" })))[0].reason, "ワークフローを取れなかった(API の上限)");
	assert.deepEqual(both(run(withWf({ ok: false, kind: "server", status: 500 })))[1].reason, "ワークフローを取れなかった(500)");
	assert.equal(run(withWf(undefined))["C-13"].result, "unknown");
});

test("C-13・C-14: 当たりが 0 なら ○、あれば × で findings に全部(actions.js の文のまま)", () => {
	assert.deepEqual(both(run(withWf({ ok: true, files: [{ path: WF, text: CLEAN }] }))), [{ result: "pass" }, { result: "pass" }]);
	const BADP = ".github/workflows/bad.yml";
	const r = run(withWf({ ok: true, files: [{ path: WF, text: CLEAN }, { path: BADP, text: BAD }] }, [BADP]));
	const a = auditWorkflow(BADP, BAD);
	assert.ok(a.danger.length > 0 && a.hygiene.length > 0);
	assert.deepEqual(r["C-13"], { result: "fail", reason: `当てはまる所: ${a.danger.length} 件`, findings: a.danger });
	assert.deepEqual(r["C-14"], { result: "fail", reason: `当てはまる所: ${a.hygiene.length} 件`, findings: a.hygiene });
	assert.equal(run(withWf({ ok: true, files: [{ path: WF, text: CLEAN }] }), "list")["C-13"].result, "pass");
});

// formatCheckupTable(§9.4 (d) + C-13・C-14)
const HEAD = `| リポジトリ | C-1 名前 | C-2 小文字 | C-3 README | C-4 LICENSE | C-5 .gitignore | C-6 不要物 | C-7 .env | C-8 アドレス | C-11 説明文※ | C-12 トピック※ | C-13 Actions危険※ | C-14 Actions守り※ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|`;
const FOOT = "点検: 2026-10-08 19:30(RepoLens)。※は GitHub公開ルールに無い項目。前回の結果の行は記号の後に「(前回 MM-DD)」";
const meta = { checkedLocal: "2026-10-08 19:30", mdhm: (iso) => (iso === "2026-10-01T03:00:00Z" ? "10-01 12:00" : null) };
const row = (name, results, more = {}) => ({ fullName: `takosasi-dev/${name}`, htmlUrl: `https://github.com/takosasi-dev/${name}`, pushedAt: null, archived: false, fork: false, checkedAt: "2026-10-08T10:30:00Z", results, ...more });

test("formatCheckupTable: 見本の形に C-13・C-14 の列。前回の行と未点検の行", () => {
	const fresh = run({ topics: [] }, "list");
	const old = { ...fresh, "C-13": { result: "unknown", reason: "x" }, "C-14": { result: "na", extra: "ワークフローが無い" } };
	const got = formatCheckupTable(
		[row("disk-sift", fresh), row("delve-down", old, { stale: true, checkedAt: "2026-10-01T03:00:00Z" }), row("timer-board", null)],
		meta,
	);
	const S = "(前回 10-01)";
	const want = [
		HEAD,
		"| [disk-sift](https://github.com/takosasi-dev/disk-sift) | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | × | − | − |",
		`| [delve-down](https://github.com/takosasi-dev/delve-down) | ${["○", "○", "○", "○", "○", "○", "○", "○", "○", "×", "?", "−"].map((s) => s + S).join(" | ")} |`,
		`| [timer-board](https://github.com/takosasi-dev/timer-board) | ${Array(12).fill("未点検").join(" | ")} |`,
		"",
		FOOT,
	].join("\n");
	assert.equal(got, want);
});

test("formatCheckupTable: 行が 0 なら見出しと 1 行だけ", () => {
	assert.equal(formatCheckupTable([], meta), `${HEAD}\n\n${FOOT}`);
});
