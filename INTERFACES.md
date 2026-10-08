# RepoLens 担当間の契約(INTERFACES)

統合担当が並列の前に固定した、ファイルの持ち主と関数の形。仕様書(非公開)が正本で、ここは「仕様書に書いていない所」と「Actions 点検の足し算」だけを決める。形を変えたいときは変えずに報告に書く。

- 作業フォルダ: `L:\Chrome拡張機能\GitHub関連\github-repo-lens`(仕様書 Q-10 の親フォルダは依頼者が `GitHub関連` に決めた)
- ES モジュール(`import`/`export`)。タブで字下げ。UTF-8(BOM なし)・LF。各ファイルの先頭に責務の日本語コメント 3 行以内
- 純関数のファイル(`repo-url.js`・`mdtext.js`・`localtime.js`・`repofmt.js`・`checks.js`・`actions.js`)は `chrome.`・`Date.now(`・`new Date()`・`fetch` の文字を含めない(AC-25。コメントにも書かない)

## 0. 依頼者の決定(2026-10-08)

1. 仕様書の「§8 が空なら止まる」「フェーズごとに止まる」は使わず、全フェーズを仮決めで作る(兄弟の拡張と同じ。`docs/dev/common-brief.md` §1)
2. **公開点検に GitHub Actions の点検を足す。** 出どころは作者の公開リポジトリの Actions の点検(非公開のレポート)。項目は C-13・C-14(§4)。仕様書 D-8(ファイルの中身を読まない)の例外に、`.github/workflows/*.yml|yaml` の中身を足す

## 1. ファイルの持ち主

| 担当 | ファイル |
|---|---|
| A 純関数 | `repo-url.js` `mdtext.js` `localtime.js` `repofmt.js` `checks.js` / `tests/repourl.test.js` `tests/repofmt.test.js` `tests/checks.test.js` `tests/units.test.js` |
| B Actions | `actions.js` / `tests/actions.test.js` `tests/fixtures/workflows-bad/*`(自分で作る) |
| C データ | `api.js` `lens.js` / `tests/api.test.js` `tests/lens.test.js` `tests/fixtures/api/*`(自分で作る) |
| D 土台 | `manifest.json` `settings.js` `sw.js` `clipboard.js` `offscreen.html` `offscreen.js` `badge.js` `icons/*` `tools/make_icons.py` / `tests/settings.test.js` `tests/static.test.js` `tests/badge.test.js` |
| 第2波 E popup | `popup.html` `popup.js` `popup.css` `tokens.css`(統合担当が置く) |
| 第2波 F 一覧・設定 | `checkup.html` `checkup.js` `checkup.css` `options.html` `options.js` `options.css` |
| 統合担当 | `format.js`(SourceStamp の写し。SHA-256 `86E9F95B…FE6F0`)、`tests/index.js`、`NOTES.md`、この文書 |

ほかの担当のファイルを書かない。足りない関数があれば自分のファイルに一時的な代わりを作らず、報告に書く。

## 2. 共通の形

### 2.1 facts(仕様書 §9.3 (i) のまま)

```js
facts = { fullName, htmlUrl, ownerLogin, description, stars, forks, license: { spdx } | null, language, topics: string[],
          archived, fork, parent: string | null /* parent.full_name */, homepage, defaultBranch, pushedAt,
          lastCommit: { ok: true, iso } | { ok: true, none: true } | { ok: false, kind },
          release: { ok: true, tag, iso } | { ok: true, none: true } | { ok: false, kind },
          fetchedIso }
```
`ownerLogin`(= `owner.login`)と `pushedAt` は仕様書に無い足し算(自分のリポジトリかの判定と一覧の並べ替え用)。

### 2.2 localtime.js

```js
export function toLocalMinute(iso, offsetMinutes) {}  // → "YYYY-MM-DD HH:mm" | null
export function toLocalDate(iso, offsetMinutes) {}    // → "YYYY-MM-DD" | null
export function toLocalHm(iso, offsetMinutes) {}      // → "HH:mm" | null
export function toLocalMdHm(iso, offsetMinutes) {}    // → "MM-DD HH:mm" | null
export function daysAgo(fromIso, toIso) {}            // → floor((to − from) / 86400000)。読めなければ null
```
offsetMinutes は呼び出し側が `-new Date(iso).getTimezoneOffset()` で渡す(画面側の責務)。

