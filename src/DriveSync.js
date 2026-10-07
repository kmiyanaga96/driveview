/**
 * DriveView - Drive Sync Batch
 *
 * Google Drive を走査し、Main シートへ差分同期する。
 * 同期位置はルートフォルダ単位で保持し、6分制限で中断しても
 * 次回は処理済みの位置から再開する。
 */

/**
 * Drive → スプレッドシートの差分同期（時間主導トリガーから実行）。
 */
function syncDriveContent() {
  var config = getConfig();
  var props = PropertiesService.getScriptProperties();
  var startTime = Date.now();
  var now = new Date().toISOString();

  // 旧形式 (全フォルダ共通) の同期日時。ルート別の値が無い場合のみ使う
  var legacyLastSync = props.getProperty(config.LAST_SYNC_KEY) || '';

  var roots = getSyncRoots_(config);
  var allItems = [];
  var cursorUpdates = {};
  var timedOut = false;

  for (var i = 0; i < roots.length; i++) {
    var root = roots[i];
    if (timedOut) break; // 未着手のルートは同期位置を据え置く

    var key = syncCursorKey_(config, root.id);
    var lastSync = props.getProperty(key) || legacyLastSync;
    Logger.log('Sync ' + root.type + ' ' + root.id + ' since ' + (lastSync || 'NEVER'));

    var result = root.type === 'Video'
      ? syncVideoFolder_(root.id, lastSync, startTime, config)
      : syncMangaFolder_(root.id, lastSync, startTime, config);

    allItems = allItems.concat(result.items);
    if (result.complete) {
      cursorUpdates[key] = now;
    } else {
      timedOut = true;
      // modifiedTime 昇順で処理しているので、最後に処理した時刻から再開できる
      if (result.lastModified) cursorUpdates[key] = result.lastModified;
    }
  }

  if (allItems.length > 0) {
    dbBatchUpsertContent(allItems);
    Logger.log('Synced ' + allItems.length + ' items.');
  } else {
    Logger.log('No changes detected.');
  }

  // 書き込み成功後に同期位置を進める
  props.setProperties(cursorUpdates);

  if (timedOut) {
    Logger.log('Time limit reached. Remaining items will be synced on the next run.');
  } else {
    if (legacyLastSync) props.deleteProperty(config.LAST_SYNC_KEY);
    pruneDeletedContent_(roots, startTime, config);
  }

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

/**
 * 全コンテンツを強制的に再同期する。
 * 全ルートの同期位置をリセットしてから同期を実行する。
 * 漫画サムネイルが消えた場合などに手動で実行する。
 * ユーザーが付けたタグ・カスタムサムネイルは保持される。
 */
function forceFullSync() {
  var config = getConfig();
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(config.LAST_SYNC_KEY);
  getSyncRoots_(config).forEach(function (root) {
    props.deleteProperty(syncCursorKey_(config, root.id));
  });
  Logger.log('Sync cursors cleared. Starting full sync...');
  syncDriveContent();
}

// ============================================================
// 内部関数
// ============================================================

/**
 * 同期対象のルートフォルダ一覧を返す（未設定のプレースホルダは除外）。
 * @param {Object} config
 * @returns {Array<{id: string, type: string}>}
 */
function getSyncRoots_(config) {
  var roots = [];
  config.VIDEO_FOLDER_IDS.forEach(function (id) {
    if (id && id !== 'YOUR_VIDEO_FOLDER_ID_HERE') roots.push({ id: id, type: 'Video' });
  });
  config.MANGA_FOLDER_IDS.forEach(function (id) {
    if (id && id !== 'YOUR_MANGA_FOLDER_ID_HERE') roots.push({ id: id, type: 'Manga' });
  });
  return roots;
}

/**
 * ルートフォルダごとの同期位置を保存するプロパティキー。
 * @param {Object} config
 * @param {string} folderId
 * @returns {string}
 */
function syncCursorKey_(config, folderId) {
  return config.LAST_SYNC_KEY + ':' + folderId;
}

/**
 * ルートフォルダ直下の対象を列挙する Drive クエリを組み立てる。
 * @param {string} type 'Video' | 'Manga'
 * @param {string} folderId
 * @param {Object} config
 * @returns {string}
 */
function buildRootQuery_(type, folderId, config) {
  var typeQuery;
  if (type === 'Video') {
    typeQuery = '(' + config.VIDEO_MIMETYPES
      .map(function (m) { return "mimeType='" + m + "'"; })
      .join(' or ') + ')';
  } else {
    typeQuery = "mimeType='application/vnd.google-apps.folder'";
  }
  return typeQuery + " and '" + folderId + "' in parents and trashed=false";
}

/**
 * 変更されたアイテムを modifiedTime 昇順でページングしながら取得する。
 * 境界の取りこぼしを防ぐため modifiedTime >= lastSync で問い合わせる（UPSERT なので重複は無害）。
 * @param {string} query
 * @param {string} fields files() 内のフィールド
 * @param {string} lastSync
 * @param {number} startTime
 * @param {Object} config
 * @param {function(Object): Object} toItem Drive ファイル → 同期アイテム
 * @returns {{items: Array<Object>, complete: boolean, lastModified: string}}
 */
function listChangedItems_(query, fields, lastSync, startTime, config, toItem) {
  if (lastSync) query += " and modifiedTime >= '" + lastSync + "'";

  var items = [];
  var lastModified = '';
  var pageToken = null;
  do {
    if (isTimeExceeded_(startTime, config.MAX_EXEC_MS)) {
      return { items: items, complete: false, lastModified: lastModified };
    }

    var response = Drive.Files.list({
      q: query,
      fields: 'nextPageToken,files(' + fields + ',modifiedTime)',
      orderBy: 'modifiedTime',
      pageSize: 100,
      pageToken: pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    var files = response.files || [];
    for (var i = 0; i < files.length; i++) {
      items.push(toItem(files[i]));
      lastModified = files[i].modifiedTime;
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  return { items: items, complete: true, lastModified: lastModified };
}

/**
 * 動画フォルダ内のファイルを同期する。
 * @param {string} folderId ルートフォルダID
 * @param {string} lastSync 前回同期日時 (ISO文字列)
 * @param {number} startTime 実行開始時刻 (ms)
 * @param {Object} config 設定
 * @returns {{items: Array<Object>, complete: boolean, lastModified: string}}
 */
function syncVideoFolder_(folderId, lastSync, startTime, config) {
  return listChangedItems_(
    buildRootQuery_('Video', folderId, config),
    'id,name,description,webViewLink',
    lastSync, startTime, config,
    function (file) {
      return {
        targetId: file.id,
        type: 'Video',
        title: file.name || '',
        tags: file.description || '',
        thumbnailUrl: driveThumbnailUrl_(file.id, config.THUMB_WIDTH_GRID),
        webViewUrl: file.webViewLink || ''
      };
    }
  );
}

/**
 * 漫画フォルダ内のサブフォルダ（各漫画）を同期する。
 * 各サブフォルダ = 1つの漫画作品。
 * @param {string} folderId ルートフォルダID
 * @param {string} lastSync 前回同期日時 (ISO文字列)
 * @param {number} startTime 実行開始時刻 (ms)
 * @param {Object} config 設定
 * @returns {{items: Array<Object>, complete: boolean, lastModified: string}}
 */
function syncMangaFolder_(folderId, lastSync, startTime, config) {
  return listChangedItems_(
    buildRootQuery_('Manga', folderId, config),
    'id,name,description',
    lastSync, startTime, config,
    function (folder) {
      invalidateMangaPagesCache_(folder.id);
      return {
        targetId: folder.id,
        type: 'Manga',
        title: folder.name || '',
        tags: folder.description || '',
        // サムネイルは最初の画像から取得
        thumbnailUrl: getMangaFirstThumbnail_(folder.id, config),
        webViewUrl: ''
      };
    }
  );
}

/**
 * Drive から削除・移動されたコンテンツを Main シートから取り除く。
 * 差分同期では削除を検知できないため、ID のみの軽量な全件列挙で突き合わせる。
 * 列挙が途中で終わった場合や 0 件だった種別は、誤削除を避けるため何もしない。
 * @param {Array<{id: string, type: string}>} roots
 * @param {number} startTime
 * @param {Object} config
 */
function pruneDeletedContent_(roots, startTime, config) {
  var aliveIds = {};
  var aliveCount = { Video: 0, Manga: 0 };

  for (var i = 0; i < roots.length; i++) {
    var root = roots[i];
    var pageToken = null;
    do {
      if (isTimeExceeded_(startTime, config.MAX_EXEC_MS)) {
        Logger.log('Prune skipped: time limit reached.');
        return;
      }
      var response = Drive.Files.list({
        q: buildRootQuery_(root.type, root.id, config),
        fields: 'nextPageToken,files(id)',
        pageSize: 1000,
        pageToken: pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      var files = response.files || [];
      for (var j = 0; j < files.length; j++) {
        aliveIds[files[j].id] = true;
        aliveCount[root.type]++;
      }
      pageToken = response.nextPageToken;
    } while (pageToken);
  }

  var types = [];
  if (aliveCount.Video > 0) types.push('Video');
  if (aliveCount.Manga > 0) types.push('Manga');
  if (types.length === 0) return;

  var removed = dbDeleteContentNotIn_(aliveIds, types);
  if (removed > 0) Logger.log('Pruned ' + removed + ' deleted items.');
}

/**
 * 漫画フォルダの先頭画像のサムネイルURLを取得する。
 * @param {string} folderId フォルダID
 * @param {Object} config 設定
 * @returns {string} サムネイルURL（画像が無い場合は空文字）
 */
function getMangaFirstThumbnail_(folderId, config) {
  try {
    var mimeQuery = config.IMAGE_MIMETYPES
      .map(function (m) { return "mimeType='" + m + "'"; })
      .join(' or ');

    var response = Drive.Files.list({
      q: "(" + mimeQuery + ") and '" + folderId + "' in parents and trashed=false",
      fields: 'files(id)',
      pageSize: 1,
      orderBy: 'name',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    if (response.files && response.files.length > 0) {
      return driveThumbnailUrl_(response.files[0].id, config.THUMB_WIDTH_GRID);
    }
  } catch (e) {
    Logger.log('Failed to get manga thumbnail for ' + folderId + ': ' + e.message);
  }
  return '';
}

/**
 * ファイルIDから失効しないサムネイルURLを組み立てる。
 * Drive API の thumbnailLink は数時間で失効する短命URLのため、シートには保存しない。
 * @param {string} fileId
 * @param {number} width 幅(px)
 * @returns {string}
 */
function driveThumbnailUrl_(fileId, width) {
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w' + width;
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
