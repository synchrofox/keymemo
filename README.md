# Secure KeyMemo

ブラウザだけで動作する、パスワード暗号化付きの Markdown メモアプリです。
メモはブラウザ内で暗号化され、`.keymemo` ファイルとしてローカルに保存されます。サーバーへデータを送信することはありません。

## 特徴

- **クライアントサイド暗号化** — Web Crypto API による AES-GCM (256bit) 暗号化。鍵はパスワードから PBKDF2 (SHA-256, 600,000 回) で導出します。
- **Markdown エディタ** — リアルタイムプレビュー、シンタックスハイライト (Prism.js)、エディタとプレビューのスクロール連動。
- **ファイルへの直接保存** — File System Access API 対応ブラウザでは `.keymemo` ファイルを直接開いて上書き保存できます (`Ctrl/Cmd + S`)。非対応ブラウザでは暗号化ファイルのダウンロードで保存します。
- **リロード対策** — 未保存の内容は暗号化したうえで `sessionStorage` に一時退避し、パスワード再入力で復元できます。
- **パスワード強度チェック** — 新規作成時に強度を表示し、弱いパスワードには警告を出します。
- **ロック機能** — ロック時にメモリ上の内容とセッションバックアップを破棄します。
- **モバイル対応** — 狭い画面では編集とプレビューを切り替えて表示します。

## セキュリティ設計

| 項目 | 内容 |
| --- | --- |
| 暗号方式 | AES-GCM 256bit |
| 鍵導出 | PBKDF2-SHA256, 600,000 iterations |
| ファイル形式 | `salt (16 bytes) ‖ IV (12 bytes) ‖ 暗号文` |
| XSS 対策 | Markdown の描画結果を DOMPurify でサニタイズ |
| 外部通信 | なし (依存ライブラリはビルド時に同梱し、CSP で `connect-src 'none'` を指定) |

> [!WARNING]
> パスワードを忘れると `.keymemo` ファイルは復号できません。パスワードの復旧手段はありません。

## 使い方

1. **新規作成**: パスワードを入力して「新規作成」を押します。
2. **既存ファイルを開く**: `.keymemo` ファイルをドロップ (またはクリックして選択) し、パスワードを入力して「ロック解除」を押します。
3. **保存**: 「上書き保存」/「暗号化保存」ボタン、または `Ctrl/Cmd + S`。別ファイルに保存する場合は「名前を付けて保存」を使います。
4. **ロック**: 作業後は「ロック」で編集内容とパスワードを破棄します。

## 開発

Node.js 22 以上を推奨します。

```sh
npm install
npm run dev     # ビルド後、http://127.0.0.1:4173 で開発サーバーを起動
npm run build   # dist/ に静的ファイルを出力
```

開発サーバーのポートは環境変数 `PORT` で変更できます。

### ディレクトリ構成

```
├── index.html            # 画面のマークアップ
├── js/
│   ├── app.js            # アプリ本体 (状態管理・ファイル入出力・セッション退避)
│   ├── crypto.js         # 暗号化/復号処理
│   └── ui.js             # UI ヘルパー (プレビュー、トースト、スクロール連動など)
├── css/                  # スタイル (Tailwind CSS)
├── scripts/
│   ├── build.mjs         # esbuild によるバンドルと依存ライブラリのコピー
│   └── dev.mjs           # 開発用の静的ファイルサーバー
├── Dockerfile
├── compose.yaml
└── nginx.conf
```

## デプロイ

### GitHub Pages

`main` ブランチへの push で GitHub Actions ([.github/workflows/build.yml](.github/workflows/build.yml)) がビルドし、GitHub Pages にデプロイします。

### Docker (Traefik 経由)

nginx でビルド成果物を配信するコンテナを、Traefik のリバースプロキシ配下で起動します。外部ネットワーク `proxy` と、`letsencrypt` という名前の証明書リゾルバが設定された Traefik が必要です。

```sh
cp .env.example .env    # MY_DOMAIN を自分のドメインに変更
docker compose up -d --build
```

`https://keymemo.<MY_DOMAIN>` で公開されます。nginx では CSP などのセキュリティヘッダーを付与しています ([nginx.conf](nginx.conf))。

> [!NOTE]
> File System Access API による直接保存はセキュアコンテキスト (HTTPS または localhost) でのみ有効です。
