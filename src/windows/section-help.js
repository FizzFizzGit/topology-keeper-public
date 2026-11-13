const { DENSE_MEAN_DEGREE_THRESHOLD } = require('../analysis/combined-area-style');

// 説明の内容を選ぶアプリ側のモジュール。DOMやポップオーバーの表示処理は持たない。
// 翻訳関数を受け取るので、Obsidianなしでも日英それぞれの内容を検証できる。
function sectionHelp(key, t) {
  const descriptions = {
    orphan: 'window.isolationInfo', managedOrphan: 'window.managedInfo',
    bases: 'window.basesInfo', assets: 'window.assetsInfo',
  };
  if (key === 'distanceAreas') {
    return [
      ['info.distance', 'area.floydWarshallHelp', 'area.distanceHelp'],
      ['info.reading', 'area.primitiveHelp'],
      ['info.kuratowski', 'area.kuratowskiHelp', 'area.distancePlanarityHelp'],
      ['info.colors', 'area.meanDegreeHelp', 'area.distanceColorsHelp', 'window.colorsInfo'],
    ].map(([heading, ...paragraphs]) =>
      [`### ${t(heading)}`, ...paragraphs.map(id => t(id, { threshold: DENSE_MEAN_DEGREE_THRESHOLD }))]
        .join('\n\n')).join('\n\n');
  }
  if (key !== 'planar') return t(descriptions[key] ?? 'window.infoDefault');
  const parts = [];
  const heading = id => parts.push(`### ${t(id)}`);
  const paragraph = id => parts.push(t(id));
  heading('info.reading');
  paragraph('window.areasInfo');
  paragraph('area.parentHelp');
  paragraph('area.primitiveHelp');
  heading('info.kuratowski');
  paragraph('area.kuratowskiHelp');
  {
    heading('info.classification');
    paragraph('area.classificationInfo');
    paragraph('area.classificationDensity');
    parts.push(['area.classificationDensePlanar', 'area.classificationSparsePlanar',
      'area.classificationDenseNonplanar', 'area.classificationSparseNonplanar'].map(id => `- ${t(id)}`).join('\n'));
    paragraph('area.classificationCaveat');
  }
  heading('info.colors');
  parts.push(t('area.meanDegreeHelp', { threshold: DENSE_MEAN_DEGREE_THRESHOLD }));
  paragraph('window.colorsInfo');
  heading('info.caveats');
  paragraph('area.planarCaveat');
  paragraph('area.remainderHelp');
  return parts.join('\n\n');
}

module.exports = { sectionHelp };
