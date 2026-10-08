// RepoLens の service worker。ショートカット copy-repo を受け、popup を開かずに既定の形でコピーして結果をバッジに出す(仕様書 FR-4・§9.8 (c))。
// タブの URL だけを使い、GitHub のページには何も注入しない(INV-1)。通信は lens.js → api.js に任せ、ここには書かない(INV-2)。
// facts が作れないときと書き込みに失敗したときはクリップボードに書かない(INV-10)。
import { parseRepoUrl } from "./repo-url.js";
import { loadRepo, buildCopy } from "./lens.js";
import { createApi, chromeSession, rateView } from "./api.js";
import { toLocalHm } from "./localtime.js";
import { loadSettings } from "./settings.js";
import { writeClipboard } from "./clipboard.js";
import { showResult } from "./badge.js";

chrome.commands.onCommand.addListener(async (command, tab) => {
	if (command !== "copy-repo") return;
	const target = tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
	let result;
	try {
		result = await copyRepo(target?.url);
	} catch {
		result = fail("通信の失敗");
	}
	await showResult(target?.id, ...result);
});

const fail = (reason) => ["error", `コピーしていない。${reason}`]; // M-116

// 上限の理由の文(M-116c)。窓が戻る時刻が分からなければ時刻を付けない
async function limitReason(api) {
	const view = rateView(await api.rate(), Date.now());
	if (view.state !== "known") return "API の上限";
	const at = new Date(view.resetMs);
	return `API の上限(${toLocalHm(at.toISOString(), -at.getTimezoneOffset())} 以降)`;
}

// → [kind, tooltip]
async function copyRepo(url) {
	const t = parseRepoUrl(url ?? "");
	if (!t) return fail("リポジトリのページでない"); // M-116a
	const { settings } = await loadSettings();
	const session = chromeSession();
	const api = createApi({ now: () => Date.now(), session }); // 通信の関数は api.js の既定を使う(このファイルに通信の文字を書かない。AC-4)
	const res = await loadRepo({ owner: t.owner, repo: t.repo, force: false, m1Only: true, settings, api, session, nowIso: new Date().toISOString() });
	if (!res.ok) {
		if (res.error === "not-found") return fail("非公開か存在しない"); // M-116b
		if (res.error === "rate-limited") return fail(await limitReason(api)); // M-116c
		return fail("通信の失敗"); // M-116d
	}
	const text = await buildCopy(res.facts, settings.defaultFormat, settings.includeHeader, settings);
	if (typeof text !== "string" || text === "") return fail("通信の失敗");
	const written = await writeClipboard(text).catch(() => ({ ok: false }));
	if (!written.ok) return fail("書き込みの失敗"); // M-116e
	const missing = [];
	if (res.facts.lastCommit?.ok !== true) missing.push("最終コミット");
	if (res.facts.release?.ok !== true) missing.push("最新リリース");
	if (missing.length > 0) return ["partial", `コピーした。取れなかった項目: ${missing.join("・")}`]; // M-115
	return ["ok", settings.defaultFormat === "row" ? "コピーした(表の行)" : "コピーした(箇条)"]; // M-114 / M-113
}
