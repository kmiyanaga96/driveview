/**
 * DriveView - Drive Sync (差分同期バッチ)
 *
 * Google Driveの動画ファイル/漫画フォルダを
 * スプレッドシートへ差分同期する。
 * 要件4.1: modifiedTime ベースのインクリメンタルアップデート
 */

/**
 * 差分同期を実行するメイン関数。
 * 時間トリガーから呼び出される。
 */
function syncDriveContent() {
  var config = getConfig();
  var props = PropertiesService.getScriptProperties();
  var startTime = Date.now();

  // 前回同期日時を取得
  var lastSync = props.getProperty(config.LAST_SYNC_KEY) || '';
  var now = new Date().toISOString();

  Logger.log('Sync started. Last sync: ' + (lastSync || 'NEVER (initial sync)'));

  var allItems = [];

  // 動画フォルダを走査
  config.VIDEO_FOLDER_IDS.forEach(function (folderId) {
    if (folderId === 'YOUR_VIDEO_FOLDER_ID_HERE') return;
    var items = syncVideoFolder_(folderId, lastSync, startTime, config);
    allItems = allItems.concat(items);
  });

  // 漫画フォルダを走査
  config.MANGA_FOLDER_IDS.forEach(function (folderId) {
    if (folderId === 'YOUR_MANGA_FOLDER_ID_HERE') return;
    var items = syncMangaFolder_(folderId, lastSync, startTime, config);
    allItems = allItems.concat(items);
  });

  // 一括UPSERT
  if (allItems.length > 0) {
    dbBatchUpsertContent(allItems);
    Logger.log('Synced ' + allItems.length + ' items.');
  } else {
    Logger.log('No changes detected.');
  }

  // 同期日時を更新
  props.setProperty(config.LAST_SYNC_KEY, now);
  Logger.log('Sync completed in ' + ((Date.now() - startTime) / 1000) + 's');
}

/**
 * 定期実行トリガーをセットアップする。
 */
function setupSyncTrigger() {
  // 既存トリガーを削除
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'syncDriveContent') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 1時間ごとに実行
  ScriptApp.newTrigger('syncDriveContent')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('Sync trigger set: every 1 hour');
}

// ============================================================
// 内部関数
// ============================================================

/**
 * 動画フォルダ内のファイルを同期する。
 * @param {string} folderId ルートフォルダID
 * @param {string} lastSync 前回同期日時 (ISO文字列)
 * @param {number} startTime 実行開始時刻 (ms)
 * @param {Object} config 設定
 * @returns {Array<Object>} 同期対象アイテム
 */
function syncVideoFolder_(folderId, lastSync, startTime, config) {
  var items = [];
  var mimeQuery = config.VIDEO_MIMETYPES
    .map(function (m) { return "mimeType='" + m + "'"; })
    .join(' or ');

  var query = "(" + mimeQuery + ") and '" + folderId + "' in parents and trashed=false";

  if (lastSync) {
    query += " and modifiedTime > '" + lastSync + "'";
  }

  var pageToken = null;
  do {
    if (isTimeExceeded_(startTime, config.MAX_EXEC_MS)) {
      Logger.log('Time limit approaching, stopping video sync.');
      break;
    }

    var response = Drive.Files.list({
      q: query,
      fields: 'nextPageToken,files(id,name,description,thumbnailLink,webViewLink,modifiedTime)',
      pageSize: 100,
      pageToken: pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    if (response.files) {
      response.files.forEach(function (file) {
        items.push({
          targetId: file.id,
          type: 'Video',
          title: file.name || '',
          tags: file.description || '',
          thumbnailUrl: resizeThumbnail_(file.thumbnailLink, config.THUMB_SIZE_GRID),
          webViewUrl: file.webViewLink || ''
        });
      });
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  return items;
}

/**
 * 漫画フォルダ内のサブフォルダ（各漫画）を同期する。
 * 各サブフォルダ = 1つの漫画作品。
 * @param {string} folderId ルートフォルダID
 * @param {string} lastSync 前回同期日時 (ISO文字列)
 * @param {number} startTime 実行開始時刻 (ms)
 * @param {Object} config 設定
 * @returns {Array<Object>} 同期対象アイテム
 */
function syncMangaFolder_(folderId, lastSync, startTime, config) {
  var items = [];
  var query = "mimeType='application/vnd.google-apps.folder' and '" + folderId + "' in parents and trashed=false";

  if (lastSync) {
    query += " and modifiedTime > '" + lastSync + "'";
  }

  var pageToken = null;
  do {
    if (isTimeExceeded_(startTime, config.MAX_EXEC_MS)) {
      Logger.log('Time limit approaching, stopping manga sync.');
      break;
    }

    var response = Drive.Files.list({
      q: query,
      fields: 'nextPageToken,files(id,name,description,modifiedTime)',
      pageSize: 100,
      pageToken: pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    if (response.files) {
      response.files.forEach(function (folder) {
        // サムネイルは最初の画像から取得
        var thumb = getMangaFirstThumbnail_(folder.id, config);

        items.push({
          targetId: folder.id,
          type: 'Manga',
          title: folder.name || '',
          tags: folder.description || '',
          thumbnailUrl: thumb,
          webViewUrl: ''
        });
      });
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  return items;
}

/**
 * 漫画フォルダの先頭画像のサムネイルを取得する。
 * @param {string} folderId フォルダID
 * @param {Object} config 設定
 * @returns {string} サムネイルURL
 */
function getMangaFirstThumbnail_(folderId, config) {
  try {
    var mimeQuery = config.IMAGE_MIMETYPES
      .map(function (m) { return "mimeType='" + m + "'"; })
      .join(' or ');

    var response = Drive.Files.list({
      q: "(" + mimeQuery + ") and '" + folderId + "' in parents and trashed=false",
      fields: 'files(thumbnailLink)',
      pageSize: 1,
      orderBy: 'name',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    if (response.files && response.files.length > 0 && response.files[0].thumbnailLink) {
      return resizeThumbnail_(response.files[0].thumbnailLink, config.THUMB_SIZE_GRID);
    }
  } catch (e) {
    Logger.log('Failed to get manga thumbnail for ' + folderId + ': ' + e.message);
  }
  return '';
}

/**
 * サムネイルURLのサイズパラメーターを置換する。
 * 要件4.3: =s220 等を指定サイズに変更。
 * @param {string} url
 * @param {string} size 例: 's400', 's1600'
 * @returns {string}
 */
function resizeThumbnail_(url, size) {
  if (!url) return '';
  return url.replace(/=s\d+$/, '=' + size);
}

/**
 * 実行時間が制限に近づいているか判定する。
 * @param {number} startTime
 * @param {number} maxMs
 * @returns {boolean}
 */
function isTimeExceeded_(startTime, maxMs) {
  return (Date.now() - startTime) > maxMs;
}
