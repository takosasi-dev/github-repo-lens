// 画面と sw が呼ぶ入口。api.js で集め、facts と点検の入力を作り、checks.js・repofmt.js に渡す(仕様書 §9.2 (b)〜(e))。
// 10 分の写し(cache:repo)・24 時間の写し(cache:user)・lock:checkup の読み書きもここ。写しにアドレスを入れない(INV-5)。
// 外から来た値は信頼しない。読んだ値をログに出さない(INV-8)。

import { runChecks } from "./checks.js";
import { formatBullet, formatRow } from "./repofmt.js";
import { isWorkflowPath, ACTIONS_MAX_FILES } from "./actions.js";
import { decodeBase64Utf8, planList } from "./api.js";

const REPO_CACHE_MS = 600000;
const USER_CACHE_MS = 86400000;
const LOCK_MS = 300000;
const LIST_PARALLEL = 4;
const M157 = "アドレスは写していない。「最新の値を取る」で見る";

const enc = encodeURIComponent;
const repoKey = (owner, repo) => `cache:repo:${owner}/${repo}`.toLowerCase();
const userKey = (login) => `cache:user:${String(login).toLowerCase()}`;
const hasNext = (link) => /rel="next"/.test(link ?? "");

function isOwn(ownerLogin, settingsLogin) {
	return !!settingsLogin && !!ownerLogin && ownerLogin.toLowerCase() === settingsLogin.toLowerCase();
}

async function readFresh(session, key, maxAge, nowMs) {
	const v = await session.get(key);
	if (!v) return null;
	if (nowMs - v.savedAt <= maxAge && v.savedAt <= nowMs) return v;
	await session.remove(key); // 古い写しは出さない(§9.2 (e))
	return null;
}

async function limitStage(api, est) {
	const r = est ?? (await api.rate());
	return { kind: "rate-limited", reset: r?.reset ?? null, guessed: !!r?.guessed };
}

function toFacts(d, commits, release, nowIso) {
	let lastCommit, rel;
	if (commits.ok) {
		const top = Array.isArray(commits.data) ? commits.data[0] : null;
		lastCommit = top ? { ok: true, iso: top.commit?.committer?.date ?? null } : { ok: true, none: true };
	} else {
		lastCommit = commits.kind === "empty" ? { ok: true, none: true } : { ok: false, kind: commits.kind };
	}
	if (release.ok) rel = { ok: true, tag: release.data.tag_name, iso: release.data.published_at };
	else rel = release.kind === "not-found" ? { ok: true, none: true } : { ok: false, kind: release.kind };
	return {
		fullName: d.full_name,
		htmlUrl: d.html_url,
		ownerLogin: d.owner?.login ?? "",
		description: d.description ?? null,
		stars: d.stargazers_count,
		forks: d.forks_count,
		license: d.license ? { spdx: d.license.spdx_id ?? null } : null,
		language: d.language ?? null,
		topics: Array.isArray(d.topics) ? d.topics : [],
		archived: !!d.archived,
		fork: !!d.fork,
		parent: d.parent?.full_name ?? null,
		homepage: d.homepage ?? "",
		defaultBranch: d.default_branch,
		pushedAt: d.pushed_at ?? null,
		lastCommit,
		release: rel,
		fetchedIso: nowIso,
	};
}

// 失敗は getJson の形({ ok: false, status, kind, reason })のまま渡す(checks.js の { ok: false, kind } の上位の形)
function toTree(res) {
	if (!res.ok) return res;
	const entries = (res.data?.tree ?? []).map(({ path, type }) => ({ path, type }));
	return { ok: true, truncated: !!res.data?.truncated, entries };
}

function toCommits(res) {
	if (!res.ok) return res;
	const list = (Array.isArray(res.data) ? res.data : []).map((c) => ({
		authorEmail: c.commit?.author?.email ?? null,
		committerEmail: c.commit?.committer?.email ?? null,
	}));
	return { ok: true, hasMore: hasNext(res.link), list };
}

function toText(res) {
	if (!res.ok) return res;
	if (res.data?.encoding !== "base64") return { ok: false, status: res.status, kind: "bad-json", reason: "応答を読めない" };
	try {
		return { ok: true, text: decodeBase64Utf8(res.data.content ?? "") };
	} catch {
		return { ok: false, status: res.status, kind: "bad-json", reason: "応答を読めない" };
	}
}

// 3段目。allow(n) が false なら呼ばずに rate-limited。tree が使えない・ワークフローが無ければ undefined(checks.js が tree で判定)
async function loadWorkflows(api, fullName, branch, tree, allow) {
	if (!tree.ok || tree.truncated) return undefined;
	const paths = tree.entries.filter((e) => e.type === "blob" && isWorkflowPath(e.path)).map((e) => e.path);
	if (paths.length === 0) return undefined;
	if (paths.length > ACTIONS_MAX_FILES) return { ok: false, kind: "too-many", tooMany: paths.length };
	if (!(await allow(paths.length))) return { ok: false, kind: "rate-limited", reason: "API の上限" };
	const got = await Promise.all(paths.map((p) =>
		api.getJson(`/repos/${fullName}/contents/${p.split("/").map(enc).join("/")}?ref=${enc(branch)}`)));
	const files = [];
	for (let i = 0; i < paths.length; i++) {
		const t = toText(got[i]);
		if (!t.ok) return { ok: false, kind: t.kind, status: t.status, reason: t.reason };
		files.push({ path: paths[i], text: t.text });
	}
	return { ok: true, files };
}

