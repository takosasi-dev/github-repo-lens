// 公開点検のページ(SC-02)。開いたときは storage.local の checkup を出すだけで API を呼ばず、「点検し直す」で lens.js の runCheckup を呼ぶ。
// 返り値が ok のときだけ checkup を storage.local に書く(書くのはこのファイルのこの 1 か所)。C-8 の伏せ字は点検し直した直後の liveRows からだけ出す。
// DOM に文字を入れるのは textContent だけ(INV-4)。文言は画面設計書 §6 の M-xx のまま。
import { loadSettings } from "./settings.js";
import { createApi, chromeSession, rateView } from "./api.js";
import { runCheckup } from "./lens.js";
import { CHECK_DEFS, formatCheckupTable } from "./checks.js";
import { toLocalMinute, toLocalMdHm, toLocalHm } from "./localtime.js";

const DEFS = CHECK_DEFS.filter((d) => d.scope === "both");
const MARK = {
	pass: { sym: "○", cls: "mk-pass", label: "満たす" },
	fail: { sym: "×", cls: "mk-fail", label: "満たさない" },
	unknown: { sym: "?", cls: "mk-unk", label: "取れなかった" },
	na: { sym: "−", cls: "mk-na", label: "該当しない" },
};
const MAX_PATHS = 20;
const MSG_MS = 2000;

const $ = (id) => document.getElementById(id);
const off = (iso) => -new Date(iso).getTimezoneOffset();
const minute = (iso) => toLocalMinute(iso, off(iso));
const mdhm = (iso) => toLocalMdHm(iso, off(iso));
const hm = (ms) => {
	const iso = Number.isFinite(ms) ? new Date(ms).toISOString() : null;
	return iso && toLocalHm(iso, off(iso));
};
const repoName = (fullName) => fullName.slice(fullName.indexOf("/") + 1);

function el(tag, cls, text) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text != null) e.textContent = text;
	return e;
}
const icon = (name) => $("icons").content.querySelector(`[data-ic="${name}"]`).cloneNode(true);

const session = chromeSession();
const api = createApi({ session });
const state = {
	settings: null,
	checkup: null, // storage.local.checkup(または点検し直した結果)
	live: null, // 点検し直した直後の liveRows(保存しない)
	running: null, // { done, total, started: [fullName] }
	notes: [], // [{ kind: "info"|"wait"|"err", text }]
	open: new Map(), // fullName → 開いている C-n(1 行に 1 つ)
	focusKey: null,
};
let alive = true;
addEventListener("pagehide", () => {
	alive = false;
});

function markEl(result) {
	const m = MARK[result];
	const s = el("span", `mk ${m.cls}`, m.sym);
	s.setAttribute("role", "img");
	s.setAttribute("aria-label", m.label);
	return s;
}

// §3.3。remaining は数だけ太字
async function renderRate(target) {
	const v = rateView(await api.rate(), Date.now());
	target.replaceChildren();
	if (v.state !== "known") return void (target.textContent = "残り 不明"); // M-51
	target.append("残り ", el("span", "num", String(v.remaining)), " 回"); // M-48
	if (v.remaining === 0) target.append(el("span", "rate-back", `(${hm(v.resetMs)} ${v.guessed ? "までに戻る" : "に戻る"})`)); // M-49・M-50
}

async function resetHm() {
	const v = rateView(await api.rate(), Date.now());
	return v.state === "known" ? hm(v.resetMs) : null;
}

function renderNotes() {
	const box = $("notes");
	box.replaceChildren(
		...state.notes.map(({ kind, text }) => {
			const n = el("div", `note note-${kind}`);
			n.setAttribute("role", "status");
			const body = el("div", "note-body");
			body.append(el("p", null, text));
			n.append(icon({ info: "info", wait: "clock", err: "alert" }[kind]), body);
			return n;
		}),
	);
}

function renderSummary() {
	const r = state.running;
	$("whenLabel").textContent = r ? "点検中" : "前回の点検"; // M-07・M-82
	$("when").textContent = r ? `${r.done} / ${r.total} 件` : (state.checkup && minute(state.checkup.checkedAt)) || "なし"; // M-08・M-18
	$("run").disabled = !!r;
	$("copy").disabled = !!r || !state.checkup;
	const prog = $("prog");
	prog.hidden = !r;
	if (r) {
		prog.setAttribute("aria-valuemax", String(r.total));
		prog.setAttribute("aria-valuenow", String(r.done));
		prog.firstElementChild.style.width = r.total ? `${(r.done / r.total) * 100}%` : "0";
	}
}

