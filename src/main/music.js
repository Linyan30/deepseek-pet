'use strict';

const { requestJSON } = require('./http');

const SOURCE_LABELS = {
  deezer: 'Deezer',
  itunes: 'iTunes'
};

function trimText(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || 120);
}

function normalizeTrack(track, source) {
  if (!track) return null;
  const preview = String(track.preview || '').trim();
  if (!/^https?:\/\//i.test(preview)) return null;

  const duration = Number(track.duration);
  return {
    id: String(track.id || `${source}-${trimText(track.title, 40)}`),
    title: trimText(track.title, 80) || '未知歌曲',
    artist: trimText(track.artist, 60) || '未知歌手',
    album: trimText(track.album, 60),
    cover: /^https?:\/\//i.test(String(track.cover || '')) ? String(track.cover) : '',
    preview,
    duration: Number.isFinite(duration) && duration > 0 ? Math.min(600, Math.round(duration)) : 30,
    source
  };
}

function dedupe(tracks) {
  const seen = new Set();
  const output = [];
  tracks.forEach((track) => {
    if (!track) return;
    const key = `${track.title}::${track.artist}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(track);
  });
  return output;
}

async function searchDeezer(query, limit, request) {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const response = await request(url, { method: 'GET' });
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);

  const data = response.body && Array.isArray(response.body.data) ? response.body.data : [];
  return data
    .map((item) =>
      normalizeTrack(
        {
          id: `deezer-${item.id}`,
          title: item.title || item.title_short,
          artist: item.artist && item.artist.name,
          album: item.album && item.album.title,
          cover: item.album && (item.album.cover_medium || item.album.cover),
          preview: item.preview,
          duration: item.duration
        },
        'deezer'
      )
    )
    .filter(Boolean);
}

async function searchItunes(query, limit, request) {
  const url =
    'https://itunes.apple.com/search?term=' +
    encodeURIComponent(query) +
    `&media=music&entity=song&limit=${limit}&country=CN`;
  const response = await request(url, { method: 'GET' });
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);

  const list = response.body && Array.isArray(response.body.results) ? response.body.results : [];
  return list
    .map((item) =>
      normalizeTrack(
        {
          id: `itunes-${item.trackId}`,
          title: item.trackName,
          artist: item.artistName,
          album: item.collectionName,
          cover: String(item.artworkUrl100 || '').replace('100x100', '300x300'),
          preview: item.previewUrl,
          duration: Math.round((Number(item.trackTimeMillis) || 0) / 1000)
        },
        'itunes'
      )
    )
    .filter(Boolean);
}

/**
 * 搜索歌曲并拿到 30 秒试听地址（Deezer 优先，失败回落到 iTunes）。
 * request 可注入，方便测试。
 */
async function searchMusic(options) {
  const opts = options || {};
  const query = String(opts.query || '').trim();
  const limit = Math.max(1, Math.min(10, Number(opts.limit) || 8));
  const request = opts.request || requestJSON;

  if (!query) {
    return { ok: false, query, source: 'none', results: [], error: '想听什么歌？告诉我歌名或歌手。' };
  }

  const errors = [];

  try {
    const deezer = await searchDeezer(query, limit, request);
    if (deezer.length > 0) {
      return { ok: true, query, source: 'deezer', results: dedupe(deezer).slice(0, limit), error: '' };
    }
  } catch (error) {
    errors.push(`Deezer：${(error && error.message) || '失败'}`);
  }

  try {
    const itunes = await searchItunes(query, limit, request);
    if (itunes.length > 0) {
      return { ok: true, query, source: 'itunes', results: dedupe(itunes).slice(0, limit), error: '' };
    }
  } catch (error) {
    errors.push(`iTunes：${(error && error.message) || '失败'}`);
  }

  return {
    ok: false,
    query,
    source: 'none',
    results: [],
    error: errors.length
      ? `没有搜到可以试听的歌曲（${errors.join('；')}）。`
      : '没有搜到可以试听的歌曲，换个歌名试试？'
  };
}

module.exports = {
  SOURCE_LABELS,
  normalizeTrack,
  dedupe,
  searchDeezer,
  searchItunes,
  searchMusic
};