function cacheChecks(checks) {
	if (!checks) return null;
	const out = {};
	for (const [id, r] of Object.entries(checks)) {
		const { emails, ...rest } = r;
		out[id] = id === "C-8" && rest.result === "fail" ? { ...rest, reason: M157 } : rest;
	}
	return out;
}

function saveChecks(checks) {
	const out = {};
	for (const [id, r] of Object.entries(checks)) {
		const { emails, ...rest } = r;
		out[id] = id === "C-8" && rest.result === "fail"
			? { ...rest, reason: `許可していないアドレス ${emails?.length ?? 0} 種類` } // M-150
			: rest;
	}
	return out;
}

function fromCacheEntry(entry, settings, stage) {
	const own = isOwn(entry.facts.ownerLogin, settings.ownerLogin);
	return {
		ok: true,
		facts: entry.facts,
		own,
		fromCache: true,
		savedAt: entry.savedAt,
		checks: own ? entry.checks ?? null : null,
		checkStage: own ? (entry.checks ? "done" : stage) : null,
	};
}

export async function loadRepo({ owner, repo, force, m1Only, settings, api, session, nowIso }) {
	const nowMs = Date.parse(nowIso);
	const key = repoKey(owner, repo);
	const entry = await readFresh(session, key, REPO_CACHE_MS, nowMs);
	// 自分のリポジトリで点検の無い写し(2段目が上限だった)は、ふだんは使わず呼び直す。上限のときの代わりには出す
	const complete = entry && (m1Only || !isOwn(entry.facts.ownerLogin, settings.ownerLogin) || entry.checks);
	if (complete && !force) return m1Only ? { ...fromCacheEntry(entry, settings, null), checks: null, checkStage: null } : fromCacheEntry(entry, settings, null);

	// 上限のときは reset(epoch ms)と guessed も返す(M-21・M-116c の時刻)
	const fail = async (error, reason, est) => {
		const limit = await limitStage(api, est);
		let cache = null;
		if (entry) {
			cache = fromCacheEntry(entry, settings, limit);
			if (m1Only) cache = { ...cache, checks: null, checkStage: null };
		}
		const out = { ok: false, error, reason, cache };
		return error === "rate-limited" ? { ...out, reset: limit.reset, guessed: limit.guessed } : out;
	};

	// 1段目: repo → (commits と releases を同時)
	const est1 = await api.estimate(3);
	if (!est1.ok) return fail("rate-limited", "API の上限", est1);
	const repoRes = await api.getJson(`/repos/${enc(owner)}/${enc(repo)}`);
	if (!repoRes.ok) return fail(repoRes.kind, repoRes.reason);
	const d = repoRes.data;
	const own = isOwn(d.owner?.login, settings.ownerLogin);
	const full = own && !m1Only;
	const fullName = d.full_name;
	const branch = d.default_branch;
	const [commitsRes, releaseRes] = await Promise.all([
		api.getJson(`/repos/${fullName}/commits?sha=${enc(branch)}&per_page=${full ? 100 : 1}`),
		api.getJson(`/repos/${fullName}/releases/latest`),
	]);
	const facts = toFacts(d, commitsRes, releaseRes, nowIso);

	let checks = null;
	let checkStage = null;
	if (full) {
		// 2段目: tree・readme・users(24時間の写しがあれば呼ばない)
		const login = facts.ownerLogin;
		const user = await readFresh(session, userKey(login), USER_CACHE_MS, nowMs);
		const est2 = await api.estimate(user ? 2 : 3);
		if (!est2.ok) {
			checkStage = await limitStage(api, est2);
		} else {
			const [treeRes, readmeRes, userRes] = await Promise.all([
				api.getJson(`/repos/${fullName}/git/trees/${enc(branch)}?recursive=1`),
				api.getJson(`/repos/${fullName}/readme`),
				user ? null : api.getJson(`/users/${enc(login)}`),
			]);
			let userId = user ? user.id : null;
			if (userRes?.ok && Number.isInteger(userRes.data?.id)) {
				userId = userRes.data.id;
				await session.set({ [userKey(login)]: { savedAt: nowMs, id: userId } });
			}
			const tree = toTree(treeRes);
			// 3段目: ワークフロー(先頭 5 本まで)
			const workflows = await loadWorkflows(api, fullName, branch, tree, async (n) => (await api.estimate(n)).ok);
			checks = runChecks({
				name: d.name,
				description: facts.description,
				topics: facts.topics,
				license: facts.license,
				login,
				userId,
				tree,
				commits: toCommits(commitsRes),
				readme: toText(readmeRes),
				workflows,
			}, settings, { scope: "popup" });
			checkStage = "done";
		}
	}

	if (!m1Only) await session.set({ [key]: { savedAt: nowMs, facts, checks: own ? cacheChecks(checks) : null } });
	return { ok: true, facts, own, fromCache: false, savedAt: nowMs, checks, checkStage };
}

