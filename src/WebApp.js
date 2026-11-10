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
  var template = HtmlService.createTemplateFromFile('index');
  template.buildInfo = BUILD_INFO; // Build.js (デプロイ時に書き換え)
  return template
    .evaluate()
    .setTitle('DriveView')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
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
 * クライアントが持つキャッシュの版数が最新なら本体を返さず、転送量を抑える。
 * @param {string=} clientVersion クライアントキャッシュの版数
 * @returns {{version: string, notModified: boolean, items: (Array<Object>|undefined)}}
 */
function getAllContent(clientVersion) {
  var version = getContentVersion_();
  if (clientVersion && String(clientVersion) === version) {
    return { version: version, notModified: true };
  }
  return { version: version, notModified: false, items: dbGetAllContent() };
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
 * 表示できなかったサムネイルを失効しない形式で作り直してシートに保存する。
 * 旧形式 (数時間で失効する thumbnailLink) が残った行や、漫画の先頭画像の差し替えに対応する。
 * カスタム (data:) サムネイルは触らない。
 * @param {string} targetId
 * @returns {string} 新しいサムネイルURL（作れなかった場合は空文字）
 */
function repairThumbnail(targetId) {
  var sheet = getMainSheet_();
  var row = findRowByTargetId_(sheet, targetId);
  if (!row) return '';
  var values = sheet.getRange(row, 1, 1, 6).getValues()[0];
  var current = String(values[4] || '');
  if (current.indexOf('data:') === 0) return current;
  var config = getConfig();
  var fresh = values[1] === 'Manga'
    ? getMangaFirstThumbnail_(targetId, config)
    : driveThumbnailUrl_(targetId, config.THUMB_WIDTH_GRID);
  if (fresh && fresh !== current) dbUpdateThumbnail(targetId, fresh);
  return fresh;
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


