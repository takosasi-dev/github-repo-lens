// 自分の公開リポジトリをルールで点検する純関数(仕様書 §9.4・INTERFACES.md §2.5・§4)。理由の文は画面設計書 §6.5 を差し込み済みで返す。
// メールアドレスは伏せ字にしてからこのファイルの外へ出す(INV-8)。Actions の中身の読み取りは actions.js に任せる。
import { isWorkflowPath, auditWorkflow, ACTIONS_MAX_FILES } from "./actions.js";
import { formatSourceLine } from "./format.js";

export const CHECKS_VERSION = 1;

// 一覧の列・popup の行・コピーの見出しはここから作る(非機能 X-2)。C-9・C-10 は一覧に出ないので head が無い
export const CHECK_DEFS = [
	{ id: "C-1", label: "名前が半角英数とハイフンだけ", head: "名前", scope: "both", outside: false },
	{ id: "C-2", label: "名前が小文字", head: "小文字", scope: "both", outside: false },
	{ id: "C-3", label: "README がある", head: "README", scope: "both", outside: false },
	{ id: "C-4", label: "LICENSE がある", head: "LICENSE", scope: "both", outside: false },
	{ id: "C-5", label: ".gitignore がある", head: ".gitignore", scope: "both", outside: false },
	{ id: "C-6", label: "ビルド成果物・不要物が無い", head: "不要物", scope: "both", outside: false },
	{ id: "C-7", label: ".env が無い", head: ".env", scope: "both", outside: false },
	{ id: "C-8", label: "コミットのアドレスが許可した物だけ", head: "アドレス", scope: "both", outside: false },
	{ id: "C-9", label: "README に必要な見出しがある", head: null, scope: "popup", outside: false },
	{ id: "C-10", label: "README にライセンスの名前が書いてある", head: null, scope: "popup", outside: false },
	{ id: "C-11", label: "説明文(About)がある【ルール外】", head: "説明文", scope: "both", outside: true },
	{ id: "C-12", label: "トピックがある【ルール外】", head: "トピック", scope: "both", outside: true },
	{ id: "C-13", label: "Actions に危ない書き方が無い【ルール外】", head: "Actions危険", scope: "both", outside: true },
	{ id: "C-14", label: "Actions の守りの書き方がそろっている【ルール外】", head: "Actions守り", scope: "both", outside: true },
];

