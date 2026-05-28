/**
 * DriveView - Configuration
 *
 * ユーザーはここでルートフォルダIDを設定すること。
 * スプレッドシートIDはsetupDatabase()実行時に自動設定される。
 */

var _configCache = null;

/**
 * アプリケーション設定を返す。
 * 同一リクエスト内では PropertiesService への重複アクセスを避けるためメモ化する。
 * @returns {Object} 設定オブジェクト
 */
function getConfig() {
  if (_configCache) return _configCache;
  var props = PropertiesService.getScriptProperties();
  _configCache = {
    // ===== ユーザー設定必須 =====
    // Google Drive上のルートフォルダID (複数指定可)
    VIDEO_FOLDER_IDS: ['1rkp6zzJ9OzqUdv7j_URM5hmHRYP1MB7u'],
    MANGA_FOLDER_IDS: ['1FadY2gT40TKs_gpBiZBq3qZUVYs45_qZ'],

    // ===== 自動設定 (setupDatabase()で設定) =====
    SPREADSHEET_ID: props.getProperty('SPREADSHEET_ID') || '',

    // ===== シート名 =====
    MAIN_SHEET: 'Main',
    CHAPTERS_SHEET: 'Chapters',

    // ===== サムネイル =====
    THUMB_SIZE_GRID: 'w400-rw',
    THUMB_SIZE_READER: 'w1200-rw',

    // ===== 対応拡張子 =====
    VIDEO_MIMETYPES: [
      'video/mp4', 'video/x-matroska', 'video/avi',
      'video/quicktime', 'video/webm'
    ],
    IMAGE_MIMETYPES: [
      'image/jpeg', 'image/png', 'image/gif',
      'image/webp', 'image/bmp'
    ],

    // ===== 同期 =====
    LAST_SYNC_KEY: 'LAST_SYNC_TIME',
    MAX_EXEC_MS: 5 * 60 * 1000, // 5分 (1分バッファ)

    // ===== Lazy Loading =====
    MANGA_PAGE_BATCH: 10
  };
  return _configCache;
}
