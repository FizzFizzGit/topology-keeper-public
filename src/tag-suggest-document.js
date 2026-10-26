const { getAllTags } = require("obsidian");
const { TAG_SUGGEST } = require("./tag-suggest-config");
const { tokenizeForTags } = require("./tag-suggest-tokenizer");
const { analyzeDocumentStructure } = require("./tag-suggest-structure");

// Obsidianのキャッシュ位置を優先してYAML frontmatterを除く。
// キャッシュが未準備の場合は、先頭の --- ブロックを直接走査して除外する。
function frontmatterEndOffset(raw, cachedEnd) {
    if (Number.isInteger(cachedEnd) && cachedEnd >= 0) return cachedEnd;
    const opening = raw.match(/^(?:\uFEFF)?---[ \t]*\r?\n/);
    if (!opening) return 0;
    let offset = opening[0].length;
    while (offset <= raw.length) {
        const newline = raw.indexOf("\n", offset);
        const end = newline < 0 ? raw.length : newline;
        const line = raw.slice(offset, end).replace(/\r$/, "");
        if (/^---[ \t]*$/.test(line)) return newline < 0 ? raw.length : newline + 1;
        if (newline < 0) break;
        offset = newline + 1;
    }
    return 0;
}

async function buildTagDoc(app, file, raw, compoundWhitelist) {
    const cache = app.metadataCache.getFileCache(file);
    const start = frontmatterEndOffset(raw, cache?.frontmatterPosition?.end?.offset);
    // frontmatterとコードフェンスは特徴語の対象外。タグやメタデータ自身が
    // 類似度へ混入しないようにし、本文の先頭部分だけを解析する。
    const sourceText = raw.slice(start, start + TAG_SUGGEST.maxChars).replace(/```[\s\S]*?```/g, " ");
    const structure = analyzeDocumentStructure(sourceText);
    // 見出し語は専用フィールドで重み付けするため本文から外す。
    // Obsidianリンクは表示名ではなくリンク先ノート名を特徴語にする。
    const body = sourceText
        .replace(/^ {0,3}#{1,6}\s+.*$/gm, " ")
        .replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, "$1");
    const count = (tokens) => {
        const frequencies = new Map();
        for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
        return frequencies;
    };
    const bodyTokens = tokenizeForTags(body, compoundWhitelist);
    const bodyTf = count(bodyTokens);
    // 見出し階層別に頻度を集計。H1ほど強く、深い見出しほど小さく重み付けする。
    const headingTf = new Map();
    let headingLength = 0;
    const srcMax = new Map();
    for (const heading of cache?.headings ?? []) {
        const tokens = tokenizeForTags(heading.heading, compoundWhitelist);
        const levelWeight = TAG_SUGGEST.bm25.headingLevelWeights[heading.level] ?? TAG_SUGGEST.bm25.headingLevelWeights[6];
        headingLength += tokens.length;
        for (const [term, frequency] of count(tokens)) {
            headingTf.set(term, (headingTf.get(term) ?? 0) + frequency * levelWeight);
            srcMax.set(term, Math.max(srcMax.get(term) ?? 0, levelWeight));
        }
    }
    // 学習ラベルとして既存タグを読む。ここでは本文の語彙特徴には含めない。
    const tags = new Set((getAllTags(cache) ?? []).map((tag) => tag.replace(/^#/, "")));
    return {
        file,
        fields: {
            heading: { tf: headingTf, length: headingLength },
            body: { tf: bodyTf, length: bodyTokens.length },
        },
        bodyTf,
        srcMax,
        structure,
        tags,
    };
}

module.exports = { buildTagDoc, frontmatterEndOffset };
