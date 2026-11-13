'use strict';

/**
 * 纯逻辑的小工具：渲染进程和单元测试共用。
 * 既支持 <script> 直接引入（挂到 window.DSFormat），也支持 require。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DSFormat = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function formatClock(totalSeconds) {
    const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
  }

  function clamp(value, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return min;
    return Math.min(max, Math.max(min, num));
  }

  function greeting(hour) {
    const h = Number.isFinite(Number(hour)) ? Number(hour) : new Date().getHours();
    if (h < 5) return '夜深了';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }

  return { formatClock, clamp, greeting };
});
