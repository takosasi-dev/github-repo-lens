// popup の描画(画面設計書 SC-01)。popup.js が作った「状態」から DOM を作り直す。通信と拡張の API は使わない。
// 文字は textContent だけで入れる(INV-4)。前半は DOM を使わない純関数で、tests/popup.test.js が呼ぶ。
// 画面の文字は画面設計書 §6 の M-xx と INTERFACES.md §4 の文のまま(行末のコメントが番号)。
import { CHECK_DEFS } from "./checks.js";
import { toLocalMinute, toLocalDate, toLocalHm, daysAgo } from "./localtime.js";

export const LIST_MAX = 20; // 理由の欄に出すパス・当てはまる所の数(§3.4)
const HOMEPAGE_RE = /^https?:\/\/[^\s<>|\[\]()]+$/; // 仕様書 §9.3 (e)
const OUTSIDE = "【ルール外】";
const MISS = { t: "(取れなかった)", cls: "miss" }; // M-68
const MARK = {
	pass: ["○", "mk-pass", "満たす"],
	fail: ["×", "mk-fail", "満たさない"],
	unknown: ["?", "mk-unk", "取れなかった"],
	na: ["−", "mk-na", "該当しない"],
};

// ---------------------------------------------------------------- 純関数

export const offsetOf = (iso) => -new Date(iso).getTimezoneOffset();

// epoch ミリ秒 → "HH:mm"(PC のローカル時刻)| null
export function hmOf(ms) {
	if (!Number.isFinite(ms)) return null;
	const iso = new Date(ms).toISOString();
	return toLocalHm(iso, offsetOf(iso));
}

// list を max 件で切る。rest は切った件数(M-147 の n)
export function cutList(list, max = LIST_MAX) {
	return { shown: list.slice(0, max), rest: Math.max(0, list.length - max) };
}

// api.rateView の結果 → 残り回数の文の部品(§3.3)。num: true の部品だけ太字
export function rateParts(view, hm = hmOf) {
	if (view?.state !== "known") return [{ t: "残り 不明" }]; // M-51
	if (view.remaining > 0) return [{ t: "残り " }, { t: String(view.remaining), num: true }, { t: " 回" }]; // M-48
	const at = hm(view.resetMs);
	return [{ t: "残り " }, { t: "0", num: true }, { t: view.guessed ? ` 回(${at} までに戻る)` : ` 回(${at} に戻る)` }]; // M-50 / M-49
}

// loadRepo の ok: false → 案内の枠 { tone: info|wait|err, text, retry }
export function errorNote(res, hm = hmOf) {
	if (res.error === "not-found") return { tone: "info", text: "非公開か、存在しないリポジトリ。RepoLens は公開リポジトリだけ扱う" }; // M-20
	if (res.error === "rate-limited") {
		const at = res.reset != null ? hm(res.reset) : null;
		return { tone: "wait", text: at ? `API の上限。${at} 以降にもう一度` : "API の上限" }; // M-21(時刻が分からなければ理由の言葉だけ)
	}
	if (res.error === "forbidden") return { tone: "err", text: res.reason || "GitHub が断った(403)", retry: true }; // M-23d
	return { tone: "err", text: `GitHub に繋がらない(${res.reason || "通信の失敗"})`, retry: true }; // M-23(理由は M-23a〜c・e)
}

// 公開点検の 2 段目が上限(PU-11)
export function checkLimitText(stage, hm = hmOf) {
	const at = stage?.reset != null ? hm(stage.reset) : null;
	return at ? `API の上限のため点検しない(${at} 以降)` : "API の上限のため点検しない"; // M-22
}

function commitParts(f, off) {
	const c = f.lastCommit;
	if (c?.ok && c.none) return [{ t: "(コミットなし)" }]; // M-67
	const date = c?.ok ? toLocalDate(c.iso, off) : null;
	const days = c?.ok ? daysAgo(c.iso, f.fetchedIso) : null;
	if (date === null || days === null) return [MISS];
	return [{ t: date, cls: "num" }, { t: `(${days}日前・${f.defaultBranch})`, cls: "sub" }]; // M-70
}

function releaseParts(f, off) {
	const r = f.release;
	if (r?.ok && r.none) return [{ t: "なし" }]; // M-65
	const date = r?.ok ? toLocalDate(r.iso, off) : null;
	return date === null ? [MISS] : [{ t: String(r.tag) }, { t: `(${date})`, cls: "sub" }]; // M-71
}

