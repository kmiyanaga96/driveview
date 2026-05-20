/**
 * DriveView - Web Application Entry Point
 *
 * GAS Web Apps の doGet() および
 * フロントエンドから google.script.run で呼び出される
 * 公開API関数群を定義する。
 */

/**
 * Web App エントリーポイント。SPA の HTML を返す。
 * @param {Object} e リクエストパラメーター
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('DriveView')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * HTML テンプレート内で部分ファイルをインクルードする。
 * 使用例: <?!= include('Stylesheet') ?>
 * @param {string} filename 拡張子なしのファイル名
 * @returns {string} ファイルの HTML コンテンツ
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================================
// フロントエンド公開 API
// google.script.run.XXX() で呼び出される関数群
// ============================================================

/**
 * 全コンテンツを取得する (ギャラリー初期ロード用)。
 * @returns {Array<Object>}
 */
function getAllContent() {
  return dbGetAllContent();
}

// getMangaPages()  → MangaService.js で定義済み
// getChapters()    → ChapterService.js で定義済み
// addChapter()     → ChapterService.js で定義済み
// deleteChapter()  → ChapterService.js で定義済み

/**
 * コンテンツのタグを更新する。
 * @param {string} targetId
 * @param {string} tags カンマ区切りタグ文字列
 * @returns {boolean}
 */
function updateTags(targetId, tags) {
  return dbUpdateTags(targetId, tags);
}

/**
 * 全ユニークタグを取得する（サジェスト用）。
 * @returns {Array<string>}
 */
function getAllTags() {
  return dbGetAllTags();
}

// getSuggestedThumbnails は廃止 — フロントエンドの appState から直接取得

/**
 * サムネイルURLを更新する。
 * @param {string} targetId
 * @param {string} thumbnailUrl
 * @returns {boolean}
 */
function updateThumbnail(targetId, thumbnailUrl) {
  return dbUpdateThumbnail(targetId, thumbnailUrl);
}

/**
 * 動画のアクセス情報を取得する（フレームキャプチャ用）。
 * フロントエンドが直接 Drive API から動画を取得するためのトークンを返す。
 * @param {string} fileId 動画ファイルID
 * @returns {Object} { token, fileId, fileSize }
 */
function getVideoAccessInfo(fileId) {
  var token = ScriptApp.getOAuthToken();
  var fileSize = 0;

  try {
    var file = Drive.Files.get(fileId, {
      fields: 'size',
      supportsAllDrives: true
    });
    fileSize = parseInt(file.size || '0');
  } catch (e) {
    Logger.log('getVideoAccessInfo error: ' + e.message);
  }

  return {
    token: token,
    fileId: fileId,
    fileSize: fileSize
  };
}

/**
 * サムネイル用画像をGoogle Driveに保存し、そのURLをスプレッドシートに保存する。
 * @param {string} targetId 動画/漫画のID
 * @param {string} base64Data 画像のBase64データURL (data:image/jpeg;base64,...)
 * @returns {string} 保存されたサムネイルのリサイズ済みURL
 */
function uploadThumbnailToDrive(targetId, base64Data) {
  try {
    var config = getConfig();
    var props = PropertiesService.getScriptProperties();
    var folderId = props.getProperty('THUMBNAIL_FOLDER_ID');
    var folder;

    if (folderId) {
      try {
        folder = DriveApp.getFolderById(folderId);
      } catch (e) {
        Logger.log('Configured thumbnail folder not found: ' + e.message);
      }
    }

    // フォルダがない場合は新規作成
    if (!folder) {
      folder = DriveApp.createFolder('DriveView_Thumbnails');
      // 誰でも閲覧可能（リンク共有）に設定
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      props.setProperty('THUMBNAIL_FOLDER_ID', folder.getId());
      Logger.log('Created new thumbnail folder: ' + folder.getId());
    }

    // Base64データをデコード
    var matches = base64Data.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 image format');
    }
    var contentType = matches[1];
    var rawData = matches[2];
    var decoded = Utilities.base64Decode(rawData);
    var extension = contentType.split('/')[1] || 'jpg';
    var fileName = 'thumb_' + targetId + '.' + extension;

    var blob = Utilities.newBlob(decoded, contentType, fileName);

    // 既存の同名サムネイルがあれば削除（重複防止）
    var files = folder.getFilesByName(fileName);
    while (files.hasNext()) {
      var file = files.next();
      file.setTrashed(true);
    }

    // 新規作成
    var newFile = folder.createFile(blob);
    newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    var fileId = newFile.getId();
    var finalUrl = '';
    
    // Drive API を使って thumbnailLink を取得（リサイズに必要）
    try {
      var driveFile = Drive.Files.get(fileId, {
        supportsAllDrives: true
      });
      if (driveFile.thumbnailLink) {
        // resizeThumbnail_ を用いて grid 用サイズに置換
        finalUrl = resizeThumbnail_(driveFile.thumbnailLink, config.THUMB_SIZE_GRID);
      }
    } catch (e) {
      Logger.log('Failed to get thumbnailLink via Advanced Drive API: ' + e.message);
    }
    
    if (!finalUrl) {
      // フォールバック
      finalUrl = 'https://docs.google.com/uc?export=view&id=' + fileId;
    }

    // スプレッドシートDBを更新
    dbUpdateThumbnail(targetId, finalUrl);

    return finalUrl;
  } catch (e) {
    Logger.log('uploadThumbnailToDrive error: ' + e.message);
    throw e;
  }
}

