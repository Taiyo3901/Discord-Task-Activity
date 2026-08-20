# アーキテクチャ

```text
Discord Activity(埋め込みiframe) / 通常ブラウザ(開発用フォールバック)
  React + Vite
    ├─ @discord/embedded-app-sdk: authorize → (Edge Functionでcode交換) → authenticate
    ├─ patchUrlMappings: "/supabase" → <project-ref>.supabase.co
    ├─ Supabase JS client（自前JWTをAuthorizationヘッダ + realtime.setAuthへ手動適用）
    └─ @tanstack/react-query（キャッシュ・楽観的更新・Realtime通知でのキャッシュ無効化）
Supabase
  ├─ Postgres + RLS（001_init.sql + 002_redesign.sql）
  ├─ Edge Functions
  │    ├─ discord-token-exchange: Discordのcode→access_token交換(client_secret保持)、
  │    │     profiles upsert、自前HS256 JWT発行
  │    └─ discord-interactions: Discordスラッシュコマンド(/task add)のHTTP
  │          Interactions Endpoint、Ed25519署名検証
  ├─ pg_cron + pg_net: 期限が近い/超過したタスクと開始間近の予定をDiscord Incoming
  │     Webhookへ直接POST（Botプロセス不要）
  └─ Storage（task-filesバケット）
```

## 認証

Discord Activity内では、Supabase自体の`signInWithOAuth`ポップアップは使えない（サンドボックスされたiframe内でのポップアップ/トップレベルリダイレクトが許可されないため）。代わりに:

1. `discordSdk.commands.authorize({ scope: ["identify"] })` → 認可コードを取得。
2. コードを `discord-token-exchange` Edge Functionへ送信（`/supabase/functions/v1/...`、URL Mappings経由）。Functionはclient_secretを使ってDiscordのアクセストークンへ交換し、`/users/@me`で本人確認、`profiles`をupsertし、`sub`にプロフィールUUIDを持つ自前のHS256 JWTを発行して返す。
3. 受け取ったDiscordアクセストークンで`discordSdk.commands.authenticate()`を呼び、Discord Activity SDK自体のセッションも確立する。
4. 自前JWTをSupabaseクライアントの`Authorization`ヘッダーと`realtime.setAuth()`に適用し、以降のPostgREST/Realtime呼び出しでRLSの`auth.uid()`が解決される。

Discord Activity外（`npm run dev`でのローカル確認など）では、従来通りSupabaseのDiscord OAuthポップアップにフォールバックする。

## 同期方式

- タスク、予定、コメント、リンク、添付メタ情報はPostgres Changesで反映（`useRealtimeInvalidate`がReact Queryのキャッシュを無効化）。
- 閲覧中、入力中はPresenceで共有。
- タスク本文は最後の入力から3秒後に保存。
- `task_pages.version` を条件付き更新し、同時保存を検知（競合時はモーダル内で「最新版を見る/自分の内容で上書き」を選択）。

## 権限

- owner: 全管理
- admin: 招待、メンバー管理、編集、グループ設定
- member: 通常編集（タスク・予定・コメント・リンク・添付の作成/更新/削除）
- viewer: 読み取り専用（`is_group_editor()`を書き込み系RLSポリシーで使うことで強制）

`profiles`テーブルは自分自身、または同じグループに所属する相手のみ閲覧可能。