// facts → 事実の表の行 [{ label, parts: [{ t, cls }], href? }](PU-03。仕様書 §9.3 (a) の順と定型。値の無い行は出さない)
export function factRows(f, off) {
	const rows = [];
	const add = (label, ...parts) => rows.push({ label, parts });
	add("説明", { t: f.description == null || f.description.trim() === "" ? "(説明なし)" : f.description }); // M-53 / M-64
	add("スター", { t: String(f.stars), cls: "num" });
	add("フォーク", { t: String(f.forks), cls: "num" });
	const spdx = f.license?.spdx;
	add("ライセンス", { t: !spdx ? "なし" : spdx === "NOASSERTION" ? "不明(GitHub が判別できない)" : spdx }); // M-65 / M-66
	if (f.language != null && f.language !== "") add("言語", { t: f.language });
	if (f.topics?.length) add("トピック", { t: f.topics.join(", ") });
	add("最終コミット", ...commitParts(f, off));
	add("最新リリース", ...releaseParts(f, off));
	const st = [];
	if (f.archived) st.push("アーカイブ済み"); // M-72
	if (f.fork) st.push(f.parent ? `フォーク(元: ${f.parent})` : "フォーク"); // M-73
	if (st.length) add("状態", { t: st.join("・") });
	const home = String(f.homepage ?? "").trim();
	if (home && HOMEPAGE_RE.test(home)) rows.push({ label: "ホームページ", parts: [{ t: home }], href: home });
	else if (home) add("ホームページ", { t: "(http・https の URL でないので出さない)" }); // M-69
	const got = toLocalMinute(f.fetchedIso, off);
	add("取得", got ? { t: got, cls: "num" } : MISS); // PU-03b(「(RepoLens)」は付けない)
	return rows;
}

// × と ? の理由の欄の中身 [{ t, sub? } | { paths }](§3.4)
export function whyItems(r) {
	const out = [];
	if (r.reason) out.push({ t: r.reason });
	if (r.paths?.length) {
		const { shown, rest } = cutList(r.paths);
		out.push({ paths: shown });
		if (rest) out.push({ t: `ほか ${rest} 件` }); // M-147
	}
	for (const e of r.emails ?? []) out.push({ t: e }); // M-148(完成した文)
	if (r.findings?.length) {
		const { shown, rest } = cutList(r.findings);
		for (const x of shown) out.push({ t: x });
		if (rest) out.push({ t: `ほか ${rest} 件` }); // M-147 の形
	}
	if (r.extra) out.push({ t: r.extra, sub: true }); // C-8 の × の M-149
	return out;
}

// runChecks の結果 → 公開点検の行(PU-09。CHECK_DEFS の scope popup・both の全部)
export function checkRows(checks) {
	return CHECK_DEFS.filter((d) => d.scope !== "list").map((d) => {
		const r = checks?.[d.id] ?? { result: "unknown" }; // 無い結果を ○ にしない(INV-7)
		const result = MARK[r.result] ? r.result : "unknown";
		const name = d.outside && d.label.endsWith(OUTSIDE) ? d.label.slice(0, -OUTSIDE.length) : d.label;
		const row = { id: d.id, name, outside: d.outside, result, aside: null, sub: null, why: null };
		if (result === "fail" || result === "unknown") row.why = whyItems(r);
		else if (r.extra && d.id === "C-4" && result === "pass") row.aside = r.extra; // M-144
		else if (r.extra) row.sub = r.extra; // − の理由・M-149・M-153
		return row;
	});
}

// ---------------------------------------------------------------- DOM

function el(tag, cls, text) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text != null) e.textContent = text;
	return e;
}

function kids(e, ...nodes) {
	e.append(...nodes.filter(Boolean));
	return e;
}

const icon = (name) => document.getElementById(`ic-${name}`).content.firstElementChild.cloneNode(true);
const textSpans = (parent, parts) => kids(parent, ...parts.map((p) => el("span", p.cls ?? null, p.t)));

function button(cls, onClick) {
	const b = el("button", cls);
	b.type = "button";
	b.addEventListener("click", () => onClick());
	return b;
}

function link(cls, href, ...nodes) {
	const a = kids(el("a", cls), ...nodes);
	a.href = href;
	a.target = "_blank";
	a.rel = "noopener noreferrer";
	return a;
}

function titleParts(owner, repo) {
	return [el("span", "o", owner), el("span", "sl", "/"), el("span", "r", repo)];
}

// PU-01(と PU-02)
function repoHead(f, savedAt) {
	const head = el("header", "pu-head");
	const h1 = el("h1", "pu-title");
	const cut = f.fullName.indexOf("/");
	const parts = titleParts(f.fullName.slice(0, cut), f.fullName.slice(cut + 1));
	if (typeof f.htmlUrl === "string" && f.htmlUrl.startsWith("https://github.com/")) h1.append(link("pu-repo", f.htmlUrl, ...parts, icon("ext")));
	else kids(h1, ...parts).classList.add("pu-title--url");
	head.append(h1);
	if (savedAt != null) head.append(kids(el("p", "pu-stale"), icon("clock"), el("span", null, `${hmOf(savedAt)} 時点の値`))); // M-03
	return head;
}

