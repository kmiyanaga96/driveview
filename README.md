# DriveView (Google Apps Script WebApp)

Google Drive内の動画ファイルや漫画フォルダを検知し、Googleスプレッドシートをデータベースとして活用して一覧表示・再生・閲覧を行うためのレスポンスの早いシングルページアプリケーション（SPA）です。

---

## 🚀 AI Agent Quick Start (省トークン設計)

このプロジェクトを編集するAIエージェントは、本セクションを読むだけで全体像を把握できます。

### 1. システムアーキテクチャ
```
[Google Drive] ─(差分同期:1時間ごと)─> [DriveSync.js] ─(UPSERT)─> [Google Spreadsheet]
                                                                        │ (DB)
[Client Browser] <─(HTML / SPA)─ [WebApp.js] <─(google.script.run)──────┘
```

### 2. データベーススキーマ (Google Spreadsheet)
スプレッドシートIDはスクリプトのプロパティ `SPREADSHEET_ID` に保存されます。

#### `Main` シート (コンテンツ一覧)
- **Target_ID** (文字列): 動画のFile ID、または漫画のFolder ID (主キー)
- **Type** (文字列): `Video` または `Manga`
- **Title** (文字列): ファイル名/フォルダ名 (拡張子自動除去)
- **Tags** (文字列): カンマ区切りのタグ文字列
- **Thumbnail_URL** (文字列): サムネイルURL、または直接埋め込まれた **超圧縮Base64データURL**
- **WebView_URL** (文字列): 動画プレビュー用のWebView URL

#### `Chapters` シート (漫画のしおり/目次)
- **Chapter_ID** (文字列): `ch_` から始まるユニークID (主キー)
- **Target_ID** (文字列): 対象漫画の `Target_ID` (外部キー)
- **Position** (数値): ページインデックス (0-indexed)
- **Label** (文字列): チャプター名

### 3. ソースファイル構成と役割
全てのソースは `src/` ディレクトリにあります。

- **`appsscript.json`**: マニフェストファイル。Webアプリの実行権限 (`USER_DEPLOYING` = デプロイユーザー権限) および OAuthスコープを設定。
- **`Config.js`**: 設定定数。動画/漫画の巡回ルートフォルダID、シート名、サムネイル圧縮サイズを定義。
- **`SpreadsheetDB.js`**: スプレッドシートDBアクセス層。
  - `dbBatchUpsertContent`: 大量データをメモリ上でマージし、1回の `setValues` で一括保存する最適化済み。
- **`DriveSync.js`**: 定期同期バッチ。
  - `syncDriveContent`: `modifiedTime > lastSync` による差分同期。6分制限回避のためのタイマー付き。
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

※ WebAppの実行権限が `USER_DEPLOYING` に設定されているため、変更を適用する際はGASエディタ上で必ず **「新しいデプロイ (New Deployment)」** を作成し、新しいバージョンをリリースしてください。
