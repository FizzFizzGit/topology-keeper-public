const { TFile } = require("obsidian");
const { randomUUID } = require("crypto");

const yamlSingleQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

// Base ファイル（Obsidian Bases の YAML テキスト）から、先頭ビューの表示名を取り出す。
//
// 【入力】 content: .base ファイルの全文（vault.cachedRead の結果）。
// 【出力】 表示名の文字列。見つからなければ ""。
// YAML として解析はせず、"views:" 以降で最初に現れる行頭インデント付きの `name:` を
// 文字列検索で拾い、前後の引用符（" または '）を外して返す。
// そのため、構造が通常と違う Base（views の前後に別の name: がある等）では、
// 意図と違う値を返す可能性がある。この関数が返した名前は
//   ・Base の表示名（loadBaseLabels）
//   ・同じメインノートで Base 名が重複していないかの確認（getLinkedBaseNames）
// に使われる。
const firstViewName = (content) => {
  const viewsIndex = content.indexOf("views:");
  if (viewsIndex < 0) return "";
  const views = content.slice(viewsIndex);
  const match = views.match(/^[ \t]+name:[ \t]*(.*?)[ \t]*$/m);
  if (!match) return "";
  return match[1].replace(
    /^(?:"([\s\S]*)"|'([\s\S]*)')$/,
    (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted,
  );
};

// Base のファイル名（拡張子なし）が UUID 形式かの判定。
// UUID 名なら表示名の末尾に先頭8桁だけを添えて区別する（loadBaseLabels）。
const isUuidName = (name) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    name,
  );

class BaseManager {
  constructor(plugin, { CONFIG, FOLDERS }) {
    this.plugin = plugin;
    this.CONFIG = CONFIG;
    this.FOLDERS = FOLDERS;
  }

  get app() {
    return this.plugin.app;
  }

  // 新しい Base ファイルの中身（YAML テキスト）を作る。
  //
  // 【Base の2種類の運用（ユーザーの設計意図。2026-10-21）】
  //   (1) メタノートをフィルタする Base（forMetaNotes = true）: 取り込み時に作る（import-workflow.js）。
  //       メタノートの管理フォルダ内にあり、かつ frontmatter.base にこの Base のファイル名を持つメタノートを表示する。
  //   (2) 通常用途の Base（forMetaNotes = false）: タグ条件を指定して作る（base-workflow.js の createStandalone）。
  //       メタノートとは無関係。このプラグインが担うのは「ファイル名を UUID にすること」と
  //       「Base 管理フォルダに置くこと」だけで、フィルタ条件は利用者が自由に決める（作成後に Obsidian 上で編集してよい）。
  //       そのため、フォルダ条件や所属条件は入れず、指定されたタグの条件だけを入れる。
  //
  // 【入力】
  //   viewName    : ビュー（カード一覧）の名前。JSON.stringify で引用符つきの文字列にして埋め込む。
  //   baseFileName: この Base のファイル名（"<uuid>.base"）。(1) の所属判定の値として埋め込む。(2) では使わない。
  //   tags        : タグ名の配列。"#" は付けない（例 ["資料", "研究/分類"]）。
  //   forMetaNotes: true なら (1)、false なら (2)。
  // 【出力】 Obsidian Bases 形式の YAML 文字列。フィルタ条件は AND で、次のとおり。
  //   (1): file.inFolder("<メタノートの管理フォルダ>") と、base.contains("<baseFileName>")
  //        （メタノートの frontmatter.base（Base名の配列）で所属を判定）、続けて tags の数だけ file.hasTag("<タグ>")
  //   (2): tags の数だけ file.hasTag("<タグ>")。tags が空なら、条件が1つも無いので `filters` 自体を書かない
  //        （`and:` だけを書くと中身が空のフィルタになるため）。この場合、Base は絞り込み無しで全ノートを対象にする。
  //   表示はカード形式で、画像は各ノートの frontmatter.cover（note.cover）を使う。(2) でも同じ形式にしている。
  //   戻り値は createGroupBase が vault.create でファイルの内容として書き込む。
  makeBaseContent(viewName, baseFileName, tags = [], forMetaNotes = true) {
    const { FOLDERS } = this;
    const filterLines = [
      ...(forMetaNotes
        ? [
            `        - file.inFolder(${JSON.stringify(FOLDERS.meta)})`,
            `        - ${yamlSingleQuote(`base.contains(${JSON.stringify(baseFileName)})`)}`,
          ]
        : []),
      ...tags.map((tag) => `        - ${yamlSingleQuote(`file.hasTag(${JSON.stringify(tag)})`)}`),
    ];
    return [
      "views:",
      "  - type: cards",
      `    name: ${JSON.stringify(viewName)}`,
      ...(filterLines.length ? ["    filters:", "      and:", ...filterLines] : []),
      "    image: note.cover",
      "    imageFit: contain",
      "    order:",
      "      - file.name",
      "",
    ].join("\n");
  }

