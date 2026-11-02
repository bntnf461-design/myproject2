// 以前のテスト用：作業開始・終了の機能をオフにした状態で動かす
module.exports = () => {
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'defectCounterState') {
      try { const o = JSON.parse(v); o.features = Object.assign({}, o.features); if (o.features.jobs === undefined) o.features.jobs = false; v = JSON.stringify(o); } catch (e) {}
    }
    return orig.call(this, k, v);
  };
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof state !== 'undefined' && state.features && state.features.jobs && !localStorage.getItem('__jobsTest')) { state.features.jobs = false; saveState(); renderAll(); }
  });
};
