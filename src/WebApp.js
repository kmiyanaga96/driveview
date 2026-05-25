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
 * Driveフルアクセス権限の承認を行うためのヘルパー関数。
 * GASエディタから手動で1回実行すると、OAuthスコープの再承認ダイアログが表示される。
 * 承認後は、Webアプリからのサムネイルアップロードが正常に動作するようになる。
 */
function authorizeDriveAccess() {
  var root = DriveApp.getRootFolder();
  Logger.log('Drive access authorized successfully. Root folder: ' + root.getName());
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
    var folderExists = false;

    if (folderId) {
      try {
        var folderMeta = Drive.Files.get(folderId, {
          supportsAllDrives: true
        });
        if (folderMeta && !folderMeta.trashed) {
          folderExists = true;
        }
      } catch (e) {
        Logger.log('Configured thumbnail folder not found or inaccessible: ' + e.message);
      }
    }

    // フォルダがない場合は新規作成
    if (!folderExists) {
      var folderMetadata = {
        name: 'DriveView_Thumbnails',
        mimeType: 'application/vnd.google-apps.folder'
      };
      var newFolder = Drive.Files.create(folderMetadata);
      folderId = newFolder.id;
      
      // 誰でも閲覧可能（リンク共有）に設定
      try {
        Drive.Permissions.create({
          role: 'reader',
          type: 'anyone'
        }, folderId);
      } catch (permissionError) {
        Logger.log('Failed to set public permission on folder: ' + permissionError.message);
      }
      
      props.setProperty('THUMBNAIL_FOLDER_ID', folderId);
      Logger.log('Created new thumbnail folder: ' + folderId);
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
    try {
      var q = "name = '" + fileName + "' and '" + folderId + "' in parents and trashed = false";
      var listResponse = Drive.Files.list({
        q: q,
        fields: 'files(id)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      if (listResponse.files && listResponse.files.length > 0) {
        listResponse.files.forEach(function (file) {
          try {
            Drive.Files.delete(file.id);
          } catch (deleteError) {
            Logger.log('Failed to delete existing thumbnail ' + file.id + ': ' + deleteError.message);
          }
        });
      }
    } catch (e) {
      Logger.log('Error checking existing thumbnails: ' + e.message);
    }

    // 新規作成 (GASのバグ回避のため、引数にメディア(blob)を指定するメソッドは第3引数を省略して呼び出す)
    var fileMetadata = {
      name: fileName,
      parents: [folderId]
    };
    var newFile = Drive.Files.create(fileMetadata, blob);
    var fileId = newFile.id;
    
    // 個別に共有設定を追加
    try {
      Drive.Permissions.create({
        role: 'reader',
        type: 'anyone'
      }, fileId);
    } catch (e) {
      Logger.log('Failed to set public permission on file: ' + e.message);
    }
    
    var finalUrl = '';
    
    // thumbnailLink は後からgetで安全に取得する
    try {
      var driveFile = Drive.Files.get(fileId, {
        fields: 'thumbnailLink',
        supportsAllDrives: true
      });
      if (driveFile.thumbnailLink) {
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

