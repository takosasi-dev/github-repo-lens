// api.github.com への GET だけを持つ層(仕様書 §9.2 (a)〜(c))。通信はここの 1 か所だけ。
// 残り回数を storage.session の rate に写し、呼ぶ前に足りるかを見積もる。自動の再試行はしない。
// ほかに一覧の件数の計算(planList)・残りの表示の材料(rateView)・base64 の UTF-8 読み(decodeBase64Utf8)。

const TIMEOUT_MS = 10000;
const GUESS_RESET_MS = 3600000; // x-ratelimit-reset が読めないとき seenAt + 1 時間を reset とみなす(Q-12)

function reasonOf(kind, status, timedOut) {
	switch (kind) {
		case "network": return timedOut ? "時間切れ(10秒)" : "通信の失敗"; // M-23e / M-23a
		case "bad-json": return "応答を読めない"; // M-23b
		case "rate-limited": return "API の上限";
		case "forbidden": return `GitHub が断った(${status})`; // M-23d
		default: return String(status); // M-23c(server)。not-found・empty も状態コード
	}
}

function kindOf(status, remaining) {
	if (status === 404) return "not-found";
	if (status === 409) return "empty";
	if (status === 429 || (status === 403 && remaining === 0)) return "rate-limited";
	if (status >= 500) return "server";
	return "forbidden"; // 上限以外の 403 と、ほかの 4xx
}

function intHeader(headers, name) {
	const v = headers.get(name);
	return v !== null && /^\d+$/.test(v.trim()) ? Number(v) : null;
}

export function createApi({ fetchImpl = (...a) => fetch(...a), now = () => Date.now(), session }) {
	async function rate() {
		return (await session.get("rate")) ?? null;
	}

	// limited: 429 で残りのヘッダが無いとき。残り 0・1 時間後の見込みとして書き、同じ操作で呼ばないようにする(INV-6)
	async function saveRate(headers, limited = false) {
		const remaining = intHeader(headers, "x-ratelimit-remaining") ?? (limited ? 0 : null);
		if (remaining === null) return; // 読めない値は書かない
		const seenAt = now();
		const resetSec = intHeader(headers, "x-ratelimit-reset");
		const value = resetSec === null
			? { remaining, reset: seenAt + GUESS_RESET_MS, seenAt, guessed: true }
			: { remaining, reset: resetSec * 1000, seenAt, guessed: false };
		await session.set({ rate: value });
	}

	async function getJson(path) {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
		let res, text;
		try {
			res = await fetchImpl("https://api.github.com" + path, {
				method: "GET",
				credentials: "omit",
				headers: { Accept: "application/vnd.github+json" },
				signal: ctrl.signal,
			});
			text = await res.text();
		} catch {
			const timedOut = ctrl.signal.aborted;
			if (res) await saveRate(res.headers);
			return { ok: false, status: res ? res.status : 0, kind: "network", reason: reasonOf("network", 0, timedOut) };
		} finally {
			clearTimeout(timer);
		}
		await saveRate(res.headers, res.status === 429);
		if (!res.ok) {
			const kind = kindOf(res.status, intHeader(res.headers, "x-ratelimit-remaining"));
			return { ok: false, status: res.status, kind, reason: reasonOf(kind, res.status) };
		}
		try {
			return { ok: true, status: res.status, data: JSON.parse(text), link: res.headers.get("link") };
		} catch {
			return { ok: false, status: res.status, kind: "bad-json", reason: reasonOf("bad-json") };
		}
	}

	// n 回を呼んでよいか(INV-6)。rate が無いか reset を過ぎていれば「不明」で呼んでよい
	async function estimate(n) {
		const r = await rate();
		if (!r || !(r.reset > now()) || r.remaining >= n) return { ok: true };
		return { ok: false, kind: "rate-limited", reset: r.reset, guessed: !!r.guessed };
	}

	return { getJson, estimate, rate };
}

// AC-24。remaining は一覧の呼び出しの後の残り
export function planList(remaining, n, userCached) {
	const left = remaining - (userCached ? 0 : 1);
	return Math.max(0, Math.min(n, Math.floor(left / 2)));
}

export function rateView(rate, nowMs) {
	if (!rate || !(rate.reset > nowMs)) return { state: "unknown" };
	return { state: "known", remaining: rate.remaining, resetMs: rate.reset, guessed: !!rate.guessed };
}

// atob の結果はバイト列なので、そのまま使うと日本語が化ける。TextDecoder で読む(読めない所は U+FFFD)
export function decodeBase64Utf8(content) {
	const bin = atob(String(content).replace(/\s+/g, ""));
	return new TextDecoder("utf-8").decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function chromeSession() {
	const s = chrome.storage.session;
	return {
		get: async (key) => (await s.get(key))[key],
		set: (obj) => s.set(obj),
		remove: (key) => s.remove(key),
	};
}
