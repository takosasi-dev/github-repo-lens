// 外から来た文字(説明・トピック・言語・タグ名・フォーク元)を Markdown の 1 行に安全に入れる純関数(仕様書 §9.3 (f))。
// 改行・タブを空白 1 つにし、Obsidian で記法になる ASCII 記号の前に `\` を付ける。

const SPECIAL_RE = /[\\`*_[\]<>|#~=%$]/g;

// → string | null(null・undefined は null)。CRLF は 1 つの改行として空白 1 つにする
export function mdText(s) {
	if (s == null) return null;
	return String(s).replace(/\r\n|[\r\n\t]/g, " ").replace(SPECIAL_RE, "\\$&");
}
