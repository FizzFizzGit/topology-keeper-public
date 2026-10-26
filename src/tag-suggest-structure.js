const { tokenizeForTags } = require("./tag-suggest-tokenizer");

// 文書構成を数値ベクトル化するモジュール。
// 個別の用語（STRやSANなど）を探すのではなく、見出し・表・本文・リストの
// 数と分布を特徴にする。行列サイズは細かい差に過剰適合しないよう区間化する。
const ROW_BINS = ["1", "2", "3-5", "6-10", "11+"];
const COL_BINS = ["1", "2", "3", "4", "5+"];
const STRUCTURE_FEATURES = [
    "sectionCount", "tableCount", "tableRowCount", "tableCellCount",
    "proseBlockCount", "proseLineCount", "proseCharCount",
    "listBlockCount", "listLineCount", "listCharCount",
    "sectionShare", "tableShare", "proseShare", "listShare",
    ...Array.from({ length: 6 }, (_, i) => `headingLevel${i + 1}`),
    ...ROW_BINS.map((bin) => `tableRows:${bin}`),
    ...COL_BINS.map((bin) => `tableCols:${bin}`),
    ...ROW_BINS.flatMap((row) => COL_BINS.map((col) => `tableShape:${row}x${col}`)),
];

function rowBin(value) {
    if (value <= 1) return "1";
    if (value === 2) return "2";
    if (value <= 5) return "3-5";
    if (value <= 10) return "6-10";
    return "11+";
}

function colBin(value) {
    return value >= 5 ? "5+" : String(Math.max(1, value));
}

function analyzeDocumentStructure(text) {
    const sourceLines = text.split(/\r?\n/);
    const profile = Object.fromEntries(STRUCTURE_FEATURES.map((key) => [key, 0]));
    const headingTerms = new Map();
    // prose/list/table は空行・見出し・種類の切り替わりで区切ったブロック数。
    const blocks = { table: 0, prose: 0, list: 0 };
    let currentType = "";
    let currentLines = [];
    const tableGroups = [];
    let currentTable = [];
    const flushBlock = () => {
        if (!currentType || !currentLines.length) return;
        const prefix = currentType === "prose" ? "prose" : "list";
        blocks[currentType]++;
        profile[`${prefix}BlockCount`]++;
        profile[`${prefix}LineCount`] += currentLines.length;
        profile[`${prefix}CharCount`] += currentLines.reduce((sum, line) => sum + line.length, 0);
        currentType = "";
        currentLines = [];
    };
    const flushTable = () => {
        if (currentTable.length) tableGroups.push(currentTable);
        currentTable = [];
    };
    for (const rawLine of sourceLines) {
        const line = rawLine.trim();
        if (!line) { flushBlock(); flushTable(); continue; }
        const heading = line.match(/^#{1,6}\s+(.+)$/);
        if (heading) {
            flushBlock(); flushTable();
            profile.sectionCount++;
            const level = line.match(/^#+/)[0].length;
            profile[`headingLevel${level}`]++;
            for (const term of tokenizeForTags(heading[1])) headingTerms.set(term, (headingTerms.get(term) ?? 0) + 1);
            continue;
        }
        // Markdownパイプ表を連続行のグループとして集め、後で行数と列数を計算する。
        if (/^\|.*\|$/.test(line)) {
            flushBlock();
            currentTable.push(line);
            continue;
        }
        flushTable();
        const isList = /^(?:[-*+]\s+|\d+[.)]\s+|>\s*)/.test(line);
        const type = isList ? "list" : "prose";
        if (currentType !== type) flushBlock();
        currentType = type;
        currentLines.push(line);
    }
    flushBlock();
    flushTable();

    // 表の区切り行（|---|---|）を除いて、データ行数・セル数・形状区間を記録する。
    for (const rows of tableGroups) {
        const dataRows = rows.filter((line) => !/^\|[\s|:-]+\|$/.test(line));
        if (!dataRows.length) continue;
        const cells = dataRows.map((line) => line.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).length);
        const columns = Math.max(...cells);
        const dataRowCount = dataRows.length;
        const rb = rowBin(dataRowCount);
        const cb = colBin(columns);
        blocks.table++;
        profile.tableCount++;
        profile.tableRowCount += dataRowCount;
        profile.tableCellCount += cells.reduce((sum, count) => sum + count, 0);
        profile[`tableRows:${rb}`]++;
        profile[`tableCols:${cb}`]++;
        profile[`tableShape:${rb}x${cb}`]++;
    }
    // 構成比は絶対量に左右されにくいよう、見出し・表・本文・リストの総ブロック数で正規化。
    const totalBlocks = profile.sectionCount + blocks.table + blocks.prose + blocks.list;
    if (totalBlocks) {
        profile.sectionShare = profile.sectionCount / totalBlocks;
        profile.tableShare = blocks.table / totalBlocks;
        profile.proseShare = blocks.prose / totalBlocks;
        profile.listShare = blocks.list / totalBlocks;
    }
    return { ...profile, headingTerms };
}

