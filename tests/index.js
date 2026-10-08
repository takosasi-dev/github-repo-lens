// `node --test tests/` の入口。Node 24 はフォルダの引数をテストのファイルに広げないので、ここで全部を読み込む。
// 担当ごとのテストのファイルは INTERFACES.md §1 の表のとおり。
import "./repourl.test.js";
import "./units.test.js";
import "./repofmt.test.js";
import "./checks.test.js";
import "./actions.test.js";
import "./api.test.js";
import "./lens.test.js";
import "./settings.test.js";
import "./badge.test.js";
import "./static.test.js";
import "./popup.test.js";
