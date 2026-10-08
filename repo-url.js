// タブの URL から GitHub のリポジトリの owner と repo を読む純関数(仕様書 §9.1)。
// 読めない URL(github.com でない・http・予約語の owner・プロフィール)は null。

const URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})(?:[/?#].*)?$/;
const RESERVED = new Set(
	"settings orgs organizations marketplace explore topics trending collections notifications pulls issues search login logout join sponsors features enterprise codespaces new about pricing security readme apps users site account dashboard customer-stories".split(" "),
);

// → { owner, repo } | null
export function parseRepoUrl(url) {
	const m = typeof url === "string" ? URL_RE.exec(url) : null;
	if (!m || RESERVED.has(m[1].toLowerCase())) return null;
	const repo = m[2].endsWith(".git") ? m[2].slice(0, -4) : m[2];
	if (repo === "" || repo === "." || repo === "..") return null;
	return { owner: m[1], repo };
}
