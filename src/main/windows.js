'use strict';

const { screen } = require('electron');

const PET_BASE = Object.freeze({ width: 200, height: 250 });
const CHAT_SIZE = Object.freeze({ width: 380, height: 540 });
const SETTINGS_SIZE = Object.freeze({ width: 420, height: 640 });

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function petSize(scale) {
  const safe = clamp(Number(scale) || 1, 0.7, 1.6);
  return {
    width: Math.round(PET_BASE.width * safe),
    height: Math.round(PET_BASE.height * safe)
  };
}

function workAreaForPoint(x, y) {
  try {
    return screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
  } catch {
    return screen.getPrimaryDisplay().workArea;
  }
}

/** 把窗口完整地限制在屏幕可用区域里。 */
function clampToWorkArea(x, y, width, height) {
  const area = workAreaForPoint(x, y);
  return {
    x: Math.round(clamp(x, area.x, area.x + area.width - width)),
    y: Math.round(clamp(y, area.y, area.y + area.height - height))
  };
}

function defaultPetPosition(width, height) {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - width - 28,
    y: area.y + area.height - height - 48
  };
}

function resolvePetPosition(saved, width, height) {
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    return clampToWorkArea(saved.x, saved.y, width, height);
  }
  return defaultPetPosition(width, height);
}

/** 聊天窗口贴在宠物旁边，空间不够就换一边。 */
function chatWindowPosition(petBounds) {
  const { width, height } = CHAT_SIZE;
  const area = workAreaForPoint(petBounds.x, petBounds.y);
  const gap = 10;
  const rightSpace = area.x + area.width - (petBounds.x + petBounds.width);
  const leftSpace = petBounds.x - area.x;

  let x;
  if (rightSpace >= width + gap) {
    x = petBounds.x + petBounds.width + gap;
  } else if (leftSpace >= width + gap) {
    x = petBounds.x - width - gap;
  } else {
    x = rightSpace > leftSpace ? area.x + area.width - width - 12 : area.x + 12;
  }

  const y = petBounds.y + petBounds.height - height;
  return clampToWorkArea(x, y, width, height);
}

function centeredPosition(width, height) {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2)
  };
}

module.exports = {
  PET_BASE,
  CHAT_SIZE,
  SETTINGS_SIZE,
  petSize,
  clampToWorkArea,
  defaultPetPosition,
  resolvePetPosition,
  chatWindowPosition,
  centeredPosition
};
