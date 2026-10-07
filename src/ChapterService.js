/**
 * DriveView - Chapter Service
 *
 * 漫画のチャプター（お気に入りページ）管理。
 * Chaptersシートへの CRUD 操作を提供する。
 */

var CHAPTERS_CACHE_PREFIX = 'chapters:';
var CHAPTERS_CACHE_TTL_SEC = 6 * 60 * 60; // 追加・削除時に破棄するので長めでよい

/**
 * 指定漫画のチャプター一覧を取得する。
 * リーダー起動の度にシートを開かないよう CacheService に保持する。
 * @param {string} targetId 漫画のフォルダID (= Target_ID)
 * @returns {Array<Object>} チャプター配列 (position昇順)
 */
function getChapters(targetId) {
  var cache = CacheService.getScriptCache();
  var key = CHAPTERS_CACHE_PREFIX + targetId;
  var cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* 読み直す */ }
  }

  var chapters = readChaptersFromSheet_(targetId);
  try {
    cache.put(key, JSON.stringify(chapters), CHAPTERS_CACHE_TTL_SEC);
  } catch (e) {
    Logger.log('Chapters cache skipped for ' + targetId + ': ' + e.message);
  }
  return chapters;
}

/**
 * @param {string} targetId
 */
function invalidateChaptersCache_(targetId) {
  CacheService.getScriptCache().remove(CHAPTERS_CACHE_PREFIX + targetId);
}

/**
 * @param {string} targetId
 * @returns {Array<Object>}
 */
function readChaptersFromSheet_(targetId) {
  var sheet = getChaptersSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  var chapters = [];
  for (var i = 0; i < data.length; i++) {
    if (data[i][1] === targetId) {
      chapters.push({
        chapterId: data[i][0],
        targetId: data[i][1],
        position: Number(data[i][2]),
        label: data[i][3]
      });
    }
  }

  chapters.sort(function (a, b) { return a.position - b.position; });
  return chapters;
}

/**
 * チャプターを追加する。
 * @param {string} targetId 漫画のフォルダID
 * @param {number} position ページ番号 (0-indexed)
 * @param {string} label チャプター名
 * @returns {Object} 追加されたチャプター
 */
function addChapter(targetId, position, label) {
  var sheet = getChaptersSheet_();
  var chapterId = 'ch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

  sheet.appendRow([chapterId, targetId, position, label]);
  invalidateChaptersCache_(targetId);

  return {
    chapterId: chapterId,
    targetId: targetId,
    position: position,
    label: label
  };
}

/**
 * チャプターを削除する。
 * TextFinder で対象行を直接特定する。
 * @param {string} chapterId 削除対象のChapter_ID
 * @returns {boolean} 削除成功したか
 */
function deleteChapter(chapterId) {
  var sheet = getChaptersSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var match = sheet.getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(String(chapterId))
    .matchEntireCell(true)
    .findNext();
  if (!match) return false;

  var row = match.getRow();
  var targetId = sheet.getRange(row, 2).getValue();
  sheet.deleteRow(row);
  invalidateChaptersCache_(targetId);
  return true;
}
