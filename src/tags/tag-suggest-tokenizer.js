// 日本語を空白依存の正規表現で切らず、ランタイムの形態素境界で単語候補に分ける。
const TAG_SEGMENTER = new Intl.Segmenter("ja", { granularity: "word" });

function wordParts(text) {
    // isWordLike=false の空白・句読点などを除き、元テキスト上の位置も保持する。
    return [...TAG_SEGMENTER.segment(text)].filter((part) => part.isWordLike);
}

function isKeptWord(word) {
    // 一文字助詞や一文字英数を落とし、後段の類似度をノイズで埋めない。
    return !/^[\u3040-\u309f]{1,2}$/.test(word) &&
        !(word.length < 2 && !/[\u3400-\u9fff]/.test(word));
}

function collectCompoundCandidates(text, visit) {
    const parts = wordParts(text);
    for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length && j < i + 6; j++) {
            // 空白・句読点をまたがず、助詞程度のひらがなだけを間に含む連結語を調べる。
            const gap = text.slice(parts[j - 1].index + parts[j - 1].segment.length, parts[j].index);
            if (!/^[\u3040-\u309f]*$/.test(gap)) break;
            if (!isKeptWord(parts[j].segment.toLowerCase()) || !isKeptWord(parts[i].segment.toLowerCase())) continue;
            const phrase = text.slice(parts[i].index, parts[j].index + parts[j].segment.length).toLowerCase();
            if (phrase.length <= 24 && /^[\p{L}\p{N}_\-]+$/u.test(phrase)) visit(phrase);
        }
    }
}

function buildCompoundWhitelist(sources) {
    // 偶然の隣接語を複合語と誤認しないよう、複数ノートで反復した連結だけを採用する。
    // docCounts は文書頻度、counts はVault全体での出現回数を表す。
    const counts = new Map();
    const docCounts = new Map();
    for (const { text } of sources) {
        const seen = new Set();
        collectCompoundCandidates(text, (phrase) => {
            counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
            seen.add(phrase);
        });
        for (const phrase of seen) docCounts.set(phrase, (docCounts.get(phrase) ?? 0) + 1);
    }
    const whitelist = new Set();
    for (const [phrase, count] of counts) {
        if ((docCounts.get(phrase) ?? 0) >= 2 && count >= 3) whitelist.add(phrase);
    }
    return whitelist;
}

function tokenizeForTags(text, compoundWhitelist = new Set()) {
    const parts = wordParts(text);
    const out = [];
    for (const part of parts) {
        const word = part.segment.toLowerCase();
        if (isKeptWord(word)) out.push(word);
    }
    // 元の分割語を残したまま、許可済み複合語も追加する（置換ではなく補助特徴）。
    collectCompoundCandidates(text, (phrase) => { if (compoundWhitelist.has(phrase)) out.push(phrase); });
    return out;
}

module.exports = { tokenizeForTags, buildCompoundWhitelist };
