// 設定(chrome.storage.local のキー settings)の既定値・検査・読み替え・読み込み・保存(仕様書 §9.6・非機能 T-1・AV-5)。
// 読めない・形が違う値は上書きせず、その欄だけ既定値で動かして警告を返す。settings を書くのはこのファイルの saveSettings だけ。
// checkField は設定ページの欄ごとの検査(画面設計書 §4.3 の M-27〜M-32)。chrome.* を使うのは loadSettings と saveSettings だけ。

// README の見出しの 6 項目(仕様書 §9.4 (b) の順)
export const README_ITEMS = Object.freeze(["概要", "主な機能", "動作環境", "ビルド・実行方法", "ライセンス", "開発状況"]);

// 仮の値は INTERFACES.md §5(OWNER_LOGIN・DEFAULT_FORMAT・INCLUDE_FORKS/ARCHIVED・§8.6 の案)
const DEFAULT_VALUES = {
	schemaVersion: 1,
	ownerLogin: "takosasi-dev",
	defaultFormat: "bullet",
	bullet: true,
	includeHeader: false,
	includeForks: false,
	includeArchived: true,
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
const copy = (v) => structuredClone(v);
const deepFreeze = (o) => {
	for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
	return Object.freeze(o);
};
export const DEFAULTS = deepFreeze(copy(DEFAULT_VALUES));

// 欄ごとの決まり(§9.6)。値 → 正しいか
const LOGIN_RE = /^[A-Za-z0-9-]{1,39}$/;
const EXT_RE = /^[a-z0-9]+$/;
const isStr = (v) => typeof v === "string";
const isBool = (v) => typeof v === "boolean";
const oneAt = (s) => s.split("@").length === 2;
const listOf = (max, ok) => (v) => Array.isArray(v) && v.length <= max && v.every((x) => isStr(x) && ok(x));
const keywordOk = (s) => s.length >= 1 && s.length <= 30;
const RULES = {
	ownerLogin: (v) => isStr(v) && (v === "" || LOGIN_RE.test(v)),
	defaultFormat: (v) => v === "bullet" || v === "row",
	bullet: isBool,
	includeHeader: isBool,
	includeForks: isBool,
	includeArchived: isBool,
	extraAllowedEmails: listOf(10, oneAt),
	binaryExts: listOf(30, (s) => EXT_RE.test(s)),
	junkNames: listOf(30, (s) => s.length >= 1 && s.length <= 100 && !s.includes("/")),
	readmeHeadingKeywords: (v) =>
		v !== null &&
		typeof v === "object" &&
		!Array.isArray(v) &&
		Object.keys(v).length === README_ITEMS.length &&
		README_ITEMS.every((item) => Array.isArray(v[item]) && v[item].length >= 1 && listOf(10, keywordOk)(v[item])),
};

// 古い版 → 今の版の読み替え(T-1)。ponytail: 版 0 は「schemaVersion の欄が無かった頃の同じ形」と仮に置いた。形が変わる版が出たら、ここに 1 → 2 を足す
const MIGRATIONS = {
	0: (raw) => ({ ...raw, schemaVersion: 1 }),
};

// → { settings, warnings: string[], broken: boolean }。broken は「保存されている値の一部か全部を既定値に置き換えて動いている」(画面設計書 M-26 を出す)。raw は変えない
export function validateSettings(raw) {
	const settings = copy(DEFAULT_VALUES);
	const warnings = [];
	if (raw === undefined) return { settings, warnings, broken: false };
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		warnings.push("保存されている設定の形が違うので、すべて既定値で動いている");
		return { settings, warnings, broken: true };
	}
	let cur = raw;
	let version = raw.schemaVersion ?? 0;
	while (MIGRATIONS[version] && version !== DEFAULTS.schemaVersion) {
		cur = MIGRATIONS[version](cur);
		version = cur.schemaVersion;
	}
	if (version !== DEFAULTS.schemaVersion) {
		warnings.push(`設定の版(schemaVersion ${JSON.stringify(raw.schemaVersion)})を読めないので、すべて既定値で動いている`);
		return { settings, warnings, broken: true };
	}
	for (const [key, ok] of Object.entries(RULES)) {
		if (ok(cur[key])) settings[key] = copy(cur[key]);
		else warnings.push(`${key} の値が読めないので、既定値で動いている`);
	}
	return { settings, warnings, broken: warnings.length > 0 };
}

// 設定ページの欄の文字 → { value } | { error }。name は ownerLogin・extraAllowedEmails・binaryExts・junkNames・"readmeHeadingKeywords.<項目名>"
export function checkField(name, text) {
	const s = String(text ?? "");
	const words = () => s.split(",").map((w) => w.trim()).filter((w) => w !== "");
	if (name === "ownerLogin") {
		const v = s.trim();
		return v === "" || LOGIN_RE.test(v) ? { value: v } : { error: "ユーザー名は半角英数とハイフンで39文字まで" }; // M-27
	}
	if (name === "extraAllowedEmails") {
		const value = [];
		const lines = s.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const v = lines[i].trim();
			if (v === "") continue;
			if (!oneAt(v)) return { error: `${i + 1} 行目: @ を1つだけ含むアドレスにする` }; // M-28
			value.push(v);
		}
		return value.length > 10 ? { error: "アドレスは10件まで" } : { value }; // M-29
	}
	if (name === "binaryExts") {
		const value = words();
		const bad = value.find((w) => !EXT_RE.test(w));
		if (bad !== undefined) return { error: `${bad}: 先頭の . を付けない小文字の英数字にする` }; // M-30
		return value.length > 30 ? { error: "拡張子は30個まで" } : { value }; // 仮の文(画面設計書に無い)
	}
	if (name === "junkNames") {
		const value = words();
		const slash = value.find((w) => w.includes("/"));
		if (slash !== undefined) return { error: `${slash}: / を含めない` }; // M-32
		const long = value.find((w) => w.length > 100);
		if (long !== undefined) return { error: `${long.slice(0, 20)}…: 100文字まで` }; // 仮の文(画面設計書に無い)
		return value.length > 30 ? { error: "名前は30個まで" } : { value }; // 仮の文(画面設計書に無い)
	}
	const m = /^readmeHeadingKeywords\.(.+)$/.exec(name);
	if (m && README_ITEMS.includes(m[1])) {
		const value = words();
		if (value.length === 0) return { error: "キーワードを1つ以上入れる" }; // M-31
		const long = value.find((w) => w.length > 30);
		if (long !== undefined) return { error: `${long.slice(0, 20)}…: 30文字まで` }; // 仮の文(画面設計書に無い)
		return value.length > 10 ? { error: "キーワードは10個まで" } : { value }; // 仮の文(画面設計書に無い)
	}
	throw new Error(`checkField: 知らない欄 ${name}`);
}

// 読むだけ。壊れていても書き直さない(AV-5)
export async function loadSettings() {
	const { settings } = await chrome.storage.local.get("settings");
	return validateSettings(settings);
}

// 「保存」を押したときだけ呼ぶ(FR-12)。検査を通らない値は書かずに投げる(壊れた値で上書きしない)
export async function saveSettings(settings) {
	const next = { ...settings, schemaVersion: DEFAULTS.schemaVersion };
	const { broken, warnings } = validateSettings(next);
	if (broken) throw new Error(warnings.join(" / "));
	const picked = Object.fromEntries(Object.keys(DEFAULT_VALUES).map((k) => [k, next[k]])); // ほかのキーを作らない(INV-5)
	await chrome.storage.local.set({ settings: picked });
}
