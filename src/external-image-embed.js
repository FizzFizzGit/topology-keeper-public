// 外部画像の埋め込み表示。
//
// 【このファイルの責務】
// Vault の外にある画像を、メタノートの埋め込み（![[メタノート]]）の位置に画像として表示する。
// あわせて、表示のために作った画像データの URL（Blob URL）を保持し、不要になったら解放する。
//
// 【切り出した理由】
// 画像の表示処理と、その表示用に確保したリソース（Blob URL のキャッシュ）の解放は、必ず対になっている。
// 片方が main.js の onload、もう片方が onunload に分かれていると、解放を書き忘れたときに気づきにくい。
// そのため、キャッシュを作る側が解放（dispose）も持つ形にして、対応を1か所で読めるようにした。
//
// 【責務の境界】
//   ここに置くもの : 埋め込み要素の検出と <img> への差し替え、元画像の読み込み、Blob URL のキャッシュと解放
//   ここに置かないもの: メタノートの作成・frontmatter の書き込み（main.js / base-manager.js）、
//                      source URL の生成と分解は source-url.js が担当。
//
// 【データの流れ】
//   Obsidian の Markdown 後処理 → render(el, ctx)
//     → 埋め込みのリンク先（メタノート）の frontmatter.source（"file:///..." のURL）
//     → getUrl(source)：Node の fs で元画像を読み、Blob URL を作ってキャッシュ
//     → <img src="blob:..."> を埋め込み要素に差し込む
//   プラグイン終了時（main.js の onunload）に dispose() が、キャッシュした Blob URL をすべて解放する。

const { TFile } = require("obsidian");
const fs = require("fs");
const path = require("path");
// FOLDERS は、設定画面で変更されても同じ参照のまま中身が更新される（plugin-settings.js 参照）ので、
// 直接読む。IMAGE_MIME_TYPES は、画像として扱う拡張子と MIME タイプの唯一の定義。
const { FOLDERS, IMAGE_MIME_TYPES, CONFIG } = require("./plugin-settings");
const { readImageFile } = require("./image-file");
const { pathFromSource, filenameFromSource } = require("./source-url");

class ExternalImageEmbed {
  // 【入力】
  //   app  : Obsidian の App。metadataCache でリンク先の解決とメタノートの frontmatter 取得に使う。
  //   deps : main.js が持つ共通の部品。モジュール間で同じ判定・変換を使うため、ここでは再定義せず受け取る。
  //          （設定に由来する FOLDERS と IMAGE_MIME_TYPES は、plugin-settings.js から直接読む。）
  //     inFolder(file, folder)   : file（TFile）が folder（Vault 相対パス）の配下か。
  //     isImage(pathOrName)      : 拡張子が画像として扱うもの（CONFIG.imageExtensions）か。
  //     embedClass         : 画像に差し替えた埋め込み要素に付ける CSS クラス名。
  constructor(app, deps) {
    this.app = app;
    this.deps = deps;
    // 表示用の画像のキャッシュ Map<元ファイルのOSパス, { mtimeMs, size, url }>。
    //   url は URL.createObjectURL で作った "blob:..." 形式の文字列。
    //   同じ元ファイルを何度も読み直さないための保持で、保存はしない（起動のたびに空から始まる）。
    //   url は、元ファイルが更新されて作り直すとき、および dispose() で、revokeObjectURL により解放する。
    this.urls = new Map();
    this.pending = new Map();
    this.disposed = false;
  }

  // 標準の ![[メタノート]] 埋め込みを、source が画像を指す場合だけ画像表示へ差し替える。
  // 通常の [[メタノート]] リンクや、画像以外のメタノートには介入しない。
  //
  // 【入力】 Obsidian の Markdown 後処理（registerMarkdownPostProcessor）から呼ばれる。
  //   el  : 描画済みの HTML の一部（ノートの一区画）。この中の `.internal-embed`（![[...]] の埋め込み）を探す。
  //   ctx : ctx.sourcePath は、この埋め込みを含むノートの Vault 相対パス。リンク解決の基準（リンク元）に使う。
  //   各 `.internal-embed` 要素の属性は Obsidian が設定する:
  //     src（または data-href / href） … 埋め込みに書かれたリンク文字列。サイズ指定つきなら "メタノート名|300" や
  //                                       "メタノート名|300x200" の形で入っていることがある。
  //     alt / width / height          … サイズ指定が属性側に展開されている場合がある。
  //   リンク先（getFirstLinkpathDest で解決）がメタノートで、その frontmatter.source（"file:///..." のURL）が
  //   画像の拡張子を指しているときだけ、元ファイルを読んで <img> に差し替える。
  // 【出力】 戻り値は無い。該当する埋め込み要素の中身を <img>（src は Blob の URL）に置き換え、
  //   二重処理を避けるため data-topology-keeper-image="true" を付ける。元ファイルは読むだけで変更しない。
  //   読み込みに失敗したときは置き換えず、Obsidian 標準の埋め込み表示のままにする。
  async render(el, ctx) {
    if (!this.deps.getSettings().enableExternalImageEmbeds) return;
    const { inFolder, isImage, embedClass } = this.deps;
    const embeds = el.querySelectorAll(".internal-embed");
    for (const embed of embeds) {
      if (embed.dataset.topologyKeeperImage === "true") continue;

      const rawLinkPath =
        embed.getAttribute("src") ||
        embed.getAttribute("data-href") ||
        embed.getAttribute("href");
      if (!rawLinkPath) continue;

      // ![[メタノート|300]] / ![[メタノート|300x200]] のサイズ指定を拾う。
      // Obsidian側が属性へ展開している場合もあるため、属性値も確認する。
      const sizeMatch = rawLinkPath.match(/\|(\d+)(?:x(\d+))?$/i);
      const altMatch = (embed.getAttribute("alt") || "").match(
        /^(\d+)(?:x(\d+))?$/i,
      );
      const widthAttr = Number(embed.getAttribute("width")) || 0;
      const heightAttr = Number(embed.getAttribute("height")) || 0;
      const width = Number(sizeMatch?.[1] || altMatch?.[1]) || widthAttr;
      const height = Number(sizeMatch?.[2] || altMatch?.[2]) || heightAttr;
      const linkPath = rawLinkPath.replace(/\|[^|]*$/, "");

      const target = this.app.metadataCache.getFirstLinkpathDest(
        linkPath,
        ctx.sourcePath,
      );
      if (!(target instanceof TFile) || !inFolder(target, FOLDERS.meta))
        continue;

      const source =
        this.app.metadataCache.getFileCache(target)?.frontmatter?.source;
      if (!source || !isImage(pathFromSource(source))) continue;

      try {
        const imageUrl = await this.getUrl(String(source));
        if (!this.deps.getSettings().enableExternalImageEmbeds) continue;
        // DOMがレンダリング中に破棄されていないことを確認する。
        if (!embed.isConnected) continue;

        const img = document.createElement("img");
        img.src = imageUrl;
        img.alt = filenameFromSource(source);
        img.className = "topology-keeper-external-image";
        img.draggable = false;
        if (width > 0) img.style.width = `${width}px`;
        if (height > 0) img.style.height = `${height}px`;

        embed.empty();
        embed.appendChild(img);
        embed.addClass(embedClass);
        embed.dataset.topologyKeeperImage = "true";
        embed.setAttribute("aria-label", img.alt);
      } catch (e) {
        // 読み込みに失敗した場合は標準の埋め込み表示を残す。
        console.warn(
          "Topology Keeper: 外部画像を埋め込み表示できませんでした。",
          source,
          e,
        );
      }
    }
  }

