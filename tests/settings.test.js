// settings.js のテスト(仕様書 §9.6・非機能 T-1・AV-5・画面設計書 M-27〜M-32)。偽の chrome.storage.local で読み書きを数える。
// 実行: github-repo-lens フォルダで `node --test tests/settings.test.js`
import test from "node:test";
import assert from "node:assert/strict";

const store = { data: {}, writes: 0 };
// index.js で一緒に読まれるほかのテストの偽物を消さないよう、足すだけにする
globalThis.chrome = {
	...globalThis.chrome,
	storage: {
		local: {
			get: async (key) => ({ [key]: store.data[key] }),
			set: async (obj) => {
				store.writes++;
				Object.assign(store.data, structuredClone(obj));
			},
		},
	},
};
const { DEFAULTS, README_ITEMS, validateSettings, checkField, loadSettings, saveSettings } = await import("../settings.js");

const good = () => structuredClone(DEFAULTS);

test("DEFAULTS は §9.6 と INTERFACES §5 の値", () => {
	assert.equal(DEFAULTS.schemaVersion, 1);
	assert.equal(DEFAULTS.ownerLogin, "takosasi-dev");
	assert.equal(DEFAULTS.defaultFormat, "bullet");
	assert.equal(DEFAULTS.bullet, true);
	assert.equal(DEFAULTS.includeHeader, false);
	assert.equal(DEFAULTS.includeForks, false);
	assert.equal(DEFAULTS.includeArchived, true);
	assert.deepEqual(DEFAULTS.extraAllowedEmails, []);
	assert.deepEqual(DEFAULTS.binaryExts, ["exe", "dll", "msi", "pdb", "obj", "apk", "aab", "so", "dylib"]);
	assert.deepEqual(DEFAULTS.junkNames, ["build", ".vs", ".idea", "__pycache__", "node_modules", ".DS_Store", "Thumbs.db", "desktop.ini"]);
	assert.deepEqual(Object.keys(DEFAULTS.readmeHeadingKeywords), README_ITEMS);
	assert.deepEqual(DEFAULTS.readmeHeadingKeywords["ビルド・実行方法"], ["ビルド", "実行", "使い方", "インストール", "Build", "Usage", "Install", "Getting Started"]);
	assert.ok(Object.isFrozen(DEFAULTS.readmeHeadingKeywords.概要));
});

test("何も保存されていなければ既定値。警告なし", () => {
	const r = validateSettings(undefined);
	assert.deepEqual(r.settings, good());
	assert.deepEqual(r.warnings, []);
	assert.equal(r.broken, false);
	r.settings.binaryExts.push("zip"); // 返り値をいじっても DEFAULTS は変わらない
	assert.equal(DEFAULTS.binaryExts.includes("zip"), false);
});

test("正しい値はそのまま通る", () => {
	const raw = { ...good(), ownerLogin: "", defaultFormat: "row", extraAllowedEmails: ["a@b.c"], junkNames: ["dist"] };
	const r = validateSettings(raw);
	assert.deepEqual(r.settings, raw);
	assert.equal(r.broken, false);
});

test("AV-5: 形が違う値(文字・null・配列)はすべて既定値で警告", () => {
	for (const raw of ["壊れた値", null, [1]]) {
		const r = validateSettings(raw);
		assert.deepEqual(r.settings, good());
		assert.equal(r.broken, true);
		assert.equal(r.warnings.length, 1);
	}
});

test("T-1: schemaVersion 0(と欄が無い物)は読み替え。99 は既定値と警告", () => {
	const v0 = { ...good(), schemaVersion: 0, ownerLogin: "octo" };
	const r0 = validateSettings(v0);
	assert.equal(r0.settings.ownerLogin, "octo");
	assert.equal(r0.settings.schemaVersion, 1);
	assert.equal(r0.broken, false);
	assert.equal(v0.schemaVersion, 0, "元の値を変えない");
	const { schemaVersion, ...noVersion } = { ...good(), ownerLogin: "octo" };
	assert.equal(validateSettings(noVersion).settings.ownerLogin, "octo");
	const r99 = validateSettings({ ...good(), schemaVersion: 99, ownerLogin: "octo" });
	assert.deepEqual(r99.settings, good());
	assert.equal(r99.broken, true);
	assert.match(r99.warnings[0], /99/);
});

test("壊れた欄だけ既定値、ほかの欄は保存された値", () => {
	const raw = {
		...good(),
		ownerLogin: "bad name",
		defaultFormat: "csv",
		bullet: "yes",
		includeForks: true,
		extraAllowedEmails: ["no-at"],
		binaryExts: [".exe"],
		junkNames: ["a/b"],
		readmeHeadingKeywords: { ...good().readmeHeadingKeywords, 開発状況: [] },
	};
	const r = validateSettings(raw);
	assert.equal(r.broken, true);
	assert.equal(r.settings.includeForks, true);
	for (const k of ["ownerLogin", "defaultFormat", "bullet", "extraAllowedEmails", "binaryExts", "junkNames", "readmeHeadingKeywords"]) {
		assert.deepEqual(r.settings[k], DEFAULTS[k], k);
		assert.ok(r.warnings.some((w) => w.startsWith(k)), k);
	}
});

