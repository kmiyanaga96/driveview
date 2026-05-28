/**
 * DriveView - Manga Service
 *
 * 要件4.2: 漫画の画像URLはMainシートに記録せず、
 * ユーザー操作時にフォルダIDから動的取得する。
 * 要件4.3: サムネイルURLのサイズ変更ハック適用。
 */

/**
 * 漫画フォルダ内の全画像ページを名前順で取得する。
 * フロントエンドの google.script.run から呼び出される。
 * @param {string} folderId 漫画フォルダのID (= Target_ID)
 * @returns {Array<Object>} ページ情報の配列
 */
function getMangaPages(folderId) {
  var config = getConfig();
  var pages = [];

  var mimeQuery = config.IMAGE_MIMETYPES
    .map(function (m) { return "mimeType='" + m + "'"; })
    .join(' or ');

  var query = "(" + mimeQuery + ") and '" + folderId + "' in parents and trashed=false";
  var pageToken = null;

  do {
    var response = Drive.Files.list({
      q: query,
      fields: 'nextPageToken,files(id,name,thumbnailLink)',
      pageSize: 200,
      orderBy: 'name',
      pageToken: pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    if (response.files) {
      response.files.forEach(function (file) {
        pages.push({
          id: file.id,
          name: file.name,
          // 要件4.3: リーダー用に高解像度サイズを適用
          url: resizeThumbnail_(file.thumbnailLink, config.THUMB_SIZE_READER)
        });
      });
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  // 名前順（ページ順）でソート
  pages.sort(function (a, b) {
    return naturalSort_(a.name, b.name);
  });

  return pages;
}

var _naturalCollator = null;

/**
 * 自然順ソート（数値を考慮したファイル名ソート）。
 * 例: page_2.jpg < page_10.jpg
 * Intl.Collator の numeric オプションで言語側に処理させる。
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function naturalSort_(a, b) {
  if (!_naturalCollator) {
    _naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  }
  return _naturalCollator.compare(a, b);
}
