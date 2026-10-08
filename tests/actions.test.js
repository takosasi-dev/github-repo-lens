// actions.js(C-13・C-14 の Actions 点検)のテスト。直した後の 8 本は当たり 0、直す前の 8 本は指示書 §4 の差分どおりに当たる。
// 危ない書き方の各条件は小さな入力で 1 つずつ確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { ACTIONS_MAX_FILES, isWorkflowPath, auditWorkflow } from "../actions.js";

const FIX = new URL("./fixtures/", import.meta.url);
const readFixtures = (dir) =>
	readdirSync(new URL(`${dir}/`, FIX)).flatMap((repo) =>
		readdirSync(new URL(`${dir}/${repo}/`, FIX)).map((name) => ({
			repo,
			path: `.github/workflows/${name}`,
			text: readFileSync(new URL(`${dir}/${repo}/${name}`, FIX), "utf8"),
		})),
	);
const audit = (text) => auditWorkflow(".github/workflows/x.yml", text);
const yml = (...lines) => lines.join("\n") + "\n";

// 守りの書き方がそろった土台(小さな入力用)。ジョブ test の steps に行を足して使う。
const base = (...steps) =>
	yml(
		"on: push",
		"permissions:",
		"  contents: read",
		"concurrency: ci",
		"jobs:",
		"  test:",
		"    runs-on: ubuntu-latest",
		"    timeout-minutes: 5",
		"    steps:",
		...steps,
	);

test("定数と isWorkflowPath", () => {
	assert.equal(ACTIONS_MAX_FILES, 5);
	assert.equal(isWorkflowPath(".github/workflows/ci.yml"), true);
	assert.equal(isWorkflowPath(".github/workflows/pages.yaml"), true);
	assert.equal(isWorkflowPath(".github/workflows/sub/ci.yml"), false);
	assert.equal(isWorkflowPath(".github/workflows/ci.json"), false);
	assert.equal(isWorkflowPath("x/.github/workflows/ci.yml"), false);
	assert.equal(isWorkflowPath(".github/dependabot.yml"), false);
	assert.equal(isWorkflowPath(undefined), false);
});

test("直した後の 8 本は danger も hygiene も空", () => {
	const files = readFixtures("workflows");
	assert.equal(files.length, 8);
	for (const f of files) assert.deepEqual(auditWorkflow(f.path, f.text), { danger: [], hygiene: [] }, f.repo);
});

test("直す前の delve-down(行番号を手で数えた物)", () => {
	const text = readFileSync(new URL("workflows-bad/delve-down/ci.yml", FIX), "utf8");
	assert.deepEqual(auditWorkflow(".github/workflows/ci.yml", text), {
		danger: [],
		hygiene: [
			"ci.yml: ジョブ test に timeout-minutes が無い",
			"ci.yml: concurrency が無い",
			"ci.yml 20行目: actions/checkout@v4 を SHA で固定していない",
			"ci.yml 20行目: checkout に persist-credentials: false が無い",
			"ci.yml 22行目: actions/setup-python@v5 を SHA で固定していない",
		],
	});
});

test("直す前の rail-rampage(一番上の書き込み権限)", () => {
	const text = readFileSync(new URL("workflows-bad/rail-rampage/pages.yml", FIX), "utf8");
	assert.deepEqual(auditWorkflow(".github/workflows/pages.yml", text), {
		danger: [],
		hygiene: [
			"pages.yml: ジョブ deploy に timeout-minutes が無い",
			"pages.yml 12行目: 一番上の permissions に書き込みの権限(pages)。ジョブに移す",
			"pages.yml 13行目: 一番上の permissions に書き込みの権限(id-token)。ジョブに移す",
			"pages.yml 33行目: actions/upload-pages-artifact@v4 を SHA で固定していない",
			"pages.yml 37行目: actions/deploy-pages@v4 を SHA で固定していない",
		],
	});
});