  // 管理フォルダ内の .base ファイル（TFile）の一覧。孤立Base判定などで使う。
  listBases() {
    return this.app.vault
      .getFiles()
      .filter((file) => file.extension === "base" && file.path.startsWith(`${this.FOLDERS.base}/`));
  }

  // Vault 内の全 .base ファイルを読み、表示名を作って plugin.baseLabels に保持する。
  //
  // 【入力】 各 .base の本文（vault.cachedRead。直近のキャッシュを返すので、直後の書き込みが
  //          反映されていない場合がある）。先頭ビュー名を firstViewName で取り出す。
  // 【出力】 plugin.baseLabels = Map<Base の Vault相対パス, 表示名>
  //          表示名は「<ビュー名> · <識別子>」。識別子はファイル名が UUID なら先頭8桁、そうでなければファイル名。
  //          ビュー名が取れない・読み込みに失敗したときは、ファイル名（拡張子なし）をそのまま使う。
  //   baseLabels は外部ファイル欄（collectExternalEntries）と孤立Base一覧で、Base の名前表示に使われる。
  //   保存はせず、起動時と .base の変更時に作り直す。最後に小窓を再描画する。
  async loadBaseLabels() {
    const labels = new Map();
    const bases = this.app.vault.getFiles().filter((file) => file.extension === "base");
    for (const file of bases) {
      try {
        const content = await this.app.vault.cachedRead(file);
        const viewName = firstViewName(content);
        const identity = isUuidName(file.basename) ? file.basename.slice(0, 8) : file.basename;
        labels.set(file.path, viewName ? `${viewName} · ${identity}` : file.basename);
      } catch (error) {
        console.warn("Baseの表示名を読み取れません:", file.path, error);
        labels.set(file.path, file.basename);
      }
    }
    this.plugin.baseLabels = labels;
    this.plugin.mainView.render(true);
  }

  // 管理フォルダ（メタノート・サムネイル・Base）が無ければ作る。取り込みや Base 作成の前に呼ぶ。
  async ensureFolders() {
    for (const folder of Object.values(this.FOLDERS)) {
      if (!(await this.app.vault.exists(folder))) await this.app.vault.createFolder(folder);
    }
  }