### 2.3 repo-url.js / mdtext.js
`parseRepoUrl(url) → { owner, repo } | null`(§9.1)、`mdText(s) → string | null`(§9.3 (f))。

### 2.4 repofmt.js(§9.3 (i) のまま)
`formatBullet(facts, settings, { offsetMinutes })`・`formatRow(facts, settings, { offsetMinutes }, { header })` → string。`settings` から使うのは `bullet` だけ。`fetchedIso` の offset も同じ `offsetMinutes` を使う(呼び出し側が `fetchedIso` から作る)。§9.3 (g) の「facts が作れない」は lens.js 側の責務(repofmt には ok な facts だけが来る)。

### 2.5 checks.js(§9.4 (f) に足した物)

```js
export const CHECKS_VERSION = 1;
export const CHECK_DEFS = [ // 一覧の列・popup の行・コピーの見出しはここから作る(非機能 X-2)
  { id: "C-1", label: "名前が半角英数とハイフンだけ", head: "名前", scope: "both", outside: false }, …
  { id: "C-9", …, scope: "popup" }, { id: "C-10", …, scope: "popup" },
  { id: "C-11", label: "説明文(About)がある【ルール外】", head: "説明文", scope: "both", outside: true }, …
  { id: "C-13", label: "Actions に危ない書き方が無い【ルール外】", head: "Actions危険", scope: "both", outside: true },
  { id: "C-14", label: "Actions の守りの書き方がそろっている【ルール外】", head: "Actions守り", scope: "both", outside: true },
]; // label は画面設計書 §6.5 の M-120〜M-131(と §4 の M-132・M-133)。head は M-86 の下段(※ は UI とコピーで outside を見て付ける)
export function runChecks(input, settings, { scope }) {}
export function maskEmail(addr) {}                 // §9.4 (c)
export function formatCheckupTable(rows, meta) {}  // §9.4 (d) の Markdown(下の 2.7)
// input = 仕様書の形 + workflows:
//   workflows: { ok: true, files: [{ path, text }] } | { ok: false, kind, tooMany?: number } | undefined
//   (tree にワークフローが無いときは undefined でよい。checks.js が tree から判定する)
// → { "C-1": { result: "pass"|"fail"|"unknown"|"na", reason?, paths?, emails?, findings?, extra? }, … }
//   reason: 画面設計書 §6.5 の文(差し込み済み)。paths: C-6・C-7 の外れたパス(全件。画面が 20 件で切り M-147 を出す)
//   emails: C-8 の伏せ字の行(M-148 の形の完成した文)。findings: C-13・C-14 の行(§4)
//   extra: ○・− の行の中に出す文(C-4 の spdx_id = M-144、C-8 の M-149、− の理由)
```
`settings` から使うのは `ownerLogin`・`extraAllowedEmails`・`binaryExts`・`junkNames`・`readmeHeadingKeywords`。キーワードの形は `{ "概要": [...], "主な機能": [...], "動作環境": [...], "ビルド・実行方法": [...], "ライセンス": [...], "開発状況": [...] }`。scope `"list"` の結果には C-9・C-10 のキーを入れない(K-17)。

### 2.6 actions.js(担当 B。checks.js が呼ぶ)

```js
export const ACTIONS_MAX_FILES = 5;
export function isWorkflowPath(path) {}        // /^\.github\/workflows\/[^/]+\.ya?ml$/
export function auditWorkflow(path, text) {}   // → { danger: string[], hygiene: string[] }(§4 の文。行番号つき)
```

### 2.7 一覧の保存とコピー

`storage.local.checkup` は仕様書 §9.7 のまま(`results` から `emails` を除き、C-8 の reason は M-150)。`rows[i].results` が null の行は「前回も無い未点検」。`formatCheckupTable(rows, { checkedLocal, mdhm: (iso) => "MM-DD HH:mm" 相当 })` → §9.4 (d) の Markdown に C-13・C-14 の列を足した物。行の `stale: true`(前回の結果)は記号の後に「(前回 MM-DD)」。未点検の行は記号の列すべてに `未点検`。

