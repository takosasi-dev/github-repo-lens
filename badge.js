// ショートカットの結果をアイコンのバッジと tooltip に出す(仕様書 §9.8 (c)・画面設計書 §4.4)。どれも tabId を付けてそのタブだけに出す。
// 2 秒後にバッジを消し、tooltip を M-112「RepoLens」に戻す。タブが閉じられていて出せないときは何もしない。
const COLORS = { ok: "#2e7d32", partial: "#ef6c00", error: "#c62828" };
export const IDLE_TITLE = "RepoLens"; // M-112(manifest の default_title と同じ)
const CLEAR_MS = 2000;
// tabId → 消すタイマー。続けて出すとき前のタイマーを取り消す(前の分で新しいバッジが早く消えないように)
const clearTimers = new Map();

// kind: "ok" | "partial" | "error"。title は tooltip の文(M-113〜M-116)
export async function showResult(tabId, kind, title) {
	if (typeof tabId !== "number" || tabId < 0) return; // tabId なしで出すと全部のタブに効いてしまう
	try {
		await chrome.action.setBadgeBackgroundColor({ tabId, color: COLORS[kind] });
		await chrome.action.setBadgeText({ tabId, text: kind === "error" ? "ERR" : "OK" });
		await chrome.action.setTitle({ tabId, title });
		clearTimeout(clearTimers.get(tabId));
		clearTimers.set(
			tabId,
			setTimeout(() => {
				clearTimers.delete(tabId);
				chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
				chrome.action.setTitle({ tabId, title: IDLE_TITLE }).catch(() => {});
			}, CLEAR_MS),
		);
	} catch {
		// タブが閉じられた
	}
}
