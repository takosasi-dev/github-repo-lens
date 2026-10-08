// mdtext.js(仕様書 §9.3 (f))と localtime.js(INTERFACES.md §2.2・INV-12)のテスト。
import test from "node:test";
import assert from "node:assert/strict";
import { mdText } from "../mdtext.js";
import { toLocalMinute, toLocalDate, toLocalHm, toLocalMdHm, daysAgo } from "../localtime.js";

test("mdText: 記号の前に \\ を付ける", () => {
	assert.equal(mdText("\\ ` * _ [ ] < > | # ~ = % $"), "\\\\ \\` \\* \\_ \\[ \\] \\< \\> \\| \\# \\~ \\= \\% \\$");
	assert.equal(mdText("メモ #obsidian | 速い_版 <b>"), "メモ \\#obsidian \\| 速い\\_版 \\<b\\>");
	assert.equal(mdText("普通の文 (かっこ) と ! ? : -"), "普通の文 (かっこ) と ! ? : -");
});

test("mdText: CR・LF・タブは空白 1 つ(CRLF も 1 つ)。null は null", () => {
	assert.equal(mdText("a\nb\rc\td\r\ne"), "a b c d e");
	assert.equal(mdText(null), null);
	assert.equal(mdText(undefined), null);
	assert.equal(mdText(""), "");
});

test("localtime: 差の分だけずらす。秒は切り捨て", () => {
	assert.equal(toLocalMinute("2026-10-08T10:30:59Z", 540), "2026-10-08 19:30");
	assert.equal(toLocalDate("2026-09-30T15:00:00Z", 540), "2026-10-01");
	assert.equal(toLocalHm("2026-10-08T10:30:00Z", 540), "19:30");
	assert.equal(toLocalMdHm("2026-10-08T10:30:00Z", 540), "10-08 19:30");
	assert.equal(toLocalMinute("2026-01-01T00:10:00Z", -300), "2025-12-31 19:10");
	assert.equal(toLocalMinute("2026-09-26T21:04:00+09:00", 0), "2026-09-26 12:04");
});

test("localtime: 時差の印の無い値・壊れた値・数でない差は null", () => {
	for (const f of [toLocalMinute, toLocalDate, toLocalHm, toLocalMdHm]) {
		for (const v of ["2026-09-26T12:04:00", "", null, undefined, "2026-13-40T99:99:00Z", 1727352240000]) {
			assert.equal(f(v, 540), null, `${f.name} ${v}`);
		}
		assert.equal(f("2026-09-26T12:04:00Z", NaN), null);
	}
});

test("daysAgo: 24 時間ごとに 1。読めなければ null", () => {
	assert.equal(daysAgo("2026-09-30T03:00:00Z", "2026-10-08T10:30:00Z"), 8);
	assert.equal(daysAgo("2026-10-08T10:00:00Z", "2026-10-08T10:30:00Z"), 0);
	assert.equal(daysAgo("2026-10-07T10:30:01Z", "2026-10-08T10:30:00Z"), 0);
	assert.equal(daysAgo("2026-10-07T10:30:00Z", "2026-10-08T10:30:00Z"), 1);
	assert.equal(daysAgo("x", "2026-10-08T10:30:00Z"), null);
	assert.equal(daysAgo("2026-10-08T10:30:00Z", undefined), null);
});