export async function runCheckup({ settings, api, session, nowIso, prev, onProgress, isAlive }) {
	const nowMs = Date.parse(nowIso);
	const lock = await session.get("lock:checkup");
	if (lock && nowMs - lock.savedAt < LOCK_MS && lock.savedAt <= nowMs) return { ok: false, error: "locked" };
	await session.set({ "lock:checkup": { savedAt: nowMs } });
	try {
		const login = settings.ownerLogin;
		const est = await api.estimate(1);
		if (!est.ok) return { ok: false, error: "rate-limited", reason: "API の上限", reset: est.reset, guessed: est.guessed };
		const list = await api.getJson(`/users/${enc(login)}/repos?type=owner&sort=pushed&per_page=100`);
		if (!list.ok) {
			const out = { ok: false, error: list.kind, reason: list.reason };
			if (list.kind !== "rate-limited") return out;
			const { reset, guessed } = await limitStage(api);
			return { ...out, reset, guessed };
		}
		const hasMore = hasNext(list.link);
		const targets = (Array.isArray(list.data) ? list.data : [])
			.filter((r) => (settings.includeForks || !r.fork) && (settings.includeArchived || !r.archived))
			.sort((a, b) => (Date.parse(b.pushed_at) || 0) - (Date.parse(a.pushed_at) || 0));
		const n = targets.length;

		const user = await readFresh(session, userKey(login), USER_CACHE_MS, nowMs);
		const r = await api.rate();
		const remaining = r && r.reset > nowMs ? r.remaining : Infinity; // 不明なら呼んでよい(§9.2 (c))
		const k = planList(remaining, n, !!user);
		let spare = remaining - (user ? 0 : 1) - 2 * k; // ワークフローに回せる余り

		let userId = user ? user.id : null;
		if (!user && k > 0) {
			const u = await api.getJson(`/users/${enc(login)}`);
			if (u.ok && Number.isInteger(u.data?.id)) {
				userId = u.data.id;
				await session.set({ [userKey(login)]: { savedAt: nowMs, id: userId } });
			}
		}

		const allow = (need) => {
			if (spare < need) return false;
			spare -= need;
			return true;
		};
		const alive = () => !isAlive || isAlive();
		const queue = targets.slice(0, k);
		const fresh = new Map();
		let done = 0;
		onProgress?.({ done, total: k, current: null });
		const checkOne = async (t) => {
			const branch = t.default_branch;
			const [treeRes, commitsRes] = await Promise.all([
				api.getJson(`/repos/${t.full_name}/git/trees/${enc(branch)}?recursive=1`),
				api.getJson(`/repos/${t.full_name}/commits?sha=${enc(branch)}&per_page=100`),
			]);
			const tree = toTree(treeRes);
			return runChecks({
				name: t.name,
				description: t.description ?? null,
				topics: Array.isArray(t.topics) ? t.topics : [],
				license: t.license ? { spdx: t.license.spdx_id ?? null } : null,
				login,
				userId,
				tree,
				commits: toCommits(commitsRes),
				readme: undefined,
				workflows: await loadWorkflows(api, t.full_name, branch, tree, allow),
			}, settings, { scope: "list" });
		};
		const worker = async () => {
			while (queue.length && alive()) {
				const t = queue.shift();
				onProgress?.({ done, total: k, current: t.full_name });
				const res = await checkOne(t);
				fresh.set(t.full_name, res);
				done++;
				onProgress?.({ done, total: k, current: null, finished: t.full_name, results: res }); // 画面が終わった行から記号を変える(CK-16)。保存はしない
			}
		};
		await Promise.all(Array.from({ length: Math.min(LIST_PARALLEL, k) }, worker));
		if (!alive()) return { ok: false, error: "closed" };

		const before = new Map((prev?.rows ?? []).map((row) => [row.fullName, row]));
		const liveRows = {};
		const rows = targets.map((t) => {
			const base = { fullName: t.full_name, htmlUrl: t.html_url, pushedAt: t.pushed_at ?? null, archived: !!t.archived, fork: !!t.fork };
			const res = fresh.get(t.full_name);
			if (res) {
				liveRows[t.full_name] = res;
				return { ...base, checkedAt: nowIso, results: saveChecks(res), stale: false };
			}
			const old = before.get(t.full_name);
			return old?.results
				? { ...base, checkedAt: old.checkedAt ?? null, results: old.results, stale: true }
				: { ...base, checkedAt: null, results: null, stale: false };
		});
		return { ok: true, checkup: { schemaVersion: 1, login, checkedAt: nowIso, rows }, k, n, hasMore, liveRows };
	} finally {
		await session.remove("lock:checkup");
	}
}

export async function buildCopy(facts, format, header, settings) {
	const offsetMinutes = -new Date(facts.fetchedIso).getTimezoneOffset();
	return format === "row"
		? formatRow(facts, settings, { offsetMinutes }, { header })
		: formatBullet(facts, settings, { offsetMinutes });
}
