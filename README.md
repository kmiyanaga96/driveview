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
- **Tags** (文字列): カンマ区切りのタグ文字列（初回同期時のみ Drive の説明欄で初期化。以後はアプリでの編集が優先され、同期で上書きされない）
- **Thumbnail_URL** (文字列): サムネイルURL、または直接埋め込まれた **超圧縮Base64データURL**
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
  - `getMangaPages`: 指定フォルダ内の画像を名前順（自然順ソート）で動的取得し、高解像度URLを生成。
- **`ChapterService.js`**: `Chapters` シートのCRUD処理。
- **`WebApp.js`**: `doGet` エントリポイントおよびフロントエンド公開API。
- **`index.html`**: アプリケーションシェル。
- **`Stylesheet.html`**: UIデザイン（Google Material 3 Light Theme風の白基調フラットデザイン、簡素なフェードアニメーション）。
- **`JavaScript.html`**: フロントエンドSPAロジック。
  - ビデオから canvas を使って320px幅・品質0.6（約10KB・15,000文字以下）の美麗なBase64サムネイルを切り出し、直接スプレッドシートに保存する機能を内蔵。

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
