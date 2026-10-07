/**
 * DriveView - Manga Service
 *
 * 要件4.2: 漫画の画像URLはMainシートに記録せず、
 * ユーザー操作時にフォルダIDから動的取得する。
 */

var MANGA_PAGES_CACHE_PREFIX = 'manga_pages2:';
// thumbnailLink (数時間で失効) を含むため短めに保持する。失効時はクライアントが安定URLへフォールバックする
var MANGA_PAGES_CACHE_TTL_SEC = 30 * 60;

/**
 * 漫画フォルダ内の全画像ページを名前順で取得する。
 * ページ一覧は CacheService に保持し、再オープン時の Drive 走査を省く。
 *
 * 画像の取得経路:
 *   thumb: Drive の thumbnailLink からサイズ指定を除いたもの (lh3.googleusercontent.com)。
 *          クライアントが "=s<px>-rw" を付けて CDN から直接取得する（リダイレクト無しで最速）。
 *   url:   失効しない drive.google.com/thumbnail 形式。thumb が無い/失効した場合のフォールバック。
 * @param {string} folderId 漫画フォルダのID (= Target_ID)
 * @returns {Array<Object>} ページ情報の配列 {id, name, thumb, url}
 */
function getMangaPages(folderId) {
  var config = getConfig();
  var cache = CacheService.getScriptCache();
  var cacheKey = MANGA_PAGES_CACHE_PREFIX + folderId;

  var entries = null;
  var cached = cache.get(cacheKey);
  if (cached) {
    try { entries = JSON.parse(cached); } catch (e) { entries = null; }
  }

  if (!entries) {
    entries = listMangaPageEntries_(folderId, config);
    try {
      cache.put(cacheKey, JSON.stringify(entries), MANGA_PAGES_CACHE_TTL_SEC);
    } catch (e) {
      // 100KB 超などで保存できない場合はキャッシュしない
      Logger.log('Manga pages cache skipped for ' + folderId + ': ' + e.message);
    }
  }

  var pages = [];
  for (var i = 0; i < entries.length; i++) {
    pages.push({
      id: entries[i][0],
      name: entries[i][1],
      thumb: entries[i][2] || '',
      url: driveThumbnailUrl_(entries[i][0], config.THUMB_WIDTH_READER)
    });
  }
  return pages;
}

/**
 * 漫画ページ一覧のキャッシュを破棄する（同期で漫画フォルダの変更を検知した時に呼ぶ）。
 * @param {string} folderId
 */
function invalidateMangaPagesCache_(folderId) {
  CacheService.getScriptCache().remove(MANGA_PAGES_CACHE_PREFIX + folderId);
}

/**
 * Drive から漫画フォルダ内の画像を列挙し、自然順でソートした [id, name, thumbBase] を返す。
 * @param {string} folderId
 * @param {Object} config
 * @returns {Array<Array<string>>}
 */
function listMangaPageEntries_(folderId, config) {
  var mimeQuery = config.IMAGE_MIMETYPES
    .map(function (m) { return "mimeType='" + m + "'"; })
    .join(' or ');

  var query = "(" + mimeQuery + ") and '" + folderId + "' in parents and trashed=false";
  var entries = [];
  var pageToken = null;

  do {
    var response = Drive.Files.list({
      q: query,
      fields: 'nextPageToken,files(id,name,thumbnailLink)',
      pageSize: 1000,
      pageToken: pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    var files = response.files || [];
    for (var i = 0; i < files.length; i++) {
      // 末尾のサイズ指定 (=s220 等) を除き、クライアント側で表示サイズを付ける
      var thumb = files[i].thumbnailLink ? files[i].thumbnailLink.replace(/=s\d+$/, '') : '';
      entries.push([files[i].id, files[i].name, thumb]);
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  // 名前順（ページ順）でソート
  entries.sort(function (a, b) {
    return naturalSort_(a[1], b[1]);
  });

  return entries;
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