// PU-16
function urlHead(target) {
	return kids(el("header", "pu-head"), kids(el("h1", "pu-title pu-title--url"), ...titleParts(target.owner, target.repo)));
}

const NOTE_ICON = { info: "info", wait: "clock", err: "warn" };

// CM-01。retry は PU-15、settings は PU-17
function note(n, actions) {
	const box = el("div", `note note-${n.tone}`);
	box.setAttribute("role", "status");
	const body = kids(el("div", "note-body"), el("p", null, n.text));
	if (n.retry) body.append(kids(button("btn btn-tonal btn-sm", actions.retry), icon("reload"), el("span", null, "もう一度"))); // M-47
	if (n.settings) body.append(kids(button("lnk lnk-inline", actions.openOptions), icon("gear"), el("span", null, "設定を開く"))); // M-52
	return kids(box, icon(NOTE_ICON[n.tone]), body);
}

function section(cls, label) {
	const s = el("section", cls);
	s.setAttribute("aria-label", label);
	return s;
}

// PU-03
function factsEl(f) {
	const tbody = el("tbody");
	for (const row of factRows(f, offsetOf(f.fetchedIso))) {
		const th = el("th", null, row.label);
		th.scope = "row";
		const td = el("td");
		if (row.href) td.append(link(null, row.href, el("span", null, row.parts[0].t)));
		else textSpans(td, row.parts);
		tbody.append(kids(el("tr"), th, td));
	}
	return kids(section("pu-facts", "事実"), kids(el("table", "facts"), tbody));
}

const SKELETON = [["説明", 170], ["スター", 40], ["フォーク", 28], ["ライセンス", 40], ["言語", 56], ["トピック", 110], ["最終コミット", 150], ["最新リリース", 120], ["取得", 112]];

// SC-01-S1 の事実の欄(名前だけ出し、値の位置に灰色の帯)
function skeletonEl() {
	const tbody = el("tbody");
	for (const [label, w] of SKELETON) {
		const th = el("th", null, label);
		th.scope = "row";
		const bar = el("span", "skel");
		bar.style.width = `${w}px`;
		tbody.append(kids(el("tr"), th, kids(el("td"), bar)));
	}
	return kids(section("pu-facts", "事実"), kids(el("table", "facts"), tbody));
}

// PU-04〜PU-07。文字は押す前に作ってある(copies)。押した操作の中で actions.copy を 1 回だけ呼ぶ(INV-10)
function copyEl(state, actions) {
	const c = state.copies ?? {};
	const msg = el("p", "copy-msg");
	msg.setAttribute("role", "status");
	const box = el("input");
	box.type = "checkbox";
	box.checked = !!state.includeHeader; // PU-06 の初期値。変えても保存しない
	let timer = null;
	const show = (ok, text) => {
		clearTimeout(timer);
		msg.className = `copy-msg ${ok ? "is-ok" : "is-ng"}`;
		msg.replaceChildren(icon(ok ? "check" : "warn"), el("span", null, text));
		timer = setTimeout(() => {
			msg.className = "copy-msg";
			msg.replaceChildren();
		}, 2000);
	};
	const NG = "コピーできなかった(書き込みの失敗)"; // M-25 / M-25a
	const copy = (text) => {
		if (typeof text !== "string" || text === "") return show(false, NG);
		actions.copy(text).then(() => show(true, "コピーした"), () => show(false, NG)); // M-43
	};
	const grid = kids(
		el("div", "copy-grid"),
		kids(button("btn btn-tonal", () => copy(c.bullet)), icon("bullet"), el("span", null, "箇条でコピー")), // M-40
		kids(button("btn btn-tonal", () => copy(box.checked ? c.rowHeader : c.row)), icon("row"), el("span", null, "表の行でコピー")), // M-41
		msg,
		kids(el("label", "chk"), box, el("span", null, "見出し行もつける")), // M-42
	);
	return kids(section("pu-copy", "コピー"), grid);
}

function markEl(result) {
	const [sym, cls, label] = MARK[result];
	const m = el("span", `mk ${cls}`, sym);
	m.setAttribute("role", "img");
	m.setAttribute("aria-label", label);
	return m;
}

