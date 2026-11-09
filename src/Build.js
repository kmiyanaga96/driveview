/**
 * DriveView - Build Info
 *
 * デプロイ元のコミットを画面で確認するための値。
 * GitHub Actions (deploy-gas.yml) が clasp push の直前に
 * "main@<コミット> <日時>" へ書き換える。手動 push では 'dev' のまま。
 */
var BUILD_INFO = 'dev';
