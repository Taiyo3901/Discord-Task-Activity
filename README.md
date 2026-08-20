# Discord Task Activity

Discordのボイスチャンネルに埋め込んで使う、タスク・予定・メモ共有アプリ（Discord Activity）。

- Discordアカウントだけでログイン（Discord Embedded App SDKのauthorize/authenticateフロー）
- Trello風カンバンボード（ドラッグ&ドロップ、優先度・期限・担当者、コメント・リンク・添付ファイル）
- 予定、メンバー招待/権限管理、グループ設定
- タスク期限・予定開始のDiscord Webhook通知、`/task add`スラッシュコマンド

すべて無料枠（Supabase Free + Vercel Hobby）で運用できる構成です。常駐するBotプロセスは使いません。

## セットアップ

```cmd
npm install
copy .env.example .env
npm run dev
```

## デプロイ

`docs/DEPLOY.md` を参照してください（Discord Developer Portal / Supabase / Vercel の設定手順）。

## ドキュメント

- `docs/ARCHITECTURE.md` — 全体構成と同期方式
- `docs/ROADMAP.md` — 実装済み/未実装機能
- `docs/DEPLOY.md` — デプロイ手順
