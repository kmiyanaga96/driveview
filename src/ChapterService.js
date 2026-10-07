/**
 * DriveView - Chapter Service
 *
 * 漫画のチャプター（お気に入りページ）管理。
 * Chaptersシートへの CRUD 操作を提供する。
 */

/**
 * 指定漫画のチャプター一覧を取得する。
 * @param {string} targetId 漫画のフォルダID (= Target_ID)
 * @returns {Array<Object>} チャプター配列 (position昇順)
 */
function getChapters(targetId) {
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

  sheet.deleteRow(match.getRow());
  return true;
}