test("件数と長さの上限(§9.6)", () => {
	const bad = (patch) => validateSettings({ ...good(), ...patch }).broken;
	assert.equal(bad({ extraAllowedEmails: Array.from({ length: 10 }, (_, i) => `a${i}@b.c`) }), false);
	assert.equal(bad({ extraAllowedEmails: Array.from({ length: 11 }, (_, i) => `a${i}@b.c`) }), true);
	assert.equal(bad({ binaryExts: Array.from({ length: 31 }, (_, i) => `e${i}`) }), true);
	assert.equal(bad({ junkNames: ["x".repeat(101)] }), true);
	assert.equal(bad({ ownerLogin: "a".repeat(40) }), true);
	assert.equal(bad({ readmeHeadingKeywords: { ...good().readmeHeadingKeywords, 概要: ["x".repeat(31)] } }), true);
	const { 開発状況, ...five } = good().readmeHeadingKeywords;
	assert.equal(bad({ readmeHeadingKeywords: five }), true);
});

test("checkField ownerLogin: 前後の空白を除く。外れたら M-27", () => {
	assert.deepEqual(checkField("ownerLogin", "  takosasi-dev "), { value: "takosasi-dev" });
	assert.deepEqual(checkField("ownerLogin", ""), { value: "" });
	assert.deepEqual(checkField("ownerLogin", "taro_y"), { error: "ユーザー名は半角英数とハイフンで39文字まで" });
	assert.ok(checkField("ownerLogin", "a".repeat(40)).error);
});

test("checkField extraAllowedEmails: 空行は数えない。M-28 は元の行番号、11 件で M-29", () => {
	assert.deepEqual(checkField("extraAllowedEmails", "a@b.c\n\n d@e.f \r\n"), { value: ["a@b.c", "d@e.f"] });
	assert.deepEqual(checkField("extraAllowedEmails", "a@b.c\n\nx@@y"), { error: "3 行目: @ を1つだけ含むアドレスにする" });
	assert.deepEqual(checkField("extraAllowedEmails", "noat"), { error: "1 行目: @ を1つだけ含むアドレスにする" });
	const eleven = Array.from({ length: 11 }, (_, i) => `a${i}@b.c`).join("\n");
	assert.deepEqual(checkField("extraAllowedEmails", eleven), { error: "アドレスは10件まで" });
});

test("checkField binaryExts: カンマで区切る。外れた最初の語で M-30", () => {
	assert.deepEqual(checkField("binaryExts", "exe, dll ,msi,"), { value: ["exe", "dll", "msi"] });
	assert.deepEqual(checkField("binaryExts", "exe, .dll, EXE"), { error: ".dll: 先頭の . を付けない小文字の英数字にする" });
	assert.deepEqual(checkField("binaryExts", "EXE"), { error: "EXE: 先頭の . を付けない小文字の英数字にする" });
	assert.deepEqual(checkField("binaryExts", ""), { value: [] });
});

test("checkField junkNames: 空の語は捨てる。/ を含む語で M-32", () => {
	assert.deepEqual(checkField("junkNames", "build, .vs,, Thumbs.db\n"), { value: ["build", ".vs", "Thumbs.db"] });
	assert.deepEqual(checkField("junkNames", "build, out/bin"), { error: "out/bin: / を含めない" });
});

test("checkField readmeHeadingKeywords.<項目>: 空なら M-31", () => {
	assert.deepEqual(checkField("readmeHeadingKeywords.概要", "概要, About"), { value: ["概要", "About"] });
	assert.deepEqual(checkField("readmeHeadingKeywords.開発状況", " , "), { error: "キーワードを1つ以上入れる" });
	assert.ok(checkField("readmeHeadingKeywords.ライセンス", Array.from({ length: 11 }, (_, i) => `k${i}`).join(",")).error);
	assert.throws(() => checkField("readmeHeadingKeywords.その他", "x"));
	assert.throws(() => checkField("bullet", "x"));
});

test("checkField の value をそのまま入れた設定は validateSettings を通る", () => {
	const s = good();
	s.extraAllowedEmails = checkField("extraAllowedEmails", "me@example.com").value;
	s.binaryExts = checkField("binaryExts", "exe, zip").value;
	s.junkNames = checkField("junkNames", "dist, .cache").value;
	for (const item of README_ITEMS) s.readmeHeadingKeywords[item] = checkField(`readmeHeadingKeywords.${item}`, "a, b").value;
	assert.equal(validateSettings(s).broken, false);
});

test("AV-5: loadSettings は壊れた値を読んでも書き直さない", async () => {
	store.data = { settings: "壊れた値" };
	store.writes = 0;
	const r = await loadSettings();
	assert.equal(r.broken, true);
	assert.deepEqual(r.settings, good());
	assert.equal(store.writes, 0);
	assert.equal(store.data.settings, "壊れた値");
});

test("saveSettings は 1 回だけ書き、schemaVersion 1 と §9.6 のキーだけを書く。壊れた値は書かずに投げる", async () => {
	store.data = {};
	store.writes = 0;
	await saveSettings({ ...good(), schemaVersion: 0, ownerLogin: "octo", extra: "x" });
	assert.equal(store.writes, 1);
	assert.equal(store.data.settings.schemaVersion, 1);
	assert.equal(store.data.settings.ownerLogin, "octo");
	assert.deepEqual(Object.keys(store.data.settings).sort(), Object.keys(DEFAULTS).sort());
	assert.equal((await loadSettings()).broken, false);
	await assert.rejects(saveSettings({ ...good(), ownerLogin: "bad name" }));
	assert.equal(store.writes, 1);
	assert.equal(store.data.settings.ownerLogin, "octo");
});