function whyEl(id, items) {
	const box = el("div", "ck-why");
	box.id = id;
	box.hidden = true;
	for (const it of items) {
		if (it.paths) box.append(kids(el("ul", "paths"), ...it.paths.map((p) => el("li", null, p))));
		else box.append(el("p", it.sub ? "why-sub" : null, it.t));
	}
	return box;
}

// PU-08〜PU-10(点検あり)・PU-11(2段目が上限)
function checkEl(shown) {
	const sec = kids(section("pu-check", "公開点検"), el("h2", "pu-h", "公開点検")); // M-44
	if (shown.checkStage?.kind === "rate-limited") return kids(sec, note({ tone: "wait", text: checkLimitText(shown.checkStage) }));
	if (shown.checkStage !== "done" || !shown.checks) return null;
	const ul = el("ul", "ck-list");
	for (const row of checkRows(shown.checks)) {
		const li = el("li", "ck");
		const ctx = el("span", "ctx", row.name);
		if (row.outside) ctx.append(el("span", "out", OUTSIDE));
		if (row.sub) ctx.append(el("span", "ck-sub", row.sub));
		if (row.why) {
			const id = `why-${row.id}`;
			const why = whyEl(id, row.why);
			const btn = button("ck-line ck-btn", () => {
				const open = why.hidden;
				why.hidden = !open;
				btn.setAttribute("aria-expanded", String(open));
				li.classList.toggle("is-open", open);
			});
			btn.setAttribute("aria-expanded", "false");
			btn.setAttribute("aria-controls", id);
			li.append(kids(btn, markEl(row.result), el("span", "cid", row.id), ctx, icon("chev")), why);
		} else {
			li.append(kids(el("div", "ck-line"), markEl(row.result), el("span", "cid", row.id), ctx, row.aside && el("span", "ck-aside", row.aside)));
		}
		ul.append(li);
	}
	return kids(sec, ul);
}

function checkupButton(cls, actions) {
	return kids(button(cls, actions.openCheckup), icon("list"), el("span", null, "自分のリポジトリを一覧で点検"), icon("ext")); // M-45
}

// PU-12〜PU-14。両方あれば 2 行、片方なら 1 行
function footer(state, actions, withRefresh) {
	const list = state.ownerLogin ? checkupButton("lnk", actions) : null;
	const refresh = withRefresh ? kids(button("lnk", actions.refresh), icon("reload"), el("span", null, "最新の値を取る")) : null; // M-46
	const rate = textSpans(el("span", "rate"), rateParts(state.rate).map((p) => ({ t: p.t, cls: p.num ? "num" : null })));
	const foot = el("footer", "pu-foot");
	if (list && refresh) return kids(foot, list, kids(el("div", "foot-row"), refresh, rate));
	return kids(foot, kids(el("div", "foot-row"), list ?? refresh, rate));
}

// state: { kind: "not-repo" | "loading" | "result", target, ownerLogin, includeHeader, rate, res, copies }
// actions: { copy(text) → Promise, refresh(), retry(), openOptions(), openCheckup() }
export function render(root, state, actions) {
	root.replaceChildren();
	if (state.kind === "not-repo") { // SC-01-S6。残り回数は出さない(FR-1・FR-11)
		const box = kids(el("div", "pu-empty"), kids(el("p", "pu-msg"), icon("info"), el("span", null, "リポジトリのページで開く"))); // M-02
		if (state.ownerLogin) box.append(checkupButton("btn btn-tonal btn-block", actions));
		root.append(box);
		return;
	}
	if (state.kind === "loading") { // SC-01-S1
		const spin = el("span", "spin");
		spin.setAttribute("aria-hidden", "true");
		const head = kids(el("header", "pu-head"), kids(el("p", "pu-loading"), spin, el("span", null, "取得中"))); // M-01
		root.append(head, skeletonEl(), footer(state, actions, false));
		return;
	}
	const res = state.res;
	const shown = res.ok ? res : res.cache;
	if (!shown) { // SC-01-S7・S9・S10
		root.append(urlHead(state.target), note(errorNote(res), actions), footer(state, actions, false));
		return;
	}
	root.append(repoHead(shown.facts, shown.fromCache ? shown.savedAt : null)); // S2〜S5・S8・S11〜S13
	if (!res.ok) root.append(note(errorNote(res), actions)); // S8(写しの上に上限などの枠)
	root.append(factsEl(shown.facts), copyEl(state, actions));
	if (!state.ownerLogin) root.append(note({ tone: "info", text: "設定でユーザー名を入れると公開点検が使える", settings: true }, actions)); // S13 / M-04
	else if (shown.own) {
		const chk = checkEl(shown);
		if (chk) root.append(chk);
	}
	root.append(footer(state, actions, true));
}
