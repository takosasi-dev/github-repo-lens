// facts を M1 の箇条と表の行の Markdown にする純関数(仕様書 §9.3)。出典行は SourceStamp の写し format.js で作る(INV-9)。
// 外から来た文字は mdText で逃がし、日時は localtime.js で PC のローカル時刻にする(INV-12)。
import { formatSourceLine } from "./format.js";
import { mdText } from "./mdtext.js";
import { toLocalMinute, toLocalDate, daysAgo } from "./localtime.js";

export const REPOLENS_FORMAT_VERSION = 1;
export const ROW_HEADER = "| リポジトリ | スター | ライセンス | 最終コミット | 最新リリース | 状態 | 説明 | 取得 |\n|---|---:|---|---|---|---|---|---|";

const NG = "(取れなかった)";
const gotIso = (f) => f.fetchedIso;
const HOMEPAGE_RE = /^https?:\/\/[^\s<>|\[\]()]+$/;

function sourceLine(facts, bullet) {
	const r = formatSourceLine({ title: facts.fullName, url: facts.htmlUrl }, { bullet, includeDate: false, stripParams: [] });
	if (!r.ok) throw new TypeError(`repofmt: html_url を出典行にできない(${r.error})`); // API の html_url は https なので来ない
	return r.line;
}

const description = (f) => (f.description == null || f.description.trim() === "" ? "(説明なし)" : mdText(f.description));

function license(f) {
	if (!f.license?.spdx) return "なし";
	return f.license.spdx === "NOASSERTION" ? "不明(GitHub が判別できない)" : f.license.spdx;
}

// withAge: 箇条は「(N日前・ブランチ)」を付け、表の行は日付だけ
function lastCommit(f, offsetMinutes, withAge) {
	const c = f.lastCommit;
	if (c?.ok && c.none) return "(コミットなし)";
	const date = c?.ok ? toLocalDate(c.iso, offsetMinutes) : null;
	const days = c?.ok ? daysAgo(c.iso, gotIso(f)) : null;
	if (date === null || days === null) return NG;
	return withAge ? `${date}(${days}日前・${mdText(f.defaultBranch)})` : date;
}

function release(f, offsetMinutes) {
	const r = f.release;
	if (r?.ok && r.none) return "なし";
	const date = r?.ok ? toLocalDate(r.iso, offsetMinutes) : null;
	return date === null ? NG : `${mdText(r.tag)}(${date})`;
}

function state(f) {
	const s = [];
	if (f.archived) s.push("アーカイブ済み");
	if (f.fork) s.push(f.parent ? `フォーク(元: ${mdText(f.parent)})` : "フォーク");
	return s.join("・");
}

export function formatBullet(facts, settings, { offsetMinutes }) {
	const f = facts;
	const lines = [sourceLine(f, settings.bullet !== false)];
	lines.push(`  - 説明: ${description(f)}`);
	lines.push(`  - スター: ${f.stars} / フォーク: ${f.forks}`);
	lines.push(`  - ライセンス: ${license(f)}`);
	if (f.language != null && f.language !== "") lines.push(`  - 言語: ${mdText(f.language)}`);
	if (f.topics?.length) lines.push(`  - トピック: ${f.topics.map(mdText).join(", ")}`);
	lines.push(`  - 最終コミット: ${lastCommit(f, offsetMinutes, true)}`);
	lines.push(`  - 最新リリース: ${release(f, offsetMinutes)}`);
	const st = state(f);
	if (st) lines.push(`  - 状態: ${st}`);
	const home = String(f.homepage ?? "").trim();
	if (home) lines.push(`  - ホームページ: ${HOMEPAGE_RE.test(home) ? home : "(http・https の URL でないので出さない)"}`);
	lines.push(`  - 取得: ${toLocalMinute(gotIso(f), offsetMinutes) ?? NG}(RepoLens)`);
	return lines.join("\n");
}

export function formatRow(facts, settings, { offsetMinutes }, { header } = {}) {
	const f = facts;
	const cells = [
		sourceLine(f, false),
		String(f.stars),
		license(f),
		lastCommit(f, offsetMinutes, false),
		release(f, offsetMinutes),
		state(f) || "-",
		description(f),
		`${toLocalDate(gotIso(f), offsetMinutes) ?? NG}(RepoLens)`,
	];
	const row = `| ${cells.join(" | ")} |`;
	return header ? `${ROW_HEADER}\n${row}` : row;
}