## 3. api.js と lens.js(担当 C)

### 3.1 api.js(§9.2 (a)〜(c))

```js
export function createApi({ fetchImpl, now, session }) {}
// → { getJson(path), estimate(n), rate() }
//   getJson: §9.2 (a)。返り値 { ok: true, status, data, link } | { ok: false, status, kind, reason }
//            kind: not-found / empty / rate-limited / forbidden / server / network / bad-json。reason は M-23 の理由の言葉
//   estimate(n): → { ok: true } | { ok: false, kind: "rate-limited", reset, guessed }(INV-6)
//   rate(): → session の rate({ remaining, reset, seenAt, guessed } | null)
// session は { get(key) → Promise<value|undefined>, set(obj) → Promise, remove(key) → Promise }(chrome.storage.session の薄い包み。テストは偽物)
export function planList(remaining, n, userCached) {}   // AC-24
export function rateView(rate, nowMs) {}                 // → { state: "known", remaining, resetMs, guessed } | { state: "unknown" }(§3.3 の分岐の材料)
export function decodeBase64Utf8(content) {}             // README・ワークフローの content(改行入りの base64)→ 文字
export function chromeSession() {}                       // chrome.storage.session を上の形で包む(画面と sw が使う)
```
`rate.reset` は epoch ミリ秒にそろえる(ヘッダは秒)。`guessed: true` は `x-ratelimit-reset` が読めず `seenAt + 3600 秒` とみなしたとき(M-50)。

### 3.2 lens.js(画面と sw はここだけを呼ぶ)

```js
export async function loadRepo({ owner, repo, force, m1Only, settings, api, session, nowIso }) {}
// → { ok: true, facts, own, fromCache, savedAt, checks, checkStage }
//   | { ok: false, error: kind, reason, cache }   // cache は 10 分以内の写しがあれば上の ok の形(SC-01-S8)、無ければ null
//   own: facts.ownerLogin と settings.ownerLogin が一致(大小無視)し ownerLogin が空でない
//   checks: runChecks(…, { scope: "popup" }) の結果(own のときだけ。それ以外 null)
//   checkStage: "done" | { kind: "rate-limited", reset, guessed } | null(own でないとき)
//   m1Only: ショートカット用。自分のリポジトリでも 3 回だけ呼ぶ(commits は per_page=1)。写しは読むが書かない
//   写し: §9.2 (e)。force で写しを使わない。写しの checks から emails を除く(INV-5)。写しから出した C-8 の × の reason は M-157
// 呼ぶ順: 1段目 repo → (commits と releases を同時)、2段目 tree・readme・users(24時間の写しがあれば呼ばない)、
//        3段目 ワークフロー(tree に isWorkflowPath の blob があれば、先頭 5 本。6 本以上なら呼ばずに workflows = { ok: false, kind: "too-many", tooMany: n })
//        各段の前に estimate。3段目が足りなければ workflows = { ok: false, kind: "rate-limited" }
export async function runCheckup({ settings, api, session, nowIso, prev, onProgress, isAlive }) {}
// §9.2 (d)。→ { ok: true, checkup, k, n, hasMore, liveRows } | { ok: false, error, reason, reset, guessed } | { ok: false, error: "locked" }
//   checkup: storage.local に書く形(§2.7)。書くのは呼び出し側(checkup.js)。isAlive() が false なら書かない
//   liveRows: { [fullName]: results(emails つき) } 点検し直した直後の画面用(保存しない)
//   onProgress({ done, total, current: fullName | null })
//   ワークフローの取得は planList が残した余り(残り − users の 1 − 2k)から 1 件ずつ差し引き、足りなければ workflows = { ok: false, kind: "rate-limited" }
//   同時に進めるのは最大 4 件。lock:checkup の読み書きもここ
export async function buildCopy(facts, format, header, settings) {}  // → string(repofmt を呼ぶ。offset はここで fetchedIso から作る)
```

## 4. Actions の点検(C-13・C-14)

