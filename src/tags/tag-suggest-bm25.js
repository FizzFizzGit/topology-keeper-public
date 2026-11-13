// BM25Fの文書ベクトルを作り、文書間の語彙類似度を返す。
// BM25FはBM25を複数フィールドへ拡張し、ここでは「見出し」と「本文」を別々に正規化する。
function createBm25Index(docs, config) {
    const N = docs.size;
    const df = new Map();
    const fieldNames = Object.keys(config.fields);
    const avgLength = new Map();
    // 各フィールドの平均長。文書長の違いによる単純な頻度差を補正する基準値。
    for (const name of fieldNames) {
        const total = [...docs.values()].reduce((sum, doc) => sum + doc.fields[name].length, 0);
        avgLength.set(name, total / (N || 1) || 1);
    }
    // df（document frequency）は、その語が何ノートに現れたか。
    // どのフィールドに出ても、そのノートでは1回として数える。
    for (const doc of docs.values()) {
        const terms = new Set(fieldNames.flatMap((name) => [...doc.fields[name].tf.keys()]));
        for (const term of terms) df.set(term, (df.get(term) ?? 0) + 1);
    }
    const toVector = (doc) => {
        const vector = new Map();
        let squaredNorm = 0;
        const terms = new Set(fieldNames.flatMap((name) => [...doc.fields[name].tf.keys()]));
        for (const term of terms) {
            // BM25Fのフィールド統合頻度。boostで見出しを優先し、bで長さ補正の強さを決める。
            let weightedTf = 0;
            for (const name of fieldNames) {
                const { boost, b } = config.fields[name];
                const field = doc.fields[name];
                const norm = (1 - b) + b * (field.length / avgLength.get(name));
                weightedTf += boost * (field.tf.get(term) ?? 0) / norm;
            }
            // Robertson-Sparck Jones型IDF。多くのノートに出る一般語ほど重みを下げる。
            const idf = Math.log(1 + (N - df.get(term) + 0.5) / (df.get(term) + 0.5));
            // BM25の飽和関数。頻出語は評価するが、回数に比例して無限に強くならない。
            const weight = idf * ((config.k1 + 1) * weightedTf) / (config.k1 + weightedTf);
            vector.set(term, weight);
            squaredNorm += weight * weight;
        }
        return { v: vector, norm: Math.sqrt(squaredNorm) || 1 };
    };
    const vectors = new Map([...docs.values()].map((doc) => [doc.file.path, toVector(doc)]));
    // BM25重みをL2正規化してコサイン類似度を計算する。
    // 小さい側の疎ベクトルだけ走査して、語彙が大きいVaultでも比較量を抑える。
    const cosine = (a, b) => {
        const [small, large] = a.v.size <= b.v.size ? [a, b] : [b, a];
        let dot = 0;
        for (const [term, weight] of small.v) {
            const other = large.v.get(term);
            if (other) dot += weight * other;
        }
        return dot / (a.norm * b.norm);
    };
    return { df, vectors, cosine };
}

module.exports = { createBm25Index };
