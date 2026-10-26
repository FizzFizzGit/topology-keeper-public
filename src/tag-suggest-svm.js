const { STRUCTURE_FEATURES } = require("./tag-suggest-structure");

// 疎な特徴ベクトル同士の内積。語彙・構造特徴の共通部分だけを計算する。
function sparseDot(a, b) {
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    let sum = 0;
    for (const [key, value] of small) sum += value * (large.get(key) ?? 0);
    return sum;
}

function createTagSvmTrainer(docs, vectors, targetPath, similarDocs, settings) {
    // 構造量の桁を揃えるため、Vault内の平均と標準偏差で標準化する。
    // BM25F語彙ベクトルと構成ベクトルを連結し、単位長に正規化して線形SVMへ渡す。
    const structureStats = Object.fromEntries(STRUCTURE_FEATURES.map((key) => {
        const values = [...docs.values()].map((doc) => doc.structure[key]);
        const mean = values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
        const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length || 1);
        return [key, { mean, sd: Math.sqrt(variance) || 1 }];
    }));
    const toFeatures = (doc) => {
        const base = vectors.get(doc.file.path);
        const features = new Map([...base.v].map(([term, weight]) => [term, weight / base.norm]));
        for (const key of STRUCTURE_FEATURES) {
            const { mean, sd } = structureStats[key];
            const z = Math.max(-3, Math.min(3, (doc.structure[key] - mean) / sd));
            features.set(`\0structure:${key}`, z * 0.5);
        }
        features.set("\0bias", 0.5);
        const norm = Math.sqrt([...features.values()].reduce((sum, value) => sum + value * value, 0)) || 1;
        for (const [key, value] of features) features.set(key, value / norm);
        return features;
    };
    const svmVectors = new Map([...docs.values()].map((doc) => [doc.file.path, toFeatures(doc)]));

    // 呼び出し側がタグごとに学習できる関数を返す。
    // 既存タグ付きノートを正例、対象に近いがそのタグを持たないノートを負例にする。
    return (tag) => {
        const positives = [...docs.values()].filter((doc) => doc.file.path !== targetPath && doc.tags.has(tag));
        if (positives.length < settings.minPositives) return null;
        const positivePaths = new Set(positives.map((doc) => doc.file.path));
        // 負例が過剰だと少数の正例を押し流すため、正例数の一定倍に打ち切る。
        const negatives = similarDocs
            .map((item) => item.d)
            .filter((doc) => doc.tags.size > 0 && !positivePaths.has(doc.file.path) && !doc.tags.has(tag))
            .slice(0, positives.length * settings.maxNegativeRatio);
        if (negatives.length < 2) return null;
        const examples = [
            ...positives.map((doc) => ({ x: svmVectors.get(doc.file.path), y: 1 })),
            ...negatives.map((doc) => ({ x: svmVectors.get(doc.file.path), y: -1 })),
        ];
        const weights = new Map();
        // 線形SVMのヒンジ損失を確率的部分勾配法で最小化する。
        // 目的関数は L2正則化 + クラス均衡したヒンジ損失。
        const lambda = 1 / settings.C;
        let step = 0;
        for (let pass = 0; pass < settings.passes; pass++) {
            for (const { x, y } of examples) {
                step++;
                const rate = 1 / (lambda * step);
                // L2正則化による重みの縮小。
                const shrink = Math.max(0, 1 - rate * lambda);
                for (const [key, value] of weights) {
                    const updated = value * shrink;
                    if (Math.abs(updated) < 1e-10) weights.delete(key);
                    else weights.set(key, updated);
                }
                // 正解マージンが1以上ならヒンジ損失は0なので、損失勾配を加えない。
                if (y * sparseDot(weights, x) >= 1) continue;
                const classWeight = y > 0 ? 0.5 / positives.length : 0.5 / negatives.length;
                const update = rate * classWeight * y;
                for (const [key, value] of x) weights.set(key, (weights.get(key) ?? 0) + update * value);
            }
        }
        // 返す値は符号付きマージン（正なら境界の正例側）。確率そのものではない。
        return sparseDot(weights, svmVectors.get(targetPath));
    };
}

module.exports = { createTagSvmTrainer };
