const { t } = require('./i18n');
// タグ提案の流れをまとめる。特徴抽出と各スコア計算は個別アルゴリズムのモジュールに委譲する。
const { Modal } = require("obsidian");
const { TAG_SUGGEST } = require("./tag-suggest-config");
const { buildCompoundWhitelist } = require("./tag-suggest-tokenizer");
const { buildTagDoc, frontmatterEndOffset } = require("./tag-suggest-document");
const { structureSimilarity } = require("./tag-suggest-structure");
const { createBm25Index } = require("./tag-suggest-bm25");
const { createTagSvmTrainer } = require("./tag-suggest-svm");

async function prepareTagCorpus(app, files, corpusCache) {
    const snapshot = corpusCache?.snapshot(app, files);
    const retained = corpusCache?.get(snapshot);
    if (retained) return retained;
    // 対象ノートと管理対象外ノートを読み込む。Vaultのファイル名は特徴量には使わない。
    const sources = [];
    for (const file of files) {
        const raw = await app.vault.cachedRead(file);
        const cache = app.metadataCache.getFileCache(file);
        const start = frontmatterEndOffset(raw, cache?.frontmatterPosition?.end?.offset);
        const text = raw.slice(start, start + TAG_SUGGEST.maxChars).replace(/```[\s\S]*?```/g, " ");
        sources.push({ file, path: file.path, raw, text });
    }
    // 複数ノートで反復された分割語の連結だけを許可し、語彙特徴に追加する。
    const compoundWhitelist = buildCompoundWhitelist(sources);
    const docs = new Map();
    for (const source of sources) {
        docs.set(source.path, await buildTagDoc(app, source.file, source.raw, compoundWhitelist));
    }
    const value = { docs, index: createBm25Index(docs, TAG_SUGGEST.bm25) };
    const latest = corpusCache?.snapshot(app, files);
    if (snapshot && latest?.key === snapshot.key && latest.revision === snapshot.revision) corpusCache.set(snapshot, value);
    return value;
}

async function computeTagSuggestions(app, target, isManaged, stopWords = [], corpusCache = null) {
    const files = app.vault.getMarkdownFiles().filter((file) => file.path === target.path || !isManaged(file));
    const { docs, index } = await prepareTagCorpus(app, files, corpusCache);
    const me = docs.get(target.path);
    if (!me) return [];

    // BM25F語彙スコアと文書構成スコアを合成し、タグ投票に使う近傍を順位付けする。
    const { df, vectors, cosine } = index;
    const myVector = vectors.get(target.path);
    const similarDocs = [];
    for (const doc of docs.values()) {
        if (doc.file.path === target.path || doc.tags.size === 0) continue;
        const lexical = cosine(myVector, vectors.get(doc.file.path));
        if (lexical <= 0) continue;
        const structure = structureSimilarity(me.structure, doc.structure);
        // structureWeightはランキングへの寄与率。語彙一致が0のノートは候補近傍にしない。
        const score = (1 - TAG_SUGGEST.structureWeight) * lexical + TAG_SUGGEST.structureWeight * structure;
        similarDocs.push({ d: doc, s: score, structure });
    }
    similarDocs.sort((a, b) => b.s - a.s);
    const top = similarDocs.slice(0, TAG_SUGGEST.k);
    // 上位k件のタグを類似度で加重投票する。類似度の合計で割り、ノート数に依存しない0〜1値にする。
    const topSum = top.reduce((sum, item) => sum + item.s, 0);
    const knn = new Map();
    const similarCount = new Map();
    const structureEvidence = new Map();
    for (const { d: doc, s: score, structure } of top) {
        for (const tag of doc.tags) {
            knn.set(tag, (knn.get(tag) ?? 0) + score / topSum);
            similarCount.set(tag, (similarCount.get(tag) ?? 0) + 1);
            const evidence = structureEvidence.get(tag) ?? { weighted: 0, weight: 0 };
            evidence.weighted += structure * score;
            evidence.weight += score;
            structureEvidence.set(tag, evidence);
        }
    }

    // 直接リンクは別の補助信号として集計し、文書類似度の投票と区別して根拠表示する。
    const links = app.metadataCache.resolvedLinks ?? {};
    const neighbors = new Set(Object.keys(links[target.path] ?? {}));
    for (const [source, destinations] of Object.entries(links)) {
        if (destinations[target.path]) neighbors.add(source);
    }
    const taggedNeighbors = [...neighbors].map((path) => docs.get(path)).filter((doc) => doc && doc.tags.size > 0);
    const link = new Map();
    const linkCount = new Map();
    for (const doc of taggedNeighbors) for (const tag of doc.tags) {
        link.set(tag, (link.get(tag) ?? 0) + 1 / taggedNeighbors.length);
        linkCount.set(tag, (linkCount.get(tag) ?? 0) + 1);
    }

    // 十分な学習例があるタグはSVMで再評価。例が少ないタグはKNNとリンクの投票へフォールバック。
    const trainTagSvm = createTagSvmTrainer(docs, vectors, target.path, similarDocs, TAG_SUGGEST.svm);
    const linkWeight = taggedNeighbors.length ? TAG_SUGGEST.linkWeight : 0;
    const existing = [];
    for (const tag of new Set([...knn.keys(), ...link.keys()])) {
        if (me.tags.has(tag)) continue;
        const knnScore = knn.get(tag) ?? 0;
        const linkScore = link.get(tag) ?? 0;
        const margin = trainTagSvm(tag);
        if (margin !== null && margin < 0) continue;
        // sigmoidはSVMの符号付きマージンを表示・合成用に0〜1へ写す単調変換で、確率校正ではない。
        const svmFit = margin === null ? null : 1 / (1 + Math.exp(-2 * margin));
        const score = svmFit === null
            ? (1 - linkWeight) * knnScore + linkWeight * linkScore
            : 0.65 * svmFit + 0.2 * knnScore + 0.15 * linkScore;
        if (score < TAG_SUGGEST.minScore) continue;
        const evidence = structureEvidence.get(tag);
        existing.push({
            tag,
            score,
            svmFit,
            whyCount: similarCount.get(tag) ?? 0,
            structureFit: evidence ? evidence.weighted / evidence.weight : null,
            linkWhyCount: linkCount.get(tag) ?? 0,
        });
    }
    existing.sort((a, b) => b.score - a.score);
    existing.splice(TAG_SUGGEST.maxSuggest);

    // 新規タグ候補は対象文書のBM25F上位語から作る。既存タグ、ストップワード、短い漢字断片などを除外。
    const known = new Set([...docs.values()].flatMap((doc) => [...doc.tags]).map((tag) => tag.toLowerCase()));
    const fresh = [];
    for (const [term, weight] of myVector.v) {
        const sourceWeight = me.srcMax.get(term) ?? 0;
        const bodyOk = TAG_SUGGEST.newFromBody && (me.bodyTf.get(term) ?? 0) >= TAG_SUGGEST.newMinBody;
        if (!sourceWeight && !bodyOk) continue;
        if (term.length > TAG_SUGGEST.newMaxLen) continue;
        if (/^\p{Script=Han}$/u.test(term)) continue;
        if (/^\d+$/.test(term) || !/^[\p{L}\p{N}_\-]+$/u.test(term)) continue;
        if (TAG_SUGGEST.skipInflected && /[\u3400-\u9fff][\u3040-\u309f]+$/.test(term)) continue;
        if (known.has(term) || stopWords.includes(term)) continue;
        const spread = (df.get(term) ?? 1) >= 2 ? 1 : 0.6;
        const boost = 1 + TAG_SUGGEST.newBoostMax * sourceWeight;
        const reasons = [];
        if (sourceWeight) reasons.push(t("tags.inHeading"));
        if (bodyOk) reasons.push(t('tags.repeated', { count: TAG_SUGGEST.newMinBody }));
        if ((df.get(term) ?? 1) >= 2) reasons.push(t("tags.multipleNotes"));
        fresh.push({ tag: term, weight: weight * spread * boost, why: reasons });
    }
    fresh.sort((a, b) => b.weight - a.weight);
    const maxWeight = fresh[0]?.weight || 1;
    const newTags = fresh
        .map((item) => ({ tag: item.tag, score: item.weight / maxWeight, why: item.why, isNew: true }))
        .filter((item) => item.score >= TAG_SUGGEST.newMinRel)
        .slice(0, TAG_SUGGEST.newMax);
    return [...existing, ...newTags];
}

