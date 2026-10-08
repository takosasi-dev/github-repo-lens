// manifest とソースの静的な検査(仕様書 AC-2〜AC-7・AC-25 と、storage.local への書き込みの場所)。仕様書の grep を Node で同じ範囲に当てる。
// このファイル自身が grep に当たらないよう、探す語はつないで作る。ほかの担当のファイルがまだ無いと落ちる検査も、そのまま残す(統合担当が最後に回す)。
// 「fetch」は facts の fetchedIso・api.js の fetchImpl に当たらないよう、語の区切りで探す(仕様書の grep の字面とは違う。NOTES.md に書く)。
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const j = (...parts) => parts.join("");

function walk(dir, skipTests) {
	const out = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		const rel = path.relative(ROOT, p).replaceAll("\\", "/");
		if (e.isDirectory()) {
			if (!(skipTests && rel === "tests") && !rel.startsWith(".")) out.push(...walk(p, skipTests));
		} else out.push(rel);
	}
	return out;
}

// → [ "rel:行番号", ... ]
function grep(re, files) {
	const hits = [];
	for (const rel of files) {
		read(rel)
			.split("\n")
			.forEach((line, i) => {
				if (re.test(line)) hits.push(`${rel}:${i + 1}`);
			});
	}
	return hits;
}
const filesOf = (exts, skipTests) => walk(ROOT, skipTests).filter((f) => exts.includes(path.extname(f)));
const FETCH = new RegExp(j("\\bfet", "ch\\b"));

test("AC-2: 権限は activeTab・offscreen・storage(clipboardWrite は足したときだけ)。content_scripts が無く、host 権限は無いか api.github.com だけ", () => {
	const m = JSON.parse(read("manifest.json"));
	const base = ["activeTab", "offscreen", "storage"];
	const perms = [...m.permissions].sort();
	const ok = [base, [...base, "clipboardWrite"]].some((want) => JSON.stringify([...want].sort()) === JSON.stringify(perms));
	assert.ok(ok, `permissions: ${perms}`);
	assert.equal(m.content_scripts, undefined);
	if (m.host_permissions !== undefined) assert.deepEqual(m.host_permissions, [j("https://api.", "github.com/*")]);
	for (const key of ["optional_host_permissions", "optional_permissions"]) assert.equal(m[key], undefined, key);
	assert.equal(m.minimum_chrome_version, "153");
	assert.equal(m.background.service_worker, "sw.js");
	assert.equal(m.background.type, "module");
	assert.equal(m.action.default_popup, "popup.html");
	assert.equal(m.action.default_title, "RepoLens");
	assert.equal(m.options_ui.page, "options.html");
	assert.equal(m.commands["copy-repo"].suggested_key.default, "Alt+Shift+G");
});

test("AC-2: manifest が指すファイルがある", () => {
	const m = JSON.parse(read("manifest.json"));
	const files = [m.background.service_worker, m.action.default_popup, m.options_ui.page, ...Object.values(m.action.default_icon), ...Object.values(m.icons)];
	for (const f of files) assert.ok(existsSync(path.join(ROOT, f)), f);
});

test("AC-3: innerHTML などが 0 件(tests/ を除く)", () => {
	const re = new RegExp(j("inner", "HTML|outer", "HTML|insertAdjacent", "HTML|document\\.wr", "ite"));
	assert.deepEqual(grep(re, filesOf([".js", ".html"], true)), []);
});

test("AC-4: 通信の語を含む .js は api.js だけ。ほかの通信と動的 import が 0 件。URL を組み立てる所は api.js の 1 か所(tests/ を除く)", () => {
	const js = filesOf([".js"], true);
	assert.deepEqual(js.filter((f) => FETCH.test(read(f))), ["api.js"]);
	const re = new RegExp(j("XMLHttp", "Request|Web", "Socket|Event", "Source|send", "Beacon|imp", "ort\\("));
	assert.deepEqual(grep(re, js), []);
	const base = new RegExp(j("[\"'`]https://api\\.", "github\\.com"));
	const hits = grep(base, js);
	assert.equal(hits.length, 1, hits.join(" "));
	assert.match(hits[0], /^api\.js:/);
});

test("AC-5: GET 以外のメソッドと Authorization が 0 件。api.js に GET と credentials omit が 1 行ずつ(tests/ を除く)", () => {
	const re = new RegExp(j("method:\\s*[\"'](PO", "ST|PU", "T|PAT", "CH|DEL", "ETE)|Author", "ization"));
	assert.deepEqual(grep(re, filesOf([".js"], true)), []);
	assert.equal(grep(new RegExp(j("method: \"G", "ET\"")), ["api.js"]).length, 1);
	assert.equal(grep(new RegExp(j("credentials: \"om", "it\"")), ["api.js"]).length, 1);
});

test("AC-6: ページへの注入が 0 件(tests/ も含む)", () => {
	const re = new RegExp(j("execute", "Script|insert", "CSS|chrome\\.scr", "ipting"));
	assert.deepEqual(grep(re, filesOf([".js"], false)), []);
});

test("AC-7: format.js は SourceStamp の format.js とバイトで同じ(D-9)", (t) => {
	const hash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").toUpperCase();
	const mine = hash(path.join(ROOT, "format.js"));
	assert.equal(mine, "86E9F95B597B0311F24308584E104F482C70F8C6893DAC5477C93221F05FE6F0"); // 2026-10-06 に写した時の値
	const src = path.join(ROOT, "..", "..", "sourcestamp", "format.js"); // このフォルダは GitHub関連 の下に 1 段深い
	if (!existsSync(src)) return t.skip("sourcestamp が無い");
	assert.equal(mine, hash(src));
});

test("AC-25: 純関数のファイルは chrome.*・現在時刻・通信の語を使わない(コメントも)", () => {
	const re = new RegExp(`${j("chr", "ome\\.")}|${j("Date\\.n", "ow\\(")}|${j("new Da", "te\\(\\)")}|${FETCH.source}`);
	assert.deepEqual(grep(re, ["repo-url.js", "repofmt.js", "checks.js", "mdtext.js", "localtime.js", "actions.js"]), []);
});

test("storage.local への書き込みは settings.js と checkup.js の 1 か所ずつだけ(tests/ も含む)", () => {
	const hits = grep(new RegExp(j("storage", "\\.local", "\\.set")), filesOf([".js"], false));
	assert.equal(hits.length, 2, hits.join(" "));
	assert.deepEqual(hits.map((h) => h.split(":")[0]).sort(), ["checkup.js", "settings.js"]);
});

test("sw.js は popup を開かずにコピーする流れだけ(parseRepoUrl → loadRepo の m1Only → buildCopy → クリップボード → バッジ)", () => {
	const src = read("sw.js");
	for (const word of ["parseRepoUrl(", "m1Only: true", "buildCopy(", "writeClipboard(", "showResult(", "\"copy-repo\""]) assert.ok(src.includes(word), word);
});

test("各ソースの先頭が責務のコメント", () => {
	for (const f of walk(ROOT, false).filter((f) => /\.(js|html|py|css)$/.test(f))) {
		const head = read(f).replace(/^<!doctype html>\r?\n/i, "");
		assert.ok(/^(\/\/|<!--|#|\/\*)/.test(head), f);
	}
});
