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
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
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