test("直す前の CI 7 本は §4.1 の差分どおりに当たる", () => {
	const jobsOf = { "dbc-agent": ["test", "shell"], "dbc-gui": ["test", "api-compat"] };
	const files = readFixtures("workflows-bad").filter((f) => f.repo !== "rail-rampage");
	assert.equal(files.length, 7);
	for (const f of files) {
		const file = f.path.split("/").pop();
		const want = (jobsOf[f.repo] ?? ["test"]).map((j) => `${file}: ジョブ ${j} に timeout-minutes が無い`);
		want.push(`${file}: concurrency が無い`);
		f.text.split("\n").forEach((line, i) => {
			const m = /- uses: (\S+)/.exec(line);
			if (!m) return;
			want.push(`${file} ${i + 1}行目: ${m[1]} を SHA で固定していない`);
			if (m[1].startsWith("actions/checkout@")) want.push(`${file} ${i + 1}行目: checkout に persist-credentials: false が無い`);
		});
		assert.deepEqual(auditWorkflow(f.path, f.text), { danger: [], hygiene: want }, f.repo);
	}
});

test("C-13: 危ないきっかけ(3 つの形と引用つきのキー)", () => {
	const msg = (name) => `x.yml: 危ないきっかけ ${name}(PR のコードを特権で動かしうる)`;
	const onOnly = (...onLines) => audit(base("      - run: echo").replace("on: push\n", yml(...onLines))).danger;
	assert.deepEqual(onOnly("on: pull_request_target"), [msg("pull_request_target")]);
	assert.deepEqual(onOnly("on: [push, pull_request_target]"), [msg("pull_request_target")]);
	assert.deepEqual(onOnly("on:", "  workflow_run:", "    workflows: [ci]", "    types: [completed]"), [msg("workflow_run")]);
	assert.deepEqual(onOnly("'on':", "  - push", "  - pull_request_target"), [msg("pull_request_target")]);
	assert.deepEqual(onOnly('"on":', "  pull_request_target:", "  workflow_run: # あとで消す"), [msg("pull_request_target"), msg("workflow_run")]);
	assert.deepEqual(onOnly("on: { workflow_run: { workflows: [ci] } }"), [msg("workflow_run")]);
	// 子の子にある同じ名前は数えない。pull_request は当たらない
	assert.deepEqual(onOnly("on:", "  pull_request:", "    branches: [workflow_run]"), []);
});

test("C-13: run: の中の式(1 行の値と | のブロック)", () => {
	const r = audit(base(
		'      - run: echo "${{ github.event.issue.title }}"',
		"      - name: ブロック",
		"        run: |",
		"          echo start",
		"          git checkout ${{github.head_ref}} # コメントに見える所も中身",
		"      - run: >-",
		"          echo ${{ github.event.pull_request.body }}",
	));
	assert.deepEqual(r.danger, [
		"x.yml 10行目: run: の中に式 ${{ github.event.issue.title }}(env: に移す)",
		"x.yml 14行目: run: の中に式 ${{github.head_ref}}(env: に移す)",
		"x.yml 16行目: run: の中に式 ${{ github.event.pull_request.body }}(env: に移す)",
	]);
});

test("C-13: env: と with: と concurrency の式、run: の安全な式は当たらない", () => {
	const r = audit(yml(
		"on: pull_request",
		"permissions: {}",
		"concurrency:",
		"  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}",
		"jobs:",
		"  test:",
		"    if: github.event.pull_request.draft == false",
		"    runs-on: ubuntu-latest",
		"    timeout-minutes: 5",
		"    steps:",
		"      - env:",
		"          TITLE: ${{ github.event.issue.title }}",
		"          REF: ${{ github.head_ref }}",
		'        run: echo "$TITLE" "$REF" ${{ matrix.python }}',
		"      - uses: ./local-action",
		"        with:",
		"          title: ${{ github.event.issue.title }}",
	));
	assert.deepEqual(r, { danger: [], hygiene: [] });
});

test("C-13: self-hosted の 3 つの形", () => {
	const runsOn = (...lines) => audit(base("      - run: echo").replace("    runs-on: ubuntu-latest\n", yml(...lines))).danger;
	assert.deepEqual(runsOn("    runs-on: self-hosted"), ["x.yml 7行目: 自前のランナー(self-hosted)"]);
	assert.deepEqual(runsOn("    runs-on: [self-hosted, linux, x64]"), ["x.yml 7行目: 自前のランナー(self-hosted)"]);
	assert.deepEqual(runsOn("    runs-on:", "      - linux", "      - self-hosted"), ["x.yml 9行目: 自前のランナー(self-hosted)"]);
	assert.deepEqual(runsOn("    runs-on: ${{ matrix.os }}"), []);
});

