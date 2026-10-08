// service worker 用のクリップボード。offscreen 文書(reason CLIPBOARD)を用意し、文字を渡して書かせる(PostClip と同じ作り)。
// 文書の作成は 1 つの Promise で直列にし、既にあれば作らずに使う(続けて 2 回押しても 2 回とも書く)。
const OFFSCREEN_URL = "offscreen.html";
let creating = null;

async function ensureOffscreen() {
	const contexts = await chrome.runtime.getContexts({
		contextTypes: ["OFFSCREEN_DOCUMENT"],
		documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
	});
	if (contexts.length > 0) return;
	creating ??= chrome.offscreen
		.createDocument({ url: OFFSCREEN_URL, reasons: ["CLIPBOARD"], justification: "write the repository facts to the clipboard" })
		.finally(() => {
			creating = null;
		});
	await creating;
}

// → { ok: true } | { ok: false, error }。失敗したらクリップボードは前の中身のまま(INV-10)
export async function writeClipboard(text) {
	await ensureOffscreen();
	const res = await chrome.runtime.sendMessage({ target: "repolens-offscreen", type: "copy", text });
	return res?.ok === true ? res : { ok: false, error: res?.error ?? "no-response" };
}
