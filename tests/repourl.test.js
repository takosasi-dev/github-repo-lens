// repo-url.js(仕様書 §9.1)のテスト。U-1〜U-7 は仕様書の見本のまま。
import test from "node:test";
import assert from "node:assert/strict";
import { parseRepoUrl } from "../repo-url.js";

test("U-1: リポジトリのトップ", () => {
	assert.deepEqual(parseRepoUrl("https://github.com/refined-github/refined-github"), { owner: "refined-github", repo: "refined-github" });
});

test("U-2: 後ろのパス・引数・# は無視", () => {
	assert.deepEqual(parseRepoUrl("https://github.com/a/b/tree/main/src?x=1#L3"), { owner: "a", repo: "b" });
});

test("U-3: 末尾の .git を外す", () => {
	assert.deepEqual(parseRepoUrl("https://github.com/a/b.git"), { owner: "a", repo: "b" });
});

test("U-4: 予約語の owner は null", () => {
	assert.equal(parseRepoUrl("https://github.com/settings/profile"), null);
});

test("U-5: プロフィールは null", () => {
	assert.equal(parseRepoUrl("https://github.com/takosasi-dev"), null);
});

test("U-6: gist は null", () => {
	assert.equal(parseRepoUrl("https://gist.github.com/a/123"), null);
});

test("U-7: http は null", () => {
	assert.equal(parseRepoUrl("http://github.com/a/b"), null);
});

test("予約語は大小を区別しない・.git を外して空や . になるなら null・文字でない値は null", () => {
	assert.equal(parseRepoUrl("https://github.com/Orgs/x"), null);
	assert.equal(parseRepoUrl("https://github.com/a/.git"), null);
	assert.equal(parseRepoUrl("https://github.com/a/..git"), null);
	assert.equal(parseRepoUrl(undefined), null);
	assert.deepEqual(parseRepoUrl("https://github.com/a/b.github.io"), { owner: "a", repo: "b.github.io" });
});
