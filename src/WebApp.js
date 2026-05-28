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

// getAllTags は廃止 — フロントエンドの appState から直接抽出
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
 * fileSize はクライアント側で Content-Length ヘッダから取得するため
 * Drive API 呼び出しは省略する。
 * @param {string} fileId 動画ファイルID
 * @returns {Object} { token, fileId }
 */
function getVideoAccessInfo(fileId) {
  return {
    token: ScriptApp.getOAuthToken(),
    fileId: fileId
  };
}

/**
 * 漫画リーダー起動時に必要なデータを一括取得する。
 * pages と chapters の取得を1往復にまとめる。
 * @param {string} folderId
 * @returns {Object} { pages, chapters }
 */
function getMangaReaderData(folderId) {
  return {
    pages: getMangaPages(folderId),
    chapters: getChapters(folderId)
  };
}