**C-13 Actions に危ない書き方が無い【ルール外】**(レポート §1 の「危ない書き方の代表」)。1 つでも当たれば ×:
- きっかけに `pull_request_target` か `workflow_run` がある → `{file}: 危ないきっかけ {name}(PR のコードを特権で動かしうる)`
- `run:` の中(1 行の値か、その下の字下げのブロック)に `${{` … `}}` があり、中に `github.event.` か `github.head_ref` を含む → `{file} {n}行目: run: の中に式 {式}(env: に移す)`
- `runs-on` に `self-hosted` → `{file} {n}行目: 自前のランナー(self-hosted)`
- 一番上に `permissions:` が無く、`permissions:` を持たないジョブが 1 つでもある → `{file}: permissions が無い(トークンが既定の権限になる)`。`permissions: write-all` → `{file} {n}行目: permissions: write-all`

**C-14 Actions の守りの書き方がそろっている【ルール外】**(レポートの Z1・Z2・M1・P3・P1)。1 つでも当たれば ×:
- `uses:` が 40 桁の 16 進の SHA でない(`./` で始まる物と `docker://…@sha256:` は除く)→ `{file} {n}行目: {uses の値} を SHA で固定していない`
- `actions/checkout` の手順の `with:` に `persist-credentials: false` が無い → `{file} {n}行目: checkout に persist-credentials: false が無い`
- ジョブに `timeout-minutes` が無い(ジョブ直下に `uses:` を持つ再利用ワークフローの呼び出しは除く)→ `{file}: ジョブ {job} に timeout-minutes が無い`
- ファイルのどこにも `concurrency:` が無い → `{file}: concurrency が無い`
- 一番上の `permissions:` に `: write` がある → `{file} {n}行目: 一番上の permissions に書き込みの権限({scope})。ジョブに移す`

結果の決め方(上から順に当てる):
- 空のリポジトリ → −「空のリポジトリ」(M-170)
- tree が失敗 / truncated → ?(M-160 / M-161 と同じ文)
- tree に isWorkflowPath の blob が無い → −「ワークフローが無い」(M-173)
- workflows が `{ ok: false, kind: "too-many", tooMany: n }` → ?「ワークフローが {n} 本ある(点検は 5 本まで)」(M-166)
- workflows がほかの失敗 → ?「ワークフローを取れなかった({理由})」(M-165。理由は M-23a〜c か「API の上限」)
- 当たりが 0 → ○、1 つ以上 → ×(`findings` に行を全部。理由 `reason` は「当てはまる所: {n} 件」(M-167))

文言の追加(画面設計書 §6.5 に無い物。番号はここで振った):

| ID | 文言 |
|---|---|
| M-132 | Actions に危ない書き方が無い【ルール外】 |
| M-133 | Actions の守りの書き方がそろっている【ルール外】 |
| M-165 | ワークフローを取れなかった({理由}) |
| M-166 | ワークフローが {n} 本ある(点検は 5 本まで) |
| M-167 | 当てはまる所: {n} 件 |
| M-173 | ワークフローが無い |
| M-86 追加 | C-13 / Actions危険※、C-14 / Actions守り※ |

解析は YAML の完全な読み取りをしない(依存ゼロ)。字下げと行の形で見る。読み違えの限界は `actions.js` の先頭近くに `ponytail:` のコメントで書く。

## 5. 決まった仮の値(NOTES.md の仮決め一覧に載せる)

| 欄 | 値 |
|---|---|
| CHROME_MAJOR | 153 |
| OWNER_LOGIN | `takosasi-dev` |
| DEFAULT_FORMAT | `bullet` |
| SHORTCUT_COPY | `Alt+Shift+G` |
| INCLUDE_FORKS / INCLUDE_ARCHIVED | false / true |
| BINARY_EXTS・JUNK_NAMES・README_HEADING_KEYWORDS | 仕様書 §8.6・§9.4 (b) の案のまま |
| R5_MIN_CLIPS | 10 |
| A-5(CORS) | `host_permissions` 無しで通る見込みで作る(通らなければ依頼者が実機で見て足す) |
| clipboardWrite | 足さない(QuietClip の probe で popup の `writeText` が権限なしで通った) |