  // 既存のメタノートを「元ファイルの場所」で引けるようにした索引を作る。
  //
  // 【入力】 管理フォルダ内の各メタノートの frontmatter.source
  //          （"file:///C:/dir/a.png" 形式のURL文字列。source-url.js の toSourceUrl が作る）。
  // 【出力】 Map<source文字列, メタノートの TFile>。同じ元ファイルを再度取り込むときに、
  //          メタノートを新しく作らず既存のものを再利用するために使う（import-workflow.js）。
  scanVault() {
    const metaBySource = new Map();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(`${this.FOLDERS.meta}/`)) continue;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (frontmatter?.source) metaBySource.set(String(frontmatter.source), file);
    }
    return metaBySource;
  }

  // メタノートの frontmatter.base（所属する Base のファイル名の配列）に、Base を1つ追加する。
  //
  // 【入力】 file: メタノートの TFile。baseFileName: "<uuid>.base"。
  // 【出力】 file の frontmatter.base が文字列の配列になる（重複は追加しない）。
  //          もとが単一の文字列なら配列に直す。Base 側の `base.contains(...)` フィルタが
  //          この値を見てカードに表示するかを決める。
  //   processFrontMatter(file, fn) は Obsidian の API。fn に渡される frontmatter オブジェクトを
  //   書き換えると、その内容がファイル先頭の YAML に書き戻される。
  async addMetaBaseName(file, baseFileName) {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const current = frontmatter.base;
      const names = Array.isArray(current) ? current.map(String) : current ? [String(current)] : [];
      if (!names.includes(baseFileName)) names.push(baseFileName);
      frontmatter.base = names;
    });
  }

  // メインノートの links から Base を辿り、そのビュー名の集合を返す。
  //
  // 【入力】 mainNote: メインノートの TFile。frontmatter.links（"[[<uuid>.base]]" などの配列）。
  // 【出力】 Set<ビュー名>。ファイル名ではなく、Base の中に書かれた先頭ビューの名前。
  //   用途: 同じメインノートに同名の Base を作らせない（import-workflow.js の重複確認）。
  //   Base が読めなかったときは警告を出して、その Base だけ飛ばす。
  async getLinkedBaseNames(mainNote) {
    const names = new Set();
    const frontmatter = this.app.metadataCache.getFileCache(mainNote)?.frontmatter;
    for (const raw of [].concat(frontmatter?.[this.CONFIG.properties.links] ?? [])) {
      const match = /^\[\[([^\]|#]+)/.exec(String(raw).trim());
      if (!match) continue;
      const target = this.app.metadataCache.getFirstLinkpathDest(match[1], mainNote.path);
      if (!(target instanceof TFile) || target.extension !== "base") continue;
      try {
        const viewName = firstViewName(await this.app.vault.cachedRead(target));
        if (viewName) names.add(viewName);
      } catch (error) {
        console.warn("Base名を読み取れません:", target.path, error);
      }
    }
    return names;
  }

  // 新しい Base ファイルを管理フォルダに作る。
  // 【出力】 作った Base の TFile。ファイル名は "<ランダムなUUID>.base"。
  //   名前を UUID にするのは、表示名（ビュー名）を変えても、メタノートの frontmatter.base や
  //   メインノートの links が指す識別子が変わらないようにするため。表示名はファイルの中（ビュー名）に持つ。
  async createGroupBase(viewName, tags = [], forMetaNotes = true) {
    const fileName = `${randomUUID()}.base`;
    return this.app.vault.create(
      `${this.FOLDERS.base}/${fileName}`,
      this.makeBaseContent(viewName, fileName, tags, forMetaNotes),
    );
  }

  // ノートの frontmatter.links に、リンクを追記する。
  //
  // 【入力】 file: 追記先のメインノートの TFile。names: リンクにする名前の配列
  //          （メタノートは basename、Base は "<uuid>.base"、Vault内ファイルは Vault 相対パス）。
  // 【出力】 frontmatter.links が "[[名前]]" 文字列の配列になる。すでにあるものは重複して足さない。
  //          戻り値は「新しく追加した件数」で、登録完了の通知に使う。
  async appendLinks(file, names) {
    let count = 0;
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const links = [].concat(frontmatter[this.CONFIG.properties.links] ?? []);
      for (const name of names) {
        const link = `[[${name}]]`;
        if (!links.includes(link)) {
          links.push(link);
          count++;
        }
      }
      frontmatter[this.CONFIG.properties.links] = links;
    });
    return count;
  }
}

module.exports = BaseManager;
