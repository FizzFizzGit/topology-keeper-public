const { CONFIG } = require('../settings/plugin-settings');

const DENSE_MEAN_DEGREE_THRESHOLD = 3.5;

function combinedAreaMeanDegree({ nodes, links }) {
  // 1本の無向辺は両端の頂点に接続する。
  return nodes.length ? 2 * links.length / nodes.length : 0;
}

function combinedAreaCategory(classification, meanDegree) {
  const dense = meanDegree >= DENSE_MEAN_DEGREE_THRESHOLD;
  if (classification === 'planar') return dense ? 'densePlanar' : 'sparsePlanar';
  if (classification === 'nonplanar') return dense ? 'denseNonplanar' : 'sparseNonplanar';
  return 'undetermined';
}

function combinedAreaColors(colors) {
  return {
    densePlanar: colors.densePlanar ?? CONFIG.clusterHighlightColor,
    sparsePlanar: colors.planar ?? CONFIG.graphPlanarColor,
    denseNonplanar: colors.nonplanar ?? CONFIG.graphNonPlanarColor,
    sparseNonplanar: colors.undetermined ?? CONFIG.graphUndeterminedColor,
    undetermined: null,
  };
}

module.exports = { combinedAreaCategory, combinedAreaColors, combinedAreaMeanDegree, DENSE_MEAN_DEGREE_THRESHOLD };