function ratioSimilarity(a, b) {
    // 数量比較: 両方0なら一致、片方だけ0なら0%、それ以外は小さい値/大きい値。
    const high = Math.max(a, b);
    return high === 0 ? 1 : Math.min(a, b) / high;
}

function distributionSimilarity(a, b, keys) {
    // 分布比較には全変動距離を使う。0なら分布一致、1なら完全に重なりがない。
    const totalA = keys.reduce((sum, key) => sum + a[key], 0);
    const totalB = keys.reduce((sum, key) => sum + b[key], 0);
    if (!totalA && !totalB) return 1;
    if (!totalA || !totalB) return 0;
    const distance = keys.reduce((sum, key) => sum + Math.abs(a[key] / totalA - b[key] / totalB), 0) / 2;
    return 1 - distance;
}

function termSimilarity(a, b) {
    // 見出し語の頻度ベクトルをコサイン比較し、文書構成スコアに見出し内容も含める。
    if (!a.size && !b.size) return 1;
    if (!a.size || !b.size) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (const [term, weight] of a) {
        normA += weight * weight;
        dot += weight * (b.get(term) ?? 0);
    }
    for (const weight of b.values()) normB += weight * weight;
    return dot / (Math.sqrt(normA * normB) || 1);
}

function structureSimilarity(a, b) {
    const headingLevels = Array.from({ length: 6 }, (_, i) => `headingLevel${i + 1}`);
    const composition = ["sectionShare", "tableShare", "proseShare", "listShare"];
    const tableShapes = ROW_BINS.flatMap((row) => COL_BINS.map((col) => `tableShape:${row}x${col}`));
    const tableSizes = [...ROW_BINS.map((bin) => `tableRows:${bin}`), ...COL_BINS.map((bin) => `tableCols:${bin}`)];
    // 各指標を0〜1に揃えた加重平均が最終スコア。
    // 表の形状と見出し語を比較の中心に置き、件数・本文量・全体バランスも加味する。
    // 返り値は確率ではなく、2文書間の構成的な近さを表す類似度。
    const metrics = [
        [0.12, ratioSimilarity(a.sectionCount, b.sectionCount)],
        [0.08, distributionSimilarity(a, b, headingLevels)],
        [0.12, termSimilarity(a.headingTerms, b.headingTerms)],
        [0.08, ratioSimilarity(a.tableCount, b.tableCount)],
        [0.18, distributionSimilarity(a, b, tableShapes)],
        [0.08, distributionSimilarity(a, b, tableSizes)],
        [0.10, ratioSimilarity(a.proseBlockCount, b.proseBlockCount)],
        [0.08, ratioSimilarity(a.proseLineCount, b.proseLineCount)],
        [0.04, ratioSimilarity(a.proseCharCount, b.proseCharCount)],
        [0.12, composition.reduce((sum, key) => sum + (1 - Math.min(1, Math.abs(a[key] - b[key]))), 0) / composition.length],
    ];
    return metrics.reduce((sum, [weight, similarity]) => sum + weight * similarity, 0);
}

module.exports = { analyzeDocumentStructure, structureSimilarity, STRUCTURE_FEATURES };
