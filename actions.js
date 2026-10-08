// GitHub Actions のワークフロー(.github/workflows/*.yml)を字下げと行の形で読み、C-13(危ない書き方)と C-14(守りの書き方)の当たりを文で返す純関数。
// checks.js が呼ぶ。条件と文は INTERFACES.md §4 のまま。依存なし。
// ponytail: YAML を完全には読まない。アンカー・別名(<<: *x)・複数行の引用文字列・折り返した素の値・複数行にまたがる [ ] { } は読まず、その中の当たりを見落とす。
// ponytail: 1 行の [ ] { }(on: と permissions: と with:)は語を拾うだけ。runs-on の self-hosted は式(matrix 経由など)だと見えない。足りなければ小さな YAML 読みを vendor に置く。

export const ACTIONS_MAX_FILES = 5;

export function isWorkflowPath(path) {
	return typeof path === "string" && /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path);
}

const KEY_RE = /^(?:"([^"]*)"|'([^']*)'|([^\s"'#{[][^:]*?))\s*:(?:\s+(.*))?$/;
const BLOCK_RE = /^[|>][-+0-9]*$/;
const unquote = (v) => v.replace(/^(["'])(.*)\1$/, "$2");
const indentOf = (s) => s.length - s.trimStart().length;

// 空白の後の # から後ろを削る。引用の中の # は残す(引用は値の頭で始まった物だけ数える)。
function stripComment(s) {
	let q = "";
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		const prev = i === 0 ? " " : s[i - 1];
		if (q) {
			if (c === q && !(q === '"' && prev === "\\")) q = "";
		} else if ((c === '"' || c === "'") && /[\s:[{,]/.test(prev)) {
			q = c;
		} else if (c === "#" && /\s/.test(prev)) {
			return s.slice(0, i);
		}
	}
	return s;
}

// 行を木にする。節は { n, indent, key?, value, item?, block?, children }。
// `- key: v` は item の節(ダッシュの位置)の下に key の節(キーの位置)を置く。| と > の中身は block に行のまま持つ。
function parse(text) {
	const lines = String(text ?? "").replace(/^﻿/, "").split(/\r?\n/);
	const root = { n: 0, indent: -1, value: "", children: [] };
	const stack = [root];
	const add = (node) => {
		stack.at(-1).children.push(node);
		stack.push(node);
	};
	for (let i = 0; i < lines.length; i++) {
		const body = stripComment(lines[i]).trimEnd();
		let rest = body.trimStart();
		if (!rest || rest === "---" || rest === "...") continue;
		let indent = body.length - rest.length;
		const dash = /^-(?:\s+|$)/.exec(rest);
		if (dash) {
			// 親のキーと同じ字下げの `- ` は、その値が空ならその子(steps: の直下に - を置く書き方)
			for (let top = stack.at(-1); stack.length > 1; top = stack.at(-1)) {
				const isParent = top.indent === indent && top.key !== undefined && top.value === "" && !top.block;
				if (top.indent < indent || isParent) break;
				stack.pop();
			}
			const item = { n: i + 1, indent, value: "", item: true, children: [] };
			add(item);
			rest = rest.slice(dash[0].length);
			indent += dash[0].length;
			if (!rest || rest.startsWith("-")) continue;
			if (!KEY_RE.test(rest)) {
				item.value = unquote(rest);
				continue;
			}
		} else {
			while (stack.length > 1 && stack.at(-1).indent >= indent) stack.pop();
		}
		const m = KEY_RE.exec(rest);
		if (!m) continue; // 折り返した値などは読まない
		const raw = (m[4] ?? "").trim();
		const node = { n: i + 1, indent, key: m[1] ?? m[2] ?? m[3].trim(), value: unquote(raw), children: [] };
		if (BLOCK_RE.test(raw)) {
			node.value = "";
			node.block = [];
			let j = i + 1;
			while (j < lines.length && (!lines[j].trim() || indentOf(lines[j]) > indent)) {
				node.block.push({ n: j + 1, text: lines[j] });
				j++;
			}
			i = j - 1;
		}
		add(node);
	}
	return root;
}

const child = (node, key) => node?.children.find((c) => c.key === key);
function find(node, pred) {
	if (pred(node)) return node;
	for (const c of node.children) {
		const hit = find(c, pred);
		if (hit) return hit;
	}
	return null;
}

const DANGER_TRIGGERS = ["pull_request_target", "workflow_run"];
const EXPR_RE = /\$\{\{[\s\S]*?\}\}/g;
const SHA_RE = /@[0-9a-f]{40}$/i;
const DOCKER_DIGEST_RE = /^docker:\/\/.*@sha256:[0-9a-f]{64}$/i;

// → { danger: string[], hygiene: string[] }。ファイル全体の行(行番号なし)を先に、あとは行番号の順。
export function auditWorkflow(path, text) {
	const file = String(path ?? "").split("/").pop();
	const at = (n) => `${file} ${n}行目: `;
	const danger = [];
	const hygiene = [];
	const d = (n, s) => danger.push({ n, s });
	const h = (n, s) => hygiene.push({ n, s });
	const root = parse(text);

	const on = child(root, "on");
	if (on) {
		const names = on.value
			? (on.value.match(/[A-Za-z_][\w-]*/g) ?? [])
			: on.children.map((c) => (c.item ? (c.children[0]?.key ?? c.value) : c.key));
		for (const name of DANGER_TRIGGERS) {
			if (names.includes(name)) d(0, `${file}: 危ないきっかけ ${name}(PR のコードを特権で動かしうる)`);
		}
	}

	const perm = child(root, "permissions");
	const jobs = (child(root, "jobs")?.children ?? []).filter((c) => c.key !== undefined);
	if (!perm && jobs.some((j) => !child(j, "permissions"))) d(0, `${file}: permissions が無い(トークンが既定の権限になる)`);
	for (const p of [perm, ...jobs.map((j) => child(j, "permissions"))]) {
		if (p?.value === "write-all") d(p.n, `${at(p.n)}permissions: write-all`);
	}
	if (perm) {
		const pairs = perm.value
			? [...perm.value.matchAll(/([\w-]+)\s*:\s*([\w-]+)/g)].map((m) => ({ n: perm.n, key: m[1], value: m[2] }))
			: perm.children;
		for (const c of pairs) {
			if (c.value === "write") h(c.n, `${at(c.n)}一番上の permissions に書き込みの権限(${c.key})。ジョブに移す`);
		}
	}

	const pin = (u) => {
		const v = u.value;
		if (v.startsWith("./") || DOCKER_DIGEST_RE.test(v) || SHA_RE.test(v)) return;
		h(u.n, `${at(u.n)}${v} を SHA で固定していない`);
	};
	for (const job of jobs) {
		const runsOn = child(job, "runs-on");
		const self = runsOn && find(runsOn, (x) => /\bself-hosted\b/.test(x.value));
		if (self) d(self.n, `${at(self.n)}自前のランナー(self-hosted)`);

		const jobUses = child(job, "uses");
		if (jobUses) pin(jobUses);
		else if (!child(job, "timeout-minutes")) h(0, `${file}: ジョブ ${job.key} に timeout-minutes が無い`);

		for (const step of child(job, "steps")?.children ?? []) {
			const uses = child(step, "uses");
			if (uses) {
				pin(uses);
				if (/^actions\/checkout@/i.test(uses.value)) {
					const w = child(step, "with");
					const ok = w && (w.value
						? /persist-credentials\s*:\s*["']?false\b/i.test(w.value)
						: child(w, "persist-credentials")?.value.toLowerCase() === "false");
					if (!ok) h(uses.n, `${at(uses.n)}checkout に persist-credentials: false が無い`);
				}
			}
			const run = child(step, "run");
			if (!run) continue;
			for (const line of run.block ?? [{ n: run.n, text: run.value }]) {
				for (const [expr] of line.text.matchAll(EXPR_RE)) {
					if (/github\.event\.|github\.head_ref/.test(expr)) d(line.n, `${at(line.n)}run: の中に式 ${expr}(env: に移す)`);
				}
			}
		}
	}

	if (!find(root, (x) => x.key === "concurrency")) h(0, `${file}: concurrency が無い`);

	const done = (list) => list.sort((a, b) => a.n - b.n).map((x) => x.s);
	return { danger: done(danger), hygiene: done(hygiene) };
}
