// 機械向けの日時(ISO 8601)を PC のローカル時刻の文字にする純関数(仕様書 §9.3 (a)・INV-12)。PostClip の写しに形を足した物。
// 現在時刻を使わない(AC-25)。差(分)は呼び出し側が `-new Date(iso).getTimezoneOffset()` で渡す。

// 時差の印(Z か ±hh:mm)まで付いた形だけを受ける。付いていない値はどの時刻か決まらないので読まない
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DAY_MS = 86400000;

function parse(iso) {
	if (typeof iso !== "string" || !ISO_RE.test(iso)) return null;
	const ms = Date.parse(iso);
	return Number.isNaN(ms) ? null : ms;
}

// → { Y, M, D, h, m }(2 桁にそろえた文字)| null。秒は切り捨て
function local(iso, offsetMinutes) {
	const ms = parse(iso);
	if (ms === null || !Number.isFinite(offsetMinutes)) return null;
	const d = new Date(ms + offsetMinutes * 60000);
	const p = (n) => String(n).padStart(2, "0");
	return { Y: String(d.getUTCFullYear()), M: p(d.getUTCMonth() + 1), D: p(d.getUTCDate()), h: p(d.getUTCHours()), m: p(d.getUTCMinutes()) };
}

export function toLocalMinute(iso, offsetMinutes) {
	const t = local(iso, offsetMinutes);
	return t && `${t.Y}-${t.M}-${t.D} ${t.h}:${t.m}`;
}

export function toLocalDate(iso, offsetMinutes) {
	const t = local(iso, offsetMinutes);
	return t && `${t.Y}-${t.M}-${t.D}`;
}

export function toLocalHm(iso, offsetMinutes) {
	const t = local(iso, offsetMinutes);
	return t && `${t.h}:${t.m}`;
}

export function toLocalMdHm(iso, offsetMinutes) {
	const t = local(iso, offsetMinutes);
	return t && `${t.M}-${t.D} ${t.h}:${t.m}`;
}

// floor((to − from) / 1 日)。時計のずれで負になっても直さない(仕様書 §10 の「PC の時計がずれている」)
export function daysAgo(fromIso, toIso) {
	const from = parse(fromIso);
	const to = parse(toIso);
	return from === null || to === null ? null : Math.floor((to - from) / DAY_MS);
}