const RX_NAME = /^[A-Za-z0-9-]+$/;
const RX_LOWER = /^[a-z0-9-]+$/;
const RX_README = /^readme(\.(md|markdown|txt|rst))?$/i;
const RX_LICENSE = /^(license|licence|copying)(\.(md|txt))?$/i;
const RX_ENV = /^\.env(\..+)?$/;
const ENV_SAMPLES = new Set([".env.example", ".env.sample", ".env.template"]);
const HEADING_RE = /^#{1,3}\s+(.+)$/;
const FENCE_RE = /^(```|~~~)/;

const EMPTY = "空のリポジトリ"; // M-170
const pass = (extra) => (extra ? { result: "pass", extra } : { result: "pass" });
const fail = (reason, more) => ({ result: "fail", reason, ...more });
const unknown = (reason) => ({ result: "unknown", reason });
const na = (extra) => ({ result: "na", extra });

// {理由}: M-23a〜c と同じ言葉、上限なら「API の上限」。api.js の reason・status があればそれを使う
const WHY = { network: "通信の失敗", "bad-json": "応答を読めない", forbidden: "GitHub が断った(403)" };
function why(f) {
	if (f?.kind === "rate-limited") return "API の上限";
	return f?.reason ?? WHY[f?.kind] ?? (f?.status != null ? String(f.status) : (f?.kind ?? "不明"));
}

const baseName = (path) => path.slice(path.lastIndexOf("/") + 1);

// §9.4 (c)
export function maskEmail(addr) {
	const s = String(addr ?? "").toLowerCase();
	const at = s.indexOf("@");
	if (at < 0) return "***";
	const head = Array.from(s.slice(0, at));
	return head.slice(0, head.length <= 2 ? 1 : 2).join("") + "***" + s.slice(at);
}

function checkEmails(input, settings) {
	const login = String(input.login || settings.ownerLogin || "").toLowerCase();
	const allowed = new Set([`${input.userId}+${login}@users.noreply.github.com`, `${login}@users.noreply.github.com`]);
	for (const a of settings.extraAllowedEmails ?? []) allowed.add(String(a).toLowerCase());
	const bad = new Map(); // 元のアドレス(小文字)→ { author, committer }。このファイルの外へ出さない
	const count = (addr, side) => {
		const key = String(addr ?? "").toLowerCase();
		if (allowed.has(key) || (side === "committer" && key === "noreply@github.com")) return;
		if (!bad.has(key)) bad.set(key, { author: 0, committer: 0 });
		bad.get(key)[side]++;
	};
	for (const c of input.commits.list ?? []) {
		count(c.authorEmail, "author");
		count(c.committerEmail, "committer");
	}
	const extra = input.commits.hasMore ? "新しい100件を見た。全件は git log で" : undefined; // M-149
	if (bad.size === 0) return pass(extra);
	const emails = [...bad].map(([addr, n]) => {
		const sides = [n.author && `author ${n.author}件`, n.committer && `committer ${n.committer}件`].filter(Boolean);
		return `外れたアドレス: ${maskEmail(addr)}(${sides.join("・")})`; // M-148
	});
	return fail(`許可していないアドレス ${bad.size} 種類`, extra ? { emails, extra } : { emails }); // M-150
}

// §9.4 (b): 囲みの外の `#`〜`###` の見出しだけ。囲みは同じ記号で閉じる
function headings(text) {
	const out = [];
	let fence = null;
	for (const line of text.split(/\r?\n/)) {
		const f = FENCE_RE.exec(line);
		if (f) {
			if (fence === null) fence = f[1];
			else if (fence === f[1]) fence = null;
			continue;
		}
		const h = fence === null && HEADING_RE.exec(line);
		if (h) out.push(h[1].toLowerCase());
	}
	return out;
}

function checkHeadings(text, keywords) {
	const hs = headings(text);
	const missing = Object.keys(keywords).filter((item) => !keywords[item].some((k) => hs.some((h) => h.includes(String(k).toLowerCase()))));
	const broken = text.includes("�") ? "README に UTF-8 として読めない文字がある" : null; // M-153
	if (missing.length === 0) return pass(broken ?? undefined);
	const reason = `足りない項目: ${missing.join("・")}`; // M-152
	return fail(broken ? `${reason}\n${broken}` : reason);
}

function checkActions(input, treeProblem, isEmpty) {
	if (isEmpty) return [na(EMPTY), na(EMPTY)];
	if (treeProblem) return [unknown(treeProblem), unknown(treeProblem)];
	const n = input.tree.entries.filter((e) => e.type === "blob" && isWorkflowPath(e.path)).length;
	if (n === 0) return [na("ワークフローが無い"), na("ワークフローが無い")]; // M-173
	const w = input.workflows;
	if (w?.ok !== true) {
		const reason =
			w?.kind === "too-many"
				? `ワークフローが ${w.tooMany ?? n} 本ある(点検は ${ACTIONS_MAX_FILES} 本まで)` // M-166
				: `ワークフローを取れなかった(${why(w)})`; // M-165
		return [unknown(reason), unknown(reason)];
	}
	const danger = [];
	const hygiene = [];
	for (const { path, text } of w.files) {
		const r = auditWorkflow(path, text);
		danger.push(...r.danger);
		hygiene.push(...r.hygiene);
	}
	const judge = (findings) => (findings.length ? fail(`当てはまる所: ${findings.length} 件`, { findings }) : pass()); // M-167
	return [judge(danger), judge(hygiene)];
}

// input・settings の形は INTERFACES.md §2.5。scope "list" の結果には C-9・C-10 を入れない(K-17)
export function runChecks(input, settings, { scope }) {
	const { name, tree, commits } = input;
	const lic = input.license?.spdx || null;
	const isEmpty = tree?.kind === "empty" || commits?.kind === "empty"; // 409
	const treeProblem = !tree?.ok ? `ファイルの一覧を取れなかった(${why(tree)})` : tree.truncated ? "ファイルの一覧が途中で切れている(truncated)" : null; // M-160・M-161
	const entries = tree?.ok ? (tree.entries ?? []) : [];
	const rootBlobs = entries.filter((e) => e.type === "blob" && !e.path.includes("/")).map((e) => e.path);
	const treeCheck = (judge) => (isEmpty ? na(EMPTY) : treeProblem ? unknown(treeProblem) : judge());
	const out = {};

	const badChars = [...new Set(String(name).replace(/[A-Za-z0-9-]/g, ""))];
	out["C-1"] = RX_NAME.test(name) ? pass() : fail(`半角英数とハイフン以外の文字: ${badChars.join(" ")}`); // M-140
	out["C-2"] = RX_LOWER.test(name) ? pass() : fail(`大文字がある: ${name}`); // M-141
	out["C-3"] = treeCheck(() => (rootBlobs.some((p) => RX_README.test(p)) ? pass() : fail("ルートに README が無い"))); // M-142
	out["C-4"] = treeCheck(() =>
		rootBlobs.some((p) => RX_LICENSE.test(p)) ? pass(lic ?? "なし") : fail(`ルートに LICENSE が無い(GitHub の判定: ${lic ?? "なし"})`),
	); // M-144・M-143
	out["C-5"] = treeCheck(() => (rootBlobs.includes(".gitignore") ? pass() : fail("ルートに .gitignore が無い"))); // M-145
	out["C-6"] = treeCheck(() => {
		const exts = new Set((settings.binaryExts ?? []).map((x) => String(x).toLowerCase()));
		const junk = new Set((settings.junkNames ?? []).map((x) => String(x).toLowerCase()));
		const paths = [];
		for (const e of entries) {
			const base = baseName(e.path).toLowerCase();
			const dot = base.lastIndexOf(".");
			const extHit = e.type === "blob" && dot >= 0 && exts.has(base.slice(dot + 1));
			if (extHit || ((e.type === "blob" || e.type === "tree") && junk.has(base))) paths.push(e.type === "tree" ? `${e.path}/` : e.path);
		}
		return paths.length ? fail("外れたパス:", { paths }) : pass(); // M-146
	});
	out["C-7"] = treeCheck(() => {
		const paths = entries.filter((e) => e.type === "blob" && RX_ENV.test(baseName(e.path)) && !ENV_SAMPLES.has(baseName(e.path))).map((e) => e.path);
		return paths.length ? fail("外れたパス:", { paths }) : pass();
	});

	if (isEmpty) out["C-8"] = na(EMPTY);
	else if (!commits?.ok) out["C-8"] = unknown(`コミットを取れなかった(${why(commits)})`); // M-162
	else if (input.userId == null) out["C-8"] = unknown("ID を取れなかった"); // M-163
	else out["C-8"] = checkEmails(input, settings);

	if (scope !== "list") {
		const readme = input.readme;
		const readmeCheck = (judge) => {
			if (isEmpty) return na(EMPTY);
			if (readme?.kind === "not-found") return na("README が無い"); // M-171
			if (!readme?.ok) return unknown(`README を取れなかった(${why(readme)})`); // M-164
			return judge(String(readme.text ?? ""));
		};
		out["C-9"] = readmeCheck((text) => checkHeadings(text, settings.readmeHeadingKeywords));
		out["C-10"] = readmeCheck((text) => {
			if (!lic || lic === "NOASSERTION") return na("ライセンスが無いか、GitHub が判別できない"); // M-172
			return text.toLowerCase().includes(lic.toLowerCase()) ? pass() : fail(`README に「${lic}」の文字が無い`); // M-154
		});
	}

	out["C-11"] = String(input.description ?? "").trim() ? pass() : fail("説明文が空"); // M-155
	out["C-12"] = input.topics?.length ? pass() : fail("トピックが無い"); // M-156
	[out["C-13"], out["C-14"]] = checkActions(input, treeProblem, isEmpty);
	return out;
}

const SYMBOL = { pass: "○", fail: "×", unknown: "?", na: "−" };

// §9.4 (d) に C-13・C-14 の列を足した Markdown。meta = { checkedLocal: "YYYY-MM-DD HH:mm", mdhm: (iso) => "MM-DD HH:mm" }
export function formatCheckupTable(rows, meta) {
	const defs = CHECK_DEFS.filter((d) => d.scope !== "popup");
	const lines = [
		`| リポジトリ | ${defs.map((d) => `${d.id} ${d.head}${d.outside ? "※" : ""}`).join(" | ")} |`,
		`|${"---|".repeat(defs.length + 1)}`,
	];
	for (const row of rows) {
		const name = row.fullName.slice(row.fullName.indexOf("/") + 1);
		const src = formatSourceLine({ title: name, url: row.htmlUrl }, { bullet: false, includeDate: false, stripParams: [] });
		const link = src.ok ? src.line : name;
		const mark = row.stale ? `(前回 ${String(meta.mdhm(row.checkedAt) ?? "").slice(0, 5)})` : "";
		const cells = defs.map((d) => {
			const sym = SYMBOL[row.results?.[d.id]?.result];
			return sym ? sym + mark : "未点検";
		});
		lines.push(`| ${link} | ${cells.join(" | ")} |`);
	}
	lines.push("", `点検: ${meta.checkedLocal}(RepoLens)。※は GitHub公開ルールに無い項目。前回の結果の行は記号の後に「(前回 MM-DD)」`);
	return lines.join("\n");
}
