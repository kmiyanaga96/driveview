# DriveView (Google Apps Script WebApp)

Google Drive内の動画ファイルや漫画フォルダを検知し、Googleスプレッドシートをデータベースとして活用して一覧表示・再生・閲覧を行うためのレスポンスの早いシングルページアプリケーション（SPA）です。

---

## 🚀 AI Agent Quick Start (省トークン設計)

このプロジェクトを編集するAIエージェントは、本セクションを読むだけで全体像を把握できます。

### 1. システムアーキテクチャ
```
[Google Drive] ─(差分同期+削除検知:1時間ごと)─> [DriveSync.js] ─(UPSERT)─> [Google Spreadsheet]
                                                                        │ (DB)
[Client Browser] <─(HTML / SPA)─ [WebApp.js] <─(google.script.run)──────┘
```

### 2. データベーススキーマ (Google Spreadsheet)
スプレッドシートIDはスクリプトのプロパティ `SPREADSHEET_ID` に保存されます。

#### `Main` シート (コンテンツ一覧)
- **Target_ID** (文字列): 動画のFile ID、または漫画のFolder ID (主キー)
- **Type** (文字列): `Video` または `Manga`
- **Title** (文字列): ファイル名/フォルダ名 (拡張子自動除去)
- **Tags** (文字列): カンマ区切りのタグ文字列。種別付きタグは `種別:名前`（例: `作者:山田`）で、種別は `JavaScript.html` の `TAG_KINDS` で定義（動画: 作者/キャラ、漫画: 作者/登場キャラ/シチュエーション）。未定義の接頭辞や接頭辞なしは「その他」扱い（初回同期時のみ Drive の説明欄で初期化。以後はアプリでの編集が優先され、同期で上書きされない）
- **Thumbnail_URL** (文字列): `https://drive.google.com/thumbnail?id=<ファイルID>&sz=w400` 形式の失効しないURL、または直接埋め込まれた **超圧縮Base64データURL**。Drive API の `thumbnailLink` は数時間で失効するため保存しない
- **WebView_URL** (文字列): 動画プレビュー用のWebView URL

#### `Chapters` シート (漫画のしおり/目次)
- **Chapter_ID** (文字列): `ch_` から始まるユニークID (主キー)
- **Target_ID** (文字列): 対象漫画の `Target_ID` (外部キー)
- **Position** (数値): ページインデックス (0-indexed)
- **Label** (文字列): チャプター名

### 3. ソースファイル構成と役割
全てのソースは `src/` ディレクトリにあります。

- **`appsscript.json`**: マニフェストファイル。Webアプリの実行権限 (`USER_DEPLOYING` = デプロイユーザー権限、アクセスは `MYSELF` のみ) および OAuthスコープを設定。Drive は読み取り専用 (`drive.readonly`) で、書き込みはスプレッドシートのみ。
- **`Config.js`**: 設定定数。動画/漫画の巡回ルートフォルダID、シート名、サムネイル圧縮サイズを定義。
- **`SpreadsheetDB.js`**: スプレッドシートDBアクセス層。
  - `dbBatchUpsertContent`: 既存行を1回で読み出し、差分のある行のみ更新・新規行は末尾に一括追加。ユーザーが編集したタグとBase64サムネイルは保持する。
  - `dbDeleteContentNotIn_`: Drive から消えたコンテンツの行を削除する（同期から呼ばれる）。
- **`DriveSync.js`**: 定期同期バッチ。
  - `syncDriveContent`: ルートフォルダごとの同期位置 (`LAST_SYNC_TIME:<folderId>`) を使った差分同期。`modifiedTime` 昇順で処理し、6分制限で中断しても次回は続きから再開する。完走時は ID のみの全件列挙で削除されたコンテンツを掃除する（列挙 0 件の種別は誤削除防止のためスキップ）。
  - `forceFullSync`: 全ルートの同期位置をリセットして再同期する（タグ・カスタムサムネイルは保持）。
