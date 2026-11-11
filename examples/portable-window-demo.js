// デモも利用側で翻訳を管理する例。ライブラリ本体へ言語判定や文言を混ぜない。
const demoMessages = {
  ja: { heading: '独立したウィンドウ部品',
    intro: 'Obsidian・ビルド・外部通信なし。見出しをドラッグし、開閉・折り畳み・画面サイズ変更を試せます。',
    open: 'ウィンドウを開く', title: 'キャラクターの入力例', close: 'ウィンドウを閉じる',
    body: 'この中身は利用側が渡した通常のHTMLです。', name: '名前', placeholder: '名前を入力',
    more: '追加の項目', row: index => `追加項目 ${index}：内容が増えると本文だけスクロールします。` },
  en: { heading: 'Standalone window components',
    intro: 'No Obsidian, build step or network access. Drag the header and try closing, reopening, expanding content and resizing the browser.',
    open: 'Open window', title: 'Character input example', close: 'Close window',
    body: 'The host application supplies this content as ordinary HTML.', name: 'Name', placeholder: 'Enter a name',
    more: 'Additional fields', row: index => `Additional field ${index}: only the body scrolls when content grows.` },
};
const language = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'ja';
const labels = demoMessages[language];
document.documentElement.lang = language;
document.title = labels.heading;
document.querySelector('#heading').textContent = labels.heading;
document.querySelector('#intro').textContent = labels.intro;
document.querySelector('#reopen').textContent = labels.open;

// 保存は利用側の責務。壊れた保存値やストレージ制限でもデモ自体は動作する。
let position;
try { position = JSON.parse(localStorage.getItem('pw-demo-position')); } catch {}
if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) position = { x: 80, y: 170 };
const panel = PortableWindow.createWindow({
  title: labels.title, closeLabel: labels.close, position,
  onPosition(value) { try { localStorage.setItem('pw-demo-position', JSON.stringify(value)); } catch {} },
});
// 外部から来る文言でもHTMLとして解釈しないよう、textContentで要素へ渡す。
const append = (parent, tag, text) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
};
append(panel.body, 'p', labels.body);
const label = append(panel.body, 'label', labels.name + ' ');
append(label, 'input').placeholder = labels.placeholder;
const details = append(panel.body, 'details');
append(details, 'summary', labels.more);
for (let i = 1; i <= 24; i++) append(details, 'p', labels.row(i));

// hideは内容を残す。SPAで利用画面を破棄する場合はpanel.destroy()を呼ぶ。
document.querySelector('#reopen').onclick = () => panel.show();
