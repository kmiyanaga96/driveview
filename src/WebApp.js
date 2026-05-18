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

/**
 * サムネイル候補を取得する（自動サジェスト）。
 * 対象ファイルの親フォルダ内の画像＋Drive自動生成サムネイルを返す。
 * @param {string} fileId 動画ファイルID (= Target_ID)
 * @returns {Object} { current, driveThumbnail, suggestions[] }
 */
function getSuggestedThumbnails(fileId) {
  var config = getConfig();
  var result = { current: '', driveThumbnail: '', suggestions: [] };

  try {
    // 対象ファイルのメタ情報を取得
    var file = Drive.Files.get(fileId, {
      fields: 'id,name,parents,thumbnailLink',
      supportsAllDrives: true
    });

    // Drive 自動生成サムネイル
    if (file.thumbnailLink) {
      result.driveThumbnail = resizeThumbnail_(file.thumbnailLink, config.THUMB_SIZE_GRID);
    }

    // 現在のDB登録サムネイルを取得
    var allContent = dbGetAllContent();
    var item = allContent.find(function (c) { return c.targetId === fileId; });
    if (item) result.current = item.thumbnailUrl || '';

    // 親フォルダ内の画像をサジェスト
    if (file.parents && file.parents.length > 0) {
      var parentId = file.parents[0];
      var mimeQuery = config.IMAGE_MIMETYPES
        .map(function (m) { return "mimeType='" + m + "'"; })
        .join(' or ');

      var response = Drive.Files.list({
        q: "(" + mimeQuery + ") and '" + parentId + "' in parents and trashed=false",
        fields: 'files(id,name,thumbnailLink)',
        pageSize: 20,
        orderBy: 'name',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });

      if (response.files) {
        response.files.forEach(function (img) {
          if (img.thumbnailLink) {
            result.suggestions.push({
              id: img.id,
              name: img.name,
              url: resizeThumbnail_(img.thumbnailLink, config.THUMB_SIZE_GRID)
            });
          }
        });
      }
    }
  } catch (e) {
    Logger.log('getSuggestedThumbnails error: ' + e.message);
  }

  return result;
}

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
