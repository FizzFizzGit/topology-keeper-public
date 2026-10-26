// タグ提案で使う共通パラメーター。
// スコア計算のロジックは各アルゴリズム別モジュールにあり、調整値だけをここに集約する。
const TAG_SUGGEST = {
    k: 8,                  // タグ投票に使う類似ノートの上限
    minScore: 0.15,        // 既存タグの最小提案スコア
    autoCheck: 0.4,        // 初期状態でチェックを付ける適合度
    maxSuggest: 6,         // 既存タグの最大提案数
    maxChars: 4000,        // frontmatter後の本文から解析する最大文字数
    linkWeight: 0.15,      // リンク近傍のタグ投票に使う補助比率
    structureWeight: 0.2,  // BM25F語彙類似度に加える文書構成類似度の比率
    // 線形SVM。負例を正例の最大5倍に抑え、少数タグの学習偏りを軽減する。
    svm: { minPositives: 2, maxNegativeRatio: 5, passes: 8, C: 1.0 },
    // BM25Fは見出しと本文を別フィールドとして採点し、見出しを優先する。
    bm25: {
        k1: 1.2,
        fields: {
            heading: { boost: 1.5, b: 0.4 },
            body: { boost: 1.0, b: 0.75 },
        },
        headingLevelWeights: { 1: 1.0, 2: 0.75, 3: 0.55, 4: 0.4, 5: 0.3, 6: 0.3 },
    },
    newMax: 4,             // 新規タグ候補の最大数
    newMaxLen: 16,         // 候補語の最大文字数
    newBoostMax: 1,        // 見出し由来語への追加倍率
    skipInflected: true,   // 活用語尾を持つ語を候補から除く
    newMinRel: 0.4,        // 最高候補に対する相対スコアの下限
    newFromBody: true,     // 本文で反復する語も候補に含める
    newMinBody: 4,         // 本文語を候補にする最低出現回数
};

module.exports = { TAG_SUGGEST };
