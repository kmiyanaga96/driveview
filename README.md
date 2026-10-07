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
  - `getMangaPages`: 指定フォルダ内の画像を名前順（自然順ソート）で取得する。各ページに CDN 直の `thumb`（`thumbnailLink` のサイズ指定を除いたもの。クライアントが `=s<px>-rw` を付ける）と、失効時のフォールバック用の安定URL `url` を返す。ページ一覧は `CacheService` にフォルダ単位で30分キャッシュし、同期でそのフォルダの変更を検知したら破棄する。
- **`ChapterService.js`**: `Chapters` シートのCRUD処理。`getChapters` は `CacheService` に保持し、追加・削除時に破棄する。
- **`WebApp.js`**: `doGet` エントリポイントおよびフロントエンド公開API。
  - `getAllContent(clientVersion)`: スクリプトプロパティ `CONTENT_VERSION` (Main シートへの書き込みごとに更新) とクライアントのキャッシュ版数が一致すれば `notModified` のみ返し、全件転送を省く。スプレッドシートを手動編集した場合は `refreshContentVersion()` を実行する。
- **`index.html`**: アプリケーションシェル。
- **`Stylesheet.html`**: UIデザイン（Google Material 3 Light Theme風の白基調フラットデザイン、簡素なフェードアニメーション）。
- **`JavaScript.html`**: フロントエンドSPAロジック。
  - タグは種別ごとに色分けし、タグバーは種別ごとにグループ表示。タグ編集では種別を選んで追加でき、「作者:名前」の直接入力も可。入力欄にフォーカスすると未入力でも既存タグを全件サジェストし（種別ボタンで絞り込み）、スクロールして連続で選べる。
  - 検索バーはタイトルとタグ（種別付き表記を含む）を対象に、空白区切りの AND 検索。全角半角・大文字小文字は無視。
  - 一覧は40件ずつ描画し、末尾が近づいたら続きを追加する（IntersectionObserver）。
  - 漫画リーダーは `MangaLoader` で2段階の解像度を先読みする（先10ページを低解像度 `=s480`、現在と次3ページを表示サイズの高解像度。進行方向優先・同時3本・めくり過ぎた高解像度は中断）。高解像度が間に合わない時は低解像度を表示して差し替える。漫画カードへのホバー/タッチでリーダーのデータを先読みし、開いた直後は一覧の表紙を表示する。
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

### 自動デプロイ (GitHub Actions)
`main` に `src/` の変更が push されると、`.github/workflows/deploy-gas.yml` が `clasp push --force` で Apps Script プロジェクトへ反映し、`GAS_DEPLOYMENT_ID` のデプロイを新しいバージョンに更新する（Web アプリの URL は変わらない）。Actions タブの「Run workflow」から手動実行もできる。

#### 初回セットアップ（1回だけ）
1. https://script.google.com/home/usersettings で **Google Apps Script API を ON** にする。
2. Node.js 20 以上がある環境で clasp にログインする。手元に環境が無ければ、ブラウザで使える [Google Cloud Shell](https://shell.cloud.google.com/) でよい。
   ```bash
   npx @google/clasp@3 login --no-localhost
   # 表示されたURLをブラウザで開いて許可する。最後に「localhost に接続できません」の
   # ページになるが正常。そのアドレスバーのURL（http://localhost:8888/?code=... 全体）を貼り付ける
   cat ~/.clasprc.json                        # 中身をコピー
   ```
3. GitHub リポジトリの Settings → Secrets and variables → Actions で以下を登録する。
   - **Secrets** `CLASPRC_JSON`: 手順2でコピーした JSON 全体（Google アカウントの認証情報なので他所に貼らないこと）
   - **Variables** `GAS_DEPLOYMENT_ID`: GAS エディタの「デプロイ」→「デプロイを管理」に表示される Web アプリのデプロイ ID（`AKfycb...`）
4. Actions タブから「Deploy to Apps Script」を手動実行して成功を確認する。

#### 注意
- **OAuth スコープを変更した場合** (`appsscript.json` の `oauthScopes`)、自動デプロイ後に GAS エディタで任意の関数（例: `syncDriveContent`）を一度手動実行して再承認する。再承認するまで Web アプリはエラーになる。
- **バージョン数の上限**: Apps Script は1プロジェクトあたり最大200バージョン。デプロイのたびに1つ増えるため、上限に近づいたら GAS エディタの「プロジェクトの履歴」から古いバージョンを削除する。
- `CLASPRC_JSON` のトークンが失効した（パスワード変更・アクセス取り消し等）場合は、初回セットアップの手順2〜3をやり直す。

### 手動デプロイ（ローカル環境がある場合）
```bash
npm ci
npx clasp login
npx clasp push --force
npx clasp update-deployment <デプロイID>   # 新バージョンを作成して既存デプロイを更新
```
