// service worker から受けた文字を textarea の value に入れ、select() と execCommand('copy') でクリップボードに書く(PostClip と同じ)。
// target が違う通信と、自分の拡張でない送り手からの通信は無視する。書いた後は textarea を空にする。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (sender.id !== chrome.runtime.id || msg?.target !== "repolens-offscreen" || msg.type !== "copy") return;
	const buffer = document.getElementById("buffer");
	buffer.value = String(msg.text);
	buffer.select();
	let ok = false;
	try {
		ok = document.execCommand("copy");
	} catch {
		ok = false;
	}
	buffer.value = "";
	sendResponse(ok ? { ok: true } : { ok: false, error: "copy-failed" });
});
