// popup の入口(画面設計書 SC-01)。タブの URL を読み、lens.loadRepo で事実と点検を取り、popup-view.js の render で描く。
// コピーの文字は描く前に作っておき、ボタンを押した操作の中では writeText を 1 回呼ぶだけにする(INV-10)。
// 通信は lens.js → api.js に任せ、ここには書かない(INV-2)。自動の再試行はしない(INV-6)。
import { parseRepoUrl } from "./repo-url.js";
import { loadRepo, buildCopy } from "./lens.js";
import { createApi, chromeSession, rateView } from "./api.js";
import { loadSettings } from "./settings.js";
import { render } from "./popup-view.js";

const root = document.getElementById("app");
const session = chromeSession();
const api = createApi({ session });
let settings;
let target = null;
let lastForce = false;

const actions = {
	copy: (text) => navigator.clipboard.writeText(text),
	refresh: () => load(true), // FR-14
	retry: () => load(lastForce), // PU-15。押したときだけ呼ぶ
	openOptions: () => chrome.runtime.openOptionsPage(),
	openCheckup: () => chrome.tabs.create({ url: chrome.runtime.getURL("checkup.html") }),
};

const rateNow = async () => rateView(await api.rate(), Date.now());

function draw(kind, more) {
	render(root, { kind, target, ownerLogin: settings.ownerLogin, includeHeader: settings.includeHeader, ...more }, actions);
}

// 3 つの形を先に作る。作れなければ null(押しても書かない)
async function makeCopies(facts) {
	try {
		const [bullet, row, rowHeader] = await Promise.all([
			buildCopy(facts, "bullet", false, settings),
			buildCopy(facts, "row", false, settings),
			buildCopy(facts, "row", true, settings),
		]);
		return { bullet, row, rowHeader };
	} catch {
		return null;
	}
}

async function load(force) {
	lastForce = force;
	draw("loading", { rate: await rateNow() });
	let res;
	try {
		res = await loadRepo({ owner: target.owner, repo: target.repo, force, settings, api, session, nowIso: new Date().toISOString() });
	} catch {
		res = { ok: false, error: "network", reason: "通信の失敗", cache: null };
	}
	const shown = res.ok ? res : res.cache;
	const copies = shown ? await makeCopies(shown.facts) : null;
	draw("result", { res, copies, rate: await rateNow() });
}

async function main() {
	({ settings } = await loadSettings());
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	target = parseRepoUrl(tab?.url ?? "");
	if (!target) return draw("not-repo", {}); // SC-01-S6。API を呼ばない
	await load(false);
}

main();