class TagSuggestModal extends Modal {
    constructor(app, file, items, onSubmit) {
        super(app);
        this.file = file;
        this.items = items;
        this.onSubmit = onSubmit;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: t('tags.title', { name: this.file.basename }) });
        const checks = [];
        const addRows = (items, heading, isNew) => {
            if (!items.length) return;
            contentEl.createEl("h4", { text: heading });
            for (const item of items) {
                const row = contentEl.createDiv();
                const label = row.createEl("label");
                const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
                // 既存タグだけ適合度に応じて初期選択し、新規候補は誤追加防止のため未選択にする。
                checkbox.checked = !isNew && item.score >= TAG_SUGGEST.autoCheck;
                label.createSpan({ text: t('tags.item', { tag: item.tag, label: isNew ? t('tags.relativeScore') : t('tags.overallScore'), score: Math.round(item.score * 100) }) });
                if (item.svmFit !== null && item.svmFit !== undefined) {
                    row.createDiv({ cls: "alp-small", text: t('tags.svm', { score: Math.round(item.svmFit * 100) }) });
                }
                if (item.structureFit !== null && item.structureFit !== undefined) {
                    row.createDiv({ cls: "alp-small", text: t('tags.structure', { score: Math.round(item.structureFit * 100) }) });
                }
                if (item.whyCount) row.createDiv({ cls: "alp-small", text: t('tags.neighbors', { count: item.whyCount }) });
                if (item.linkWhyCount) row.createDiv({ cls: "alp-small", text: t('tags.links', { count: item.linkWhyCount }) });
                checks.push([item.tag, checkbox]);
            }
        };
        addRows(this.items.filter((item) => !item.isNew), t("tags.existing"), false);
        addRows(this.items.filter((item) => item.isNew), t("tags.new"), true);

        contentEl.createEl("h4", { text: t("tags.manual") });
        const free = contentEl.createEl("input", { attr: { type: "text", placeholder: t("tags.example") } });
        free.style.width = "100%";
        const button = contentEl.createEl("button", { text: t("tags.add"), cls: "mod-cta" });
        button.style.marginTop = "10px";
        button.addEventListener("click", () => {
            const picked = checks.filter(([, checkbox]) => checkbox.checked).map(([tag]) => tag);
            const typed = free.value.split(/\s+/).map((tag) => tag.replace(/^#+/, "")).filter(Boolean);
            this.onSubmit([...new Set([...picked, ...typed])]);
            this.close();
        });
    }
    onClose() { this.contentEl.empty(); }
}

module.exports = { computeTagSuggestions, TagSuggestModal };