  // 元画像ファイルを読み込み、<img> に使える Blob の URL（"blob:..." 形式）を返す。
  //   入力 source: メタノートの frontmatter.source（"file:///..." 形式のURL文字列）。
  //   元ファイルは Vault の外にあるので、Obsidian の API ではなく Node の fs で直接読む。
  //   出力: URL.createObjectURL で作った URL。this.urls にキャッシュし、
  //         元ファイルの更新日時（mtimeMs）とサイズが変わらない間は再利用する。変わったら読み直して
  //         古い URL を解放する。残った URL はプラグイン終了時（dispose）にすべて解放する。
  //   MIME タイプは拡張子から決める（plugin-settings.js の IMAGE_MIME_TYPES。画像として扱う拡張子の
  //   一覧 CONFIG.imageExtensions も同じ表から作っているので、画像形式を増やすときは表に足すだけでよい）。
  //   render は isImage を通った source だけをここへ渡すので、表に無い拡張子は通常来ない。
  //   来た場合（直接呼ばれたとき）は "application/octet-stream" として扱う。
  async getUrl(source) {
    if (this.disposed) throw new Error("画像表示は終了しています。");
    const filePath = pathFromSource(source);
    if (!filePath) throw new Error("画像のローカルファイルURLが不正です。");
    if (this.pending.has(filePath)) return this.pending.get(filePath);
    // 大量の異なる埋め込みを同時に読み込まない。
    if (this.pending.size >= 4) {
      await Promise.race([...this.pending.values()].map(p => p.catch(() => {})));
      return this.getUrl(source);
    }
    const pending = this.loadUrl(filePath);
    this.pending.set(filePath, pending);
    try {
      return await pending;
    } finally {
      this.pending.delete(filePath);
    }
  }

  async loadUrl(filePath) {
    const stat = await fs.promises.stat(filePath);
    const cached = this.urls.get(filePath);
    if (
      cached &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size
    ) {
      this.urls.delete(filePath);
      this.urls.set(filePath, cached);
      return cached.url;
    }

    const bytes = await readImageFile(filePath);
    if (this.disposed) throw new Error("画像表示は終了しています。");
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = IMAGE_MIME_TYPES[ext] || "application/octet-stream";
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    if (cached?.url) URL.revokeObjectURL(cached.url);
    this.urls.delete(filePath);
    this.urls.set(filePath, {
      mtimeMs: stat.mtimeMs,
      size: bytes.length,
      url,
    });
    let totalBytes = [...this.urls.values()].reduce((sum, image) => sum + image.size, 0);
    while (this.urls.size > CONFIG.maxImageCacheEntries || totalBytes > CONFIG.maxImageCacheBytes) {
      const [key, image] = this.urls.entries().next().value;
      URL.revokeObjectURL(image.url);
      this.urls.delete(key);
      totalBytes -= image.size;
    }
    return url;
  }

  // キャッシュしている Blob URL をすべて解放し、キャッシュを空にする。
  // 【前提】 プラグイン終了時（main.js の onunload）に必ず呼ぶこと。呼ばないと、確保した画像データが
  //   解放されずにメモリへ残る（Blob URL は、解放するまでブラウザが画像データを保持し続ける）。
  //   すでに画面に差し込んだ <img> は、プラグイン終了で通常は破棄されるので、ここでは触らない。
  dispose() {
    this.disposed = true;
    for (const item of this.urls.values()) {
      if (item.url) URL.revokeObjectURL(item.url);
    }
    this.urls.clear();
  }
}

module.exports = ExternalImageEmbed;