- **`MangaService.js`**: 漫画リーダー処理。
  - `getMangaPages`: 指定フォルダ内の画像を名前順（自然順ソート）で取得し、失効しない高解像度URL (`sz=w1200`) を生成。ページ一覧は `CacheService` にフォルダ単位で1時間キャッシュし、同期でそのフォルダの変更を検知したら破棄する。
- **`ChapterService.js`**: `Chapters` シートのCRUD処理。
- **`WebApp.js`**: `doGet` エントリポイントおよびフロントエンド公開API。
  - `getAllContent(clientVersion)`: スクリプトプロパティ `CONTENT_VERSION` (Main シートへの書き込みごとに更新) とクライアントのキャッシュ版数が一致すれば `notModified` のみ返し、全件転送を省く。スプレッドシートを手動編集した場合は `refreshContentVersion()` を実行する。
- **`index.html`**: アプリケーションシェル。
- **`Stylesheet.html`**: UIデザイン（Google Material 3 Light Theme風の白基調フラットデザイン、簡素なフェードアニメーション）。
- **`JavaScript.html`**: フロントエンドSPAロジック。
  - タグは種別ごとに色分けし、タグバーは種別ごとにグループ表示。タグ編集では種別を選んで追加でき、「作者:名前」の直接入力も可。
  - 検索バーはタイトルとタグ（種別付き表記を含む）を対象に、空白区切りの AND 検索。全角半角・大文字小文字は無視。
  - 一覧データは IndexedDB (`driveview` DB) にキャッシュし、起動時に即描画してから版数付きでサーバへ問い合わせる (Stale-While-Revalidate)。
  - ビデオから canvas を使って320px幅・品質0.6（約10KB・15,000文字以下）の美麗なBase64サムネイルを切り出し、直接スプレッドシートに保存する機能を内蔵。
  - フレームキャプチャは既定で動画の先頭32MBだけを Range 取得して冒頭から切り出す（取得済みデータはエディタを閉じるまで再利用）。先頭だけで再生できない動画（moov が末尾の MP4 等）は自動で全体取得にフォールバックし、「動画全体から選ぶ」で全体からも選べる。

### 4. 開発方針とバックログ
- **方針**: 「シンプルな動画・漫画閲覧ツール」「モダンでシンプルなUI」を維持し、UX のための地道な性能改善を続ける。
- **見送り**: Gemini 等の AI 機能（自動タグ付け・自然文検索など）は目的に対して規模が大きすぎるため導入しない (2026-10 決定)。
- **改善候補** (優先度順。着手・完了したらここを更新する):
  1. ~~サムネイルの期限切れ対策~~ (完了: 同期で失効しないURLを保存。旧データは `forceFullSync` を一度実行して移行)
  2. ~~初期ロードの転送量削減~~ (完了: データ版数 `CONTENT_VERSION` による条件付き取得)
  3. ~~クライアントキャッシュの容量対策~~ (完了: IndexedDB へ移行)
  4. ~~漫画ページ一覧のサーバキャッシュ~~ (完了: `CacheService` に1時間保持、同期で変更検知時に破棄)
  5. ~~フレームキャプチャの軽量化~~ (完了: 先頭32MBの Range 取得 + 取得済みデータの再利用)

---

## 🛠 開発とデプロイ手順

### 準備
- Node.js >= 18
- `clasp` のグローバルインストール (`npm install -g @google/clasp`)
- Googleアカウントでの Google Apps Script API の有効化

### コマンド
```bash
# 依存パッケージのインストール
npm install

# クラスプによるGoogleアカウントログイン
clasp login

# コードをGASプロジェクトに転送 (デプロイ)
clasp push --force
```

※ OAuth スコープを変更した後は、GASエディタで任意の関数（例: `syncDriveContent`）を一度手動実行して再承認してください。

※ WebAppの実行権限が `USER_DEPLOYING` に設定されているため、変更を適用する際はGASエディタ上で必ず **「新しいデプロイ (New Deployment)」** を作成し、新しいバージョンをリリースしてください。
