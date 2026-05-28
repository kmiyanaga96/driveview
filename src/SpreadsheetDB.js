/**
 * DriveView - Spreadsheet Database Layer
 *
 * Main/Chapters シートの CRUD 操作を提供する。
 */

// ============================================================
// セットアップ
// ============================================================

/**
 * データベース（スプレッドシート）を初期作成する。
 * 初回のみ手動実行すること。
 */
function setupDatabase() {
  var props = PropertiesService.getScriptProperties();
  var existingId = props.getProperty('SPREADSHEET_ID');

  if (existingId) {
    try {
      SpreadsheetApp.openById(existingId);
      Logger.log('Database already exists: ' + existingId);
      return existingId;
    } catch (e) {
      Logger.log('Existing spreadsheet not found, creating new one.');
    }
  }

  var ss = SpreadsheetApp.create('DriveView_DB');
  var ssId = ss.getId();

  // Main シート
  var mainSheet = ss.getSheets()[0];
  mainSheet.setName('Main');
  mainSheet.appendRow(['Target_ID', 'Type', 'Title', 'Tags', 'Thumbnail_URL', 'WebView_URL']);
  mainSheet.setFrozenRows(1);
  mainSheet.getRange('1:1').setFontWeight('bold');

  // Chapters シート
  var chaptersSheet = ss.insertSheet('Chapters');
  chaptersSheet.appendRow(['Chapter_ID', 'Target_ID', 'Position', 'Label']);
  chaptersSheet.setFrozenRows(1);
  chaptersSheet.getRange('1:1').setFontWeight('bold');

  props.setProperty('SPREADSHEET_ID', ssId);
  Logger.log('Database created: ' + ssId);
  return ssId;
}

// ============================================================
// ヘルパー (リクエストスコープのメモ化)
// ============================================================

var _ssCache = null;
var _mainSheetCache = null;
var _chaptersSheetCache = null;

/**
 * スプレッドシートを取得する。
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet_() {
  if (_ssCache) return _ssCache;
  var config = getConfig();
  if (!config.SPREADSHEET_ID) {
    throw new Error('Spreadsheet not configured. Run setupDatabase() first.');
  }
  _ssCache = SpreadsheetApp.openById(config.SPREADSHEET_ID);
  return _ssCache;
}

/**
 * Mainシートを取得する。
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getMainSheet_() {
  if (_mainSheetCache) return _mainSheetCache;
  _mainSheetCache = getSpreadsheet_().getSheetByName(getConfig().MAIN_SHEET);
  return _mainSheetCache;
}

/**
 * Chaptersシートを取得する。
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getChaptersSheet_() {
  if (_chaptersSheetCache) return _chaptersSheetCache;
  _chaptersSheetCache = getSpreadsheet_().getSheetByName(getConfig().CHAPTERS_SHEET);
  return _chaptersSheetCache;
}

/**
 * Target_ID を行番号にマップしたインデックスを返す。
 * 1列のみ読み出すことで全列読み出しのコストを避ける。
 * @returns {Object<string, number>} {targetId: sheetRow}
 */
function buildMainIndex_() {
  var sheet = getMainSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var map = {};
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i][0];
    if (id) map[id] = i + 2;
  }
  return map;
}

// ============================================================
// Main シート操作
// ============================================================

/**
 * 全コンテンツを取得（フロントエンド初期ロード用）。
 * @returns {Array<Object>} コンテンツ配列
 */
function dbGetAllContent() {
  var sheet = getMainSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var rows = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row[0]) continue;
    result.push({
      targetId: row[0],
      type: row[1],
      title: row[2],
      tags: row[3] ? String(row[3]) : '',
      thumbnailUrl: row[4],
      webViewUrl: row[5] || ''
    });
  }
  return result;
}

/**
 * 複数コンテンツを一括UPSERT（バッチ最適化）。
 * 既存行は個別に更新、新規行は末尾に一括追加する。
 * @param {Array<Object>} items
 */
function dbBatchUpsertContent(items) {
  if (!items || items.length === 0) return;

  var sheet = getMainSheet_();
  var idxMap = buildMainIndex_();
  var lastRow = sheet.getLastRow();

  var newRows = [];
  var updatedCount = 0;

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var values = [
      item.targetId,
      item.type,
      item.title,
      item.tags,
      item.thumbnailUrl,
      item.webViewUrl
    ];
    var row = idxMap[item.targetId];
    if (row) {
      sheet.getRange(row, 1, 1, 6).setValues([values]);
      updatedCount++;
    } else {
      newRows.push(values);
    }
  }

  if (newRows.length > 0) {
    sheet.getRange(lastRow + 1, 1, newRows.length, 6).setValues(newRows);
  }

  Logger.log(
    'dbBatchUpsertContent: updated=' + updatedCount +
    ', appended=' + newRows.length
  );
}

/**
 * コンテンツのタグを更新する。
 * @param {string} targetId 対象コンテンツのID
 * @param {string} tags カンマ区切りのタグ文字列
 * @returns {boolean} 更新成功したか
 */
function dbUpdateTags(targetId, tags) {
  var row = findRowByTargetId_(getMainSheet_(), targetId);
  if (!row) return false;
  getMainSheet_().getRange(row, 4).setValue(tags); // 4列目 = Tags
  return true;
}

/**
 * コンテンツのサムネイルURLを更新する。
 * @param {string} targetId 対象コンテンツのID
 * @param {string} thumbnailUrl 新しいサムネイルURL
 * @returns {boolean} 更新成功したか
 */
function dbUpdateThumbnail(targetId, thumbnailUrl) {
  var row = findRowByTargetId_(getMainSheet_(), targetId);
  if (!row) return false;
  getMainSheet_().getRange(row, 5).setValue(thumbnailUrl); // 5列目 = Thumbnail_URL
  return true;
}

/**
 * Target_ID 列から該当行番号を見つける。
 * TextFinder により Apps Script 側でのインデックススキャンに任せる。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} targetId
 * @returns {number|null} 行番号（1-indexed）
 */
function findRowByTargetId_(sheet, targetId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var match = sheet.getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(String(targetId))
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : null;
}

/**
 * 全コンテンツから一意なタグ一覧を取得する（サジェスト用）。
 * 現在フロントエンドは appState から算出するためほぼ未使用だが、
 * 互換のため残す。
 * @returns {Array<string>} ユニークなタグの配列（出現回数降順）
 */
function dbGetAllTags() {
  var sheet = getMainSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var tagsCol = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
  var tagCount = {};

  for (var i = 0; i < tagsCol.length; i++) {
    var tagsStr = tagsCol[i][0] ? String(tagsCol[i][0]) : '';
    if (!tagsStr) continue;
    var parts = tagsStr.split(',');
    for (var j = 0; j < parts.length; j++) {
      var tag = parts[j].trim();
      if (tag) tagCount[tag] = (tagCount[tag] || 0) + 1;
    }
  }

  return Object.keys(tagCount).sort(function (a, b) {
    return tagCount[b] - tagCount[a];
  });
}
