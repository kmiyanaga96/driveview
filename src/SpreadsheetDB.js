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
// ヘルパー
// ============================================================

/**
 * スプレッドシートを取得する。
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet_() {
  var config = getConfig();
  if (!config.SPREADSHEET_ID) {
    throw new Error('Spreadsheet not configured. Run setupDatabase() first.');
  }
  return SpreadsheetApp.openById(config.SPREADSHEET_ID);
}

/**
 * Mainシートを取得する。
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getMainSheet_() {
  return getSpreadsheet_().getSheetByName(getConfig().MAIN_SHEET);
}

/**
 * Chaptersシートを取得する。
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getChaptersSheet_() {
  return getSpreadsheet_().getSheetByName(getConfig().CHAPTERS_SHEET);
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
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var rows = data.slice(1); // ヘッダー除去
  return rows.map(function (row) {
    return {
      targetId: row[0],
      type: row[1],
      title: row[2],
      tags: row[3] ? String(row[3]) : '',
      thumbnailUrl: row[4],
      webViewUrl: row[5] || ''
    };
  });
}

/**
 * コンテンツをUPSERT（既存なら更新、なければ追加）。
 * @param {Object} item - {targetId, type, title, tags, thumbnailUrl, webViewUrl}
 */
function dbUpsertContent(item) {
  var sheet = getMainSheet_();
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === item.targetId) {
      // 更新
      var row = i + 1;
      sheet.getRange(row, 1, 1, 6).setValues([[
        item.targetId, item.type, item.title,
        item.tags, item.thumbnailUrl, item.webViewUrl
      ]]);
      return;
    }
  }

  // 新規追加
  sheet.appendRow([
    item.targetId, item.type, item.title,
    item.tags, item.thumbnailUrl, item.webViewUrl
  ]);
}

/**
 * 複数コンテンツを一括UPSERT（バッチ最適化）。
 * @param {Array<Object>} items
 */
function dbBatchUpsertContent(items) {
  if (!items || items.length === 0) return;

  var sheet = getMainSheet_();
  var lastRow = sheet.getLastRow();
  
  // Retrieve existing sheet data or fall back to header if empty
  var data = lastRow > 0 ? sheet.getRange(1, 1, lastRow, 6).getValues() : [['Target_ID', 'Type', 'Title', 'Tags', 'Thumbnail_URL', 'WebView_URL']];

  // Map to track row indices by Target_ID
  var idxMap = {};
  for (var i = 1; i < data.length; i++) {
    idxMap[data[i][0]] = i;
  }

  var isChanged = false;

  items.forEach(function (item) {
    var rowValues = [
      item.targetId,
      item.type,
      item.title,
      item.tags,
      item.thumbnailUrl,
      item.webViewUrl
    ];

    var idx = idxMap[item.targetId];
    if (idx !== undefined) {
      var current = data[idx];

      // Preserve user-set thumbnail (Base64 data URL or custom URL)
      // during sync when incoming URL is a Drive API thumbnailLink
      var existingThumb = current[4] ? String(current[4]) : '';
      var incomingThumb = item.thumbnailUrl || '';
      var isExistingCustom = existingThumb.indexOf('data:') === 0;
      var isIncomingDriveApi = incomingThumb.indexOf('lh3.googleusercontent.com') !== -1 ||
                               incomingThumb === '';
      if (isExistingCustom && isIncomingDriveApi) {
        rowValues[4] = existingThumb; // Keep user-set thumbnail
      }

      // Memory compare to check for differences
      var diff = false;
      for (var col = 0; col < 6; col++) {
        if (current[col] !== rowValues[col]) {
          diff = true;
          break;
        }
      }
      if (diff) {
        data[idx] = rowValues;
        isChanged = true;
      }
    } else {
      // Append in memory
      data.push(rowValues);
      isChanged = true;
    }
  });

  // Perform a single batch write if there are changes
  if (isChanged) {
    sheet.getRange(1, 1, data.length, 6).setValues(data);
    Logger.log('dbBatchUpsertContent: Updated spreadsheet database (Total: ' + data.length + ' rows)');
  }
}

/**
 * コンテンツのタグを更新する。
 * @param {string} targetId 対象コンテンツのID
 * @param {string} tags カンマ区切りのタグ文字列
 * @returns {boolean} 更新成功したか
 */
function dbUpdateTags(targetId, tags) {
  var sheet = getMainSheet_();
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === targetId) {
      sheet.getRange(i + 1, 4).setValue(tags); // 4列目 = Tags
      return true;
    }
  }
  return false;
}

/**
 * 全コンテンツから一意なタグ一覧を取得する（サジェスト用）。
 * @returns {Array<string>} ユニークなタグの配列（出現回数降順）
 */
function dbGetAllTags() {
  var sheet = getMainSheet_();
  var data = sheet.getDataRange().getValues();
  var tagCount = {};

  for (var i = 1; i < data.length; i++) {
    var tagsStr = data[i][3] ? String(data[i][3]) : '';
    if (tagsStr) {
      tagsStr.split(',').forEach(function (t) {
        var tag = t.trim();
        if (tag) tagCount[tag] = (tagCount[tag] || 0) + 1;
      });
    }
  }

  return Object.keys(tagCount).sort(function (a, b) {
    return tagCount[b] - tagCount[a];
  });
}

/**
 * コンテンツのサムネイルURLを更新する。
 * @param {string} targetId 対象コンテンツのID
 * @param {string} thumbnailUrl 新しいサムネイルURL
 * @returns {boolean} 更新成功したか
 */
function dbUpdateThumbnail(targetId, thumbnailUrl) {
  var sheet = getMainSheet_();
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === targetId) {
      sheet.getRange(i + 1, 5).setValue(thumbnailUrl); // 5列目 = Thumbnail_URL
      return true;
    }
  }
  return false;
}

