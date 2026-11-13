'use strict';

/**
 * 表情包元数据。图片在 src/renderer/assets/stickers/<file>。
 * 亲密度越高，解锁的越多，发得也越勤。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DSStickers = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STICKERS = [
    {
      id: 'happy',
      file: 'happy.png',
      caption: '好耶！',
      minLevel: 1,
      keywords: ['哈哈', '好耶', '太棒', '成功', '开心', '厉害', '牛']
    },
    {
      id: 'thanks',
      file: 'thanks.png',
      caption: '谢谢！',
      minLevel: 1,
      keywords: ['谢谢', '感谢', '多谢', 'thx', 'thanks']
    },
    {
      id: 'love',
      file: 'love.png',
      caption: '抱抱～',
      minLevel: 2,
      keywords: ['喜欢', '爱你', '抱抱', '想你', '可爱', '么么']
    },
    {
      id: 'sleepy',
      file: 'sleepy.png',
      caption: '困了…',
      minLevel: 2,
      keywords: ['晚安', '困', '睡觉', '好累', '休息']
    },
    {
      id: 'sorry',
      file: 'sorry.png',
      caption: '对不起…',
      minLevel: 3,
      keywords: ['对不起', '抱歉', 'sorry', '错了']
    },
    {
      id: 'question',
      file: 'question.png',
      caption: '诶？',
      minLevel: 3,
      keywords: ['？', '?', '为什么', '怎么', '啥']
    },
    {
      id: 'wow',
      file: 'wow.png',
      caption: '真的假的',
      minLevel: 4,
      keywords: ['真的吗', '真的', '居然', '竟然', '哇']
    },
    {
      id: 'cheer',
      file: 'cheer.png',
      caption: '冲鸭！',
      minLevel: 5,
      keywords: ['加油', '冲', '努力', '干']
    }
  ];

  function findSticker(id) {
    return STICKERS.find((sticker) => sticker.id === id) || null;
  }

  function availableStickers(level) {
    const safe = Number(level) || 1;
    return STICKERS.filter((sticker) => safe >= sticker.minLevel);
  }

  function randomSticker(level, random) {
    const pool = availableStickers(level);
    if (pool.length === 0) return null;
    const rng = typeof random === 'function' ? random : Math.random;
    return pool[Math.floor(rng() * pool.length) % pool.length];
  }

  function matchSticker(text, level) {
    const source = String(text || '').toLowerCase();
    if (!source) return null;
    const pool = availableStickers(level);
    const hits = pool.filter((sticker) =>
      sticker.keywords.some((keyword) => source.includes(keyword.toLowerCase()))
    );
    if (hits.length === 0) return null;
    return hits[0];
  }

  /**
   * 根据聊天内容和亲密度决定要不要发一张表情包。
   * @returns {object|null}
   */
  function maybeSticker(text, level, random) {
    const rng = typeof random === 'function' ? random : Math.random;
    const matched = matchSticker(text, level);
    if (matched && rng() < 0.72) return matched;

    // 等级越高，越容易主动发
    const chance = Math.min(0.34, 0.06 + (Number(level) || 1) * 0.045);
    if (rng() < chance) return randomSticker(level, rng);
    return null;
  }

  return {
    STICKERS,
    findSticker,
    availableStickers,
    randomSticker,
    matchSticker,
    maybeSticker
  };
});