test("C-13: permissions が無い / write-all", () => {
	const NO = "x.yml: permissions が無い(トークンが既定の権限になる)";
	const noTop = (...jobs) => audit(yml("on: push", "concurrency: ci", "jobs:", ...jobs)).danger;
	const job = (name, ...extra) => [`  ${name}:`, "    runs-on: ubuntu-latest", "    timeout-minutes: 5", ...extra, "    steps:", "      - run: echo"];
	assert.deepEqual(noTop(...job("a")), [NO]);
	assert.deepEqual(noTop(...job("a", "    permissions:", "      contents: read"), ...job("b")), [NO]);
	assert.deepEqual(noTop(...job("a", "    permissions: {}"), ...job("b", "    permissions: read-all")), []);
	assert.deepEqual(noTop(...job("a", "    permissions: write-all")), ["x.yml 7行目: permissions: write-all"]);
	assert.deepEqual(audit(base("      - run: echo").replace("permissions:\n  contents: read\n", "permissions: write-all\n")).danger, ["x.yml 2行目: permissions: write-all"]);
});

test("C-14: SHA の固定(除く物と当たる物)", () => {
	const r = audit(base(
		"      - uses: ./local-action",
		"      - uses: ./.github/actions/setup",
		"      - uses: docker://alpine@sha256:" + "a".repeat(64),
		"      - uses: actions/setup-node@" + "0123456789abcdef0123456789abcdef01234567" + " # v4",
		"      - uses: 'owner/repo/sub@" + "f".repeat(40) + "'",
		"      - uses: docker://alpine:3.20",
		"      - uses: owner/repo@main",
		"      - uses: owner/repo@" + "a".repeat(39),
	));
	assert.deepEqual(r.hygiene, [
		"x.yml 15行目: docker://alpine:3.20 を SHA で固定していない",
		"x.yml 16行目: owner/repo@main を SHA で固定していない",
		`x.yml 17行目: owner/repo@${"a".repeat(39)} を SHA で固定していない`,
	]);
});

test("C-14: checkout の persist-credentials", () => {
	const sha = "@" + "1".repeat(40);
	const r = audit(base(
		`      - uses: actions/checkout${sha}`,
		`      - uses: actions/checkout${sha}`,
		"        with:",
		"          persist-credentials: true",
		`      - uses: actions/checkout${sha}`,
		"        with: { clean: true, persist-credentials: false }",
		`      - name: 名前が先`,
		"        with:",
		"          persist-credentials: 'false'",
		`        uses: actions/checkout${sha}`,
	));
	assert.deepEqual(r.hygiene, [
		"x.yml 10行目: checkout に persist-credentials: false が無い",
		"x.yml 11行目: checkout に persist-credentials: false が無い",
	]);
});

test("C-14: timeout-minutes(再利用ワークフローの呼び出しは除く)と concurrency", () => {
	const r = audit(yml(
		"on: push",
		"permissions: {}",
		"jobs:",
		"  call:",
		"    uses: ./.github/workflows/reuse.yml",
		"  build:",
		"    runs-on: ubuntu-latest",
		"    steps:",
		"    - run: echo # steps: と同じ字下げの -",
		"    - uses: owner/repo@v1",
		"  lint:",
		"    runs-on: ubuntu-latest",
		"    concurrency: lint",
		"    timeout-minutes: 3",
		"    steps: []",
	));
	assert.deepEqual(r, {
		danger: [],
		hygiene: ["x.yml: ジョブ build に timeout-minutes が無い", "x.yml 10行目: owner/repo@v1 を SHA で固定していない"],
	});
	assert.deepEqual(audit(base("      - run: echo").replace("concurrency: ci\n", "")).hygiene, ["x.yml: concurrency が無い"]);
});

test("ブロックの中の行は構造として読まない・CRLF と BOM", () => {
	const r = audit("﻿" + base(
		"      - run: |",
		"          cat <<'EOF'",
		"          - uses: evil/action@v1",
		"          permissions: write-all",
		"          runs-on: self-hosted",
		"          EOF",
	).replaceAll("\n", "\r\n"));
	assert.deepEqual(r, { danger: [], hygiene: [] });
});
