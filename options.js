// 設定のページ(SC-03)。settings.js の loadSettings で読み、欄を離れたときと「保存」で checkField を当て、「保存」を押したときだけ saveSettings で 1 回書く。
// 壊れた設定(validateSettings の broken)は既定値を出して M-26 を出し、保存するまで元の値を上書きしない。残り回数は storage.session の rate だけを読む。
// DOM に文字を入れるのは textContent と textarea の value だけ(INV-4)。
import { loadSettings, saveSettings, checkField, README_ITEMS } from "./settings.js";
import { createApi, chromeSession, rateView } from "./api.js";
import { toLocalHm } from "./localtime.js";

const MSG_MS = 2000;
const $ = (id) => document.getElementById(id);
const icon = (name) => $("icons").content.querySelector(`[data-ic="${name}"]`).cloneNode(true);
const errors = new Map(); // 欄の名前 → 文
let current = null; // 読み込んだ(または保存した)設定
let msgTimer = null;

function el(tag, cls, text) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text != null) e.textContent = text;
	return e;
}

// 欄の名前(checkField の名前)→ 入力欄
function fields() {
	return [...document.querySelectorAll("[data-name]")];
}

function buildKeywordRows() {
	$("kw").replaceChildren(
		...README_ITEMS.map((item, i) => {
			const row = el("div", "kw-row");
			const label = el("label", null, item); // M-100a〜f
			label.htmlFor = `kw${i}`;
			const input = el("input", "in");
			input.id = `kw${i}`;
			input.type = "text";
			input.autocomplete = "off";
			input.dataset.name = `readmeHeadingKeywords.${item}`;
			row.append(label, input);
			return row;
		}),
	);
	for (const id of ["ownerLogin", "extraAllowedEmails", "binaryExts", "junkNames"]) $(id).dataset.name = id;
}

function fill(s) {
	$("ownerLogin").value = s.ownerLogin;
	$("includeForks").checked = s.includeForks;
	$("includeArchived").checked = s.includeArchived;
	for (const r of document.querySelectorAll('input[name="defaultFormat"]')) r.checked = r.value === s.defaultFormat;
	$("bullet").checked = s.bullet;
	$("includeHeader").checked = s.includeHeader;
	$("extraAllowedEmails").value = s.extraAllowedEmails.join("\n");
	$("binaryExts").value = s.binaryExts.join(", ");
	$("junkNames").value = s.junkNames.join(", ");
	README_ITEMS.forEach((item, i) => {
		$(`kw${i}`).value = s.readmeHeadingKeywords[item].join(", ");
	});
}

function setMsg(kind, text) {
	const msg = $("saveMsg");
	clearTimeout(msgTimer);
	msg.dataset.kind = kind ?? "";
	msg.className = kind ? `save-msg ${kind === "ok" ? "is-ok" : "is-ng"}` : "save-msg";
	msg.replaceChildren(...(kind ? [icon(kind === "ok" ? "check" : "alert"), el("span", null, text)] : []));
}

function updateSave() {
	const bad = errors.size > 0;
	$("save").disabled = bad;
	if (bad) setMsg("invalid", "誤りのある欄を直すと保存できる"); // M-33
	else if ($("saveMsg").dataset.kind === "invalid") setMsg(null);
}

// → { value } | { error }。欄の枠と直下の文も直す
function check(input) {
	const r = checkField(input.dataset.name, input.value);
	const errId = `${input.id}-err`;
	$(errId)?.remove();
	if (r.error) {
		errors.set(input.dataset.name, r.error);
		const p = el("p", input.closest(".kw-row") ? "err kw-err" : "err");
		p.id = errId;
		p.append(icon("alert"), el("span", null, r.error)); // M-27〜M-32
		(input.closest(".kw-row") ?? input).after(p);
		input.setAttribute("aria-invalid", "true");
		input.setAttribute("aria-describedby", errId);
	} else {
		errors.delete(input.dataset.name);
		input.removeAttribute("aria-invalid");
		input.removeAttribute("aria-describedby");
	}
	return r;
}

async function save() {
	const values = Object.fromEntries(fields().map((input) => [input.dataset.name, check(input)]));
	updateSave();
	if (errors.size > 0) return;
	const keywords = Object.fromEntries(README_ITEMS.map((item) => [item, values[`readmeHeadingKeywords.${item}`].value]));
	const next = {
		...current,
		ownerLogin: values.ownerLogin.value,
		includeForks: $("includeForks").checked,
		includeArchived: $("includeArchived").checked,
		defaultFormat: document.querySelector('input[name="defaultFormat"]:checked')?.value ?? current.defaultFormat,
		bullet: $("bullet").checked,
		includeHeader: $("includeHeader").checked,
		extraAllowedEmails: values.extraAllowedEmails.value,
		binaryExts: values.binaryExts.value,
		junkNames: values.junkNames.value,
		readmeHeadingKeywords: keywords,
	};
	try {
		await saveSettings(next);
		current = next;
		$("broken").hidden = true;
		setMsg("ok", "保存した"); // M-102a
	} catch (e) {
		setMsg("ng", `保存できなかった(${e?.message ?? String(e)})`); // M-34
	}
	msgTimer = setTimeout(() => setMsg(null), MSG_MS);
}

// §3.3。remaining は数だけ太字
async function renderRate() {
	const target = $("rate");
	const v = rateView(await createApi({ session: chromeSession() }).rate(), Date.now());
	if (v.state !== "known") return void (target.textContent = "残り 不明"); // M-51
	target.replaceChildren("残り ", el("span", "num", String(v.remaining)), " 回"); // M-48
	if (v.remaining === 0) {
		const iso = new Date(v.resetMs).toISOString();
		const hm = toLocalHm(iso, -new Date(iso).getTimezoneOffset());
		target.append(el("span", "rate-back", `(${hm} ${v.guessed ? "までに戻る" : "に戻る"})`)); // M-49・M-50
	}
}

async function main() {
	buildKeywordRows();
	const { settings, broken } = await loadSettings();
	current = settings;
	fill(settings);
	$("broken").hidden = !broken; // SC-03-S3・M-26
	const form = $("form");
	form.addEventListener("submit", (e) => e.preventDefault());
	form.addEventListener("focusout", (e) => {
		if (e.target.dataset?.name) {
			check(e.target);
			updateSave();
		}
	});
	form.addEventListener("input", (e) => {
		if (e.target.dataset?.name && errors.has(e.target.dataset.name)) {
			check(e.target);
			updateSave();
		}
	});
	form.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && e.target.matches?.('input[type="text"]')) {
			e.preventDefault();
			if (!$("save").disabled) save();
		}
	});
	$("save").addEventListener("click", save);
	await renderRate();
}

main();