// 理由の行の中身(§3.4)
function reasonBody(def, res, liveRes) {
	const body = el("div", "why-body");
	const list = (items, mono) => {
		const ul = el("ul", mono ? "paths mono" : "paths");
		ul.append(...items.slice(0, MAX_PATHS).map((p) => el("li", null, p)));
		body.append(ul);
		if (items.length > MAX_PATHS) body.append(el("p", null, `ほか ${items.length - MAX_PATHS} 件`)); // M-147
	};
	if (def.id === "C-8" && res.result === "fail") {
		if (liveRes?.emails) {
			for (const line of liveRes.emails) body.append(emailLine(line)); // M-148(完成した文)
		} else {
			body.append(el("p", null, res.reason)); // M-150
			body.append(el("p", "why-sub", "アドレスは保存していない。点検し直すか popup で見る")); // M-151
		}
	} else {
		for (const line of String(res.reason ?? "").split("\n")) if (line) body.append(el("p", null, line));
		if (res.paths) list(res.paths, true);
		if (res.findings) list(res.findings, false);
	}
	if (res.extra) body.append(el("p", "why-sub", res.extra)); // M-149
	return body;
}

// 「外れたアドレス: ta***@x.com(author 1件)」の伏せ字だけを等幅にする
function emailLine(line) {
	const p = el("p");
	const m = /^(外れたアドレス: )([^(]+)(\(.*)$/.exec(line);
	if (m) p.append(m[1], el("span", "mono", m[2]), m[3]);
	else p.textContent = line;
	return p;
}

function reasonRow(row, def, res, liveRes, rid) {
	const tr = el("tr", "reason");
	tr.id = rid;
	tr.dataset.repo = row.fullName;
	const td = el("td");
	td.colSpan = DEFS.length + 1;
	const box = el("div", `why-box ${res.result === "fail" ? "why-fail" : "why-unk"}`);
	const head = el("div", "why-head");
	const close = el("button", "lnk lnk-close", "閉じる"); // M-87
	close.type = "button";
	close.dataset.close = row.fullName;
	close.dataset.key = `close:${row.fullName}`;
	head.append(markEl(res.result), el("span", "mono why-repo", repoName(row.fullName)), el("span", "cid", def.id), el("span", null, def.label), close);
	box.append(head, reasonBody(def, res, liveRes));
	td.append(box);
	tr.append(td);
	return tr;
}

function repoCell(row, muted, spinning) {
	const th = el("th", muted ? "c-repo is-muted" : "c-repo");
	th.scope = "row";
	const name = repoName(row.fullName);
	if (typeof row.htmlUrl === "string" && row.htmlUrl.startsWith("https://github.com/")) {
		const a = el("a", "rname", name);
		a.href = row.htmlUrl;
		a.target = "_blank";
		a.rel = "noopener noreferrer";
		th.append(a);
	} else th.append(el("span", "rname", name));
	if (spinning) {
		const sp = el("span", "spin");
		sp.setAttribute("role", "img");
		sp.setAttribute("aria-label", "点検中"); // M-07
		th.append(sp);
	}
	if (row.archived) th.append(el("span", "tag", "アーカイブ済み")); // M-17
	if (row.stale && !state.running) th.append(el("span", "tag tag-prev", `前回(${mdhm(row.checkedAt) ?? ""})`)); // M-10
	return th;
}

function renderTable(untilHm) {
	const body = $("body");
	const rows = state.checkup?.rows ?? [];
	if (!state.running && !state.checkup) {
		const e = el("div", "empty");
		e.append(icon("table"), el("p", "empty-t", "前回の結果なし"), el("p", "empty-s", "『点検し直す』を押す")); // M-05・M-06
		return void body.replaceChildren(e);
	}
	if (!state.running && rows.length === 0) {
		const e = el("div", "empty");
		e.append(icon("table"), el("p", "empty-t", "点検する公開リポジトリが無い")); // M-14
		return void body.replaceChildren(e);
	}

	const table = el("table", "sheet");
	const cg = el("colgroup");
	cg.append(el("col", "c-repo"), ...DEFS.map(() => el("col", "c-chk")));
	const thead = el("thead");
	const htr = el("tr");
	const h0 = el("th", "c-repo", "リポジトリ"); // M-85
	h0.scope = "col";
	htr.append(h0);
	for (const d of DEFS) {
		const th = el("th", "c-chk");
		th.scope = "col";
		const hname = el("span", "hname");
		const m = /^([\x21-\x7e]+)([^\x00-\x7f].*)$/.exec(d.head + (d.outside ? "※" : "")); // M-86。「Actions危険※」は英字の後でだけ折る
		if (m) hname.append(m[1], el("wbr"), m[2]);
		else hname.textContent = d.head + (d.outside ? "※" : "");
		th.append(el("span", "hid", d.id), hname);
		htr.append(th);
	}
	thead.append(htr);
	const tbody = el("tbody");

	// 点検中: 終わった行は新しい記号、始まって終わっていない行は回転の印、まだの行は待ちの点(CK-16)
	const r = state.running;
	const startedSet = r ? new Set(r.started) : null;

	rows.forEach((row, i) => {
		const tr = el("tr", "row");
		if (r && !r.finished.has(row.fullName)) {
			tr.append(repoCell(row, !startedSet.has(row.fullName), startedSet.has(row.fullName)));
			for (let j = 0; j < DEFS.length; j++) {
				const td = el("td", "c-chk");
				const w = el("span", "mk mk-wait");
				w.setAttribute("aria-hidden", "true");
				td.append(w);
				tr.append(td);
			}
			return void tbody.append(tr);
		}
		const results = r ? r.finished.get(row.fullName) : row.results;
		if (DEFS.some((d) => results?.[d.id]?.result === "fail")) tr.classList.add("has-fail");
		if (row.stale) tr.classList.add("is-prev");
		tr.append(repoCell(row, false, false));
		if (!results) {
			const td = el("td", "c-none");
			td.colSpan = DEFS.length;
			const s = el("span");
			s.append(icon("clock"), untilHm ? `未点検(${untilHm} 以降に再開)` : "未点検"); // M-11
			td.append(s);
			tr.append(td);
			return void tbody.append(tr);
		}
		const openId = state.open.get(row.fullName);
		const rid = `rsn-${i}`;
		for (const d of DEFS) {
			const td = el("td", "c-chk");
			const res = results[d.id];
			if (res && MARK[res.result]) {
				if (res.result === "fail" || res.result === "unknown") {
					const b = el("button", "cell-btn");
					b.type = "button";
					const isOpen = openId === d.id;
					if (isOpen) b.classList.add("is-open");
					b.setAttribute("aria-expanded", String(isOpen));
					b.setAttribute("aria-controls", rid);
					b.setAttribute("aria-label", `${repoName(row.fullName)} ${d.id} ${MARK[res.result].label}。理由を開く`);
					b.dataset.repo = row.fullName;
					b.dataset.check = d.id;
					b.dataset.key = `cell:${row.fullName}:${d.id}`;
					b.append(markEl(res.result));
					td.append(b);
				} else {
					if (res.extra) td.title = res.extra; // ○・− の理由(C-4 の spdx_id・M-149・− の理由)
					td.append(markEl(res.result));
				}
			}
			tr.append(td);
		}
		tbody.append(tr);
		const def = DEFS.find((d) => d.id === openId);
		const res = def && results[def.id];
		if (res && (res.result === "fail" || res.result === "unknown")) tbody.append(reasonRow(row, def, res, state.live?.[row.fullName], rid));
	});

	table.append(cg, thead, tbody);
	const wrap = el("div", "sheet-wrap");
	wrap.append(table);
	body.replaceChildren(wrap);
	if (state.focusKey) {
		body.querySelector(`[data-key="${CSS.escape(state.focusKey)}"]`)?.focus();
		state.focusKey = null;
	}
}

async function render() {
	renderSummary();
	renderNotes();
	const needHm = state.checkup?.rows?.some((r) => !r.results);
	renderTable(needHm ? await resetHm() : null);
	await renderRate($("rate"));
}

function toggle(repo, check, focusKey) {
	if (state.open.get(repo) === check) state.open.delete(repo);
	else state.open.set(repo, check);
	state.focusKey = focusKey;
	render();
}

function closeReason(repo) {
	const check = state.open.get(repo);
	state.open.delete(repo);
	state.focusKey = `cell:${repo}:${check}`;
	render();
}

async function runAgain() {
	const settings = state.settings;
	state.notes = [];
	state.open.clear();
	state.running = { done: 0, total: 0, started: [], finished: new Map() };
	render();
	const res = await runCheckup({
		settings,
		api,
		session,
		nowIso: new Date().toISOString(),
		prev: state.checkup,
		onProgress: ({ done, total, current, finished, results }) => {
			const r = state.running;
			if (!r) return;
			r.done = done;
			r.total = total;
			if (current && !r.started.includes(current)) r.started.push(current);
			if (finished) r.finished.set(finished, results);
			render();
		},
		isAlive: () => alive,
	});
	state.running = null;
	if (res.ok) {
		if (!alive) return;
		await chrome.storage.local.set({ checkup: res.checkup });
		state.checkup = res.checkup;
		state.live = res.liveRows;
		if (res.k < res.n) state.notes.push({ kind: "wait", text: `API の上限で ${res.k} / ${res.n} 件だけ点検した。残りは ${(await resetHm()) ?? ""} 以降に点検し直す` }); // M-12
		if (res.hasMore) state.notes.push({ kind: "info", text: "101件目以降は点検しない" }); // M-13
	} else if (res.error === "closed") {
		return;
	} else if (res.error === "locked") {
		state.notes.push({ kind: "info", text: "別のタブで点検中" }); // M-09
	} else if (res.error === "rate-limited") {
		state.notes.push({ kind: "wait", text: `API の上限。${hm(res.reset) ?? ""} 以降にもう一度` }); // M-21
	} else if (res.error === "not-found") {
		state.notes.push({ kind: "err", text: `ユーザー ${settings.ownerLogin} が GitHub に無い。設定のユーザー名を確かめる` }); // M-24
	} else {
		state.notes.push({ kind: "err", text: `GitHub に繋がらない(${res.reason})` }); // M-23
	}
	render();
}

let msgTimer = null;
async function copyTable() {
	const c = state.checkup;
	const text = formatCheckupTable(c.rows, { checkedLocal: minute(c.checkedAt) ?? "", mdhm });
	const msg = $("copyMsg");
	let ok = true;
	try {
		await navigator.clipboard.writeText(text); // INV-10: 1 回だけ
	} catch {
		ok = false;
	}
	msg.className = `copy-msg ${ok ? "is-ok" : "is-ng"}`;
	msg.replaceChildren(icon(ok ? "check" : "alert"), el("span", null, ok ? "コピーした" : "コピーできなかった(書き込みの失敗)")); // M-43・M-25・M-25a
	clearTimeout(msgTimer);
	msgTimer = setTimeout(() => msg.replaceChildren(), MSG_MS);
}

async function main() {
	const [{ settings }, stored] = await Promise.all([loadSettings(), chrome.storage.local.get("checkup")]);
	state.settings = settings;
	$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage()); // FR-16
	if (!settings.ownerLogin) {
		$("noLogin").hidden = false; // SC-02-S6
		return;
	}
	$("main").hidden = false;
	$("login").textContent = settings.ownerLogin;
	state.checkup = stored.checkup ?? null;
	$("run").addEventListener("click", runAgain);
	$("copy").addEventListener("click", copyTable);
	const body = $("body");
	body.addEventListener("click", (e) => {
		const cell = e.target.closest("button[data-check]");
		if (cell) return toggle(cell.dataset.repo, cell.dataset.check, cell.dataset.key);
		const close = e.target.closest("button[data-close]");
		if (close) closeReason(close.dataset.close);
	});
	body.addEventListener("keydown", (e) => {
		const tr = e.key === "Escape" && e.target.closest("tr.reason");
		if (tr) {
			e.preventDefault();
			closeReason(tr.dataset.repo);
		}
	});
	await render();
}

main();
