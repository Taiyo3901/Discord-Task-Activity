# Discord Task Activity

Discordのボイスチャンネルに埋め込んで使う、タスク・予定・メモ共有アプリ（[Discord Activity](https://discord.com/developers/docs/activities/overview)）。Discordアカウントだけでログインでき、チームのタスク管理・予定共有・ファイル共有をDiscordから離れずに行えます。

常駐するBotプロセスは使わず、**Discord Developer Portal / Supabase Free / Vercel Hobby** の無料枠だけで運用できる構成です。

## 目次

- [主な機能](#主な機能)
- [技術スタック](#技術スタック)
- [アーキテクチャ](#アーキテクチャ)
- [ロールと権限](#ロールと権限)
- [ローカル開発](#ローカル開発)
- [デプロイ手順](#デプロイ手順)
- [実装状況](#実装状況)
- [ドキュメント](#ドキュメント)

## 主な機能

### ログイン

- Discordアカウントのみでログイン（パスワード不要）。
- Discord Activity内では `@discord/embedded-app-sdk` の authorize/authenticate フローを使用。
- Activity外（ブラウザで直接開いた場合）は、Supabase Auth経由のDiscord OAuthにフォールバック（開発・動作確認用）。

### ボード（カンバン）

- 列は固定4つ: 未着手 → 進行中 → 確認待ち → 完了。ドラッグ&ドロップでステータス変更。
- 列下部からタイトル入力のみでタスクをクイック追加。
- タスクカードは優先度（低・中・高・緊急、色分けされた左ボーダー）、期限（時刻付きの場合は時刻も表示）、担当者アバター、リンク/添付件数を表示。
- 期限が今日を過ぎている/2日以内に迫っているタスクは、それぞれ強調表示。

### タスク詳細

左側に本文（詳細・メモ・仕様）を大きく、右側にステータスなどの設定項目を並べた2カラムのレイアウトです。

- ステータス・優先度・担当者をその場で変更（即保存）。
- 期限は日付に加えて時刻も任意で設定可能（時刻未設定なら終日扱い）。期限を変更するとリマインド通知が再度そのタイミングで届くようリセットされる。通知タイミングはタスクごとに個別上書き可能（未指定ならグループの既定値）。
- カレンダーにも表示される短い「概要」欄。
- 本文は自由記述のテキストエリアで、入力停止から**3秒後に自動保存**。直近の更新者をアイコン付きで表示。
- 同じタスクを複数人が同時に開くと、アイコン付きで「〇〇が入力中/閲覧中」とプレゼンス表示。
- `task_pages.version` を使ったバージョン競合検知。他人が先に保存していた場合は「最新版を見る」か「自分の内容で上書き」を選択可能。
- 関連リンク（`https://`のみ）、添付ファイル（Supabase Storage、上限10MB、実行ファイル系拡張子は拒否）をタスクごとに管理。画像はサムネイル+拡大プレビュー、ダウンロードは元のファイル名を保った別ボタンから。

### 予定（カレンダー）

- 月間カレンダーを表示エリア全幅で大きく表示し、日曜=赤・土曜=青・今日はアクセント色でハイライト。
- 期限つきタスクもカレンダー上に別色のチップとして自動表示（タスク名+概要、優先度で色分け、完了済みは打ち消し線）。
- 日付をクリックすると、その場所の近くにポップアップでその日の予定・期限タスクの一覧が表示され、その場で予定の追加・編集・削除が可能（タスクの編集はボードから）。
- 予定は開始・終了それぞれ時刻を任意設定でき、両方空欄なら終日として扱われる。詳細メモも記録可能。
- 前月/翌月への移動、「今日」ボタンでの即時ジャンプ。

### メンバー・グループ管理

- タスクや予定はすべて「グループ」単位（Discordサーバー1つに1グループ、など自由に運用）。
- Discord User IDを指定してメンバーを招待（7日間有効な招待、ロール指定可）。
- メンバーのロール変更・削除、グループからの脱退。
- メンバー一覧にはDiscordアバターと役割バッジを表示。

### グループ設定

- グループ名の変更。
- 通知用Discord Webhook URLの登録。
- 連携するDiscordサーバーID（Guild ID）の登録（`/task add`スラッシュコマンドの有効化）。
- タスク/予定それぞれのリマインド通知タイミングの既定値（0分前〜3日前から選択、タスク/予定ごとに個別上書き可能）。

### Discordとの連携

- **自動リマインド**: Supabaseのpg_cronが最大30分おきにチェックし、グループごとに設定したタイミング（期限/開始の何分〜何日前）になったタスク・予定を、登録したWebhook宛のDiscordチャンネルへ一度だけ自動投稿（Botプロセス不要、`pg_net`でHTTP POST）。期限やリマインド設定を変更すると再度通知対象になる。
- **スラッシュコマンド**: 連携済みのDiscordサーバーから `/task add title:<タイトル> due:<期限>` で、ログイン済み・グループ参加済みのユーザーが直接タスクを追加可能。

## 技術スタック

| 領域 | 技術 |
| --- | --- |
| フロントエンド | React 19, TypeScript, Vite 7 |
| データ取得/キャッシュ | @tanstack/react-query |
| ドラッグ&ドロップ | @dnd-kit |
| アイコン | lucide-react |
| Discord連携 | @discord/embedded-app-sdk |
| バックエンド | Supabase（Postgres + RLS, Edge Functions（Deno）, Realtime, Storage） |
| 定期処理 | pg_cron + pg_net（Discord Webhookへ直接POST） |
| ホスティング | Vercel（フロントエンド, Hobbyプラン） |

## アーキテクチャ

```text
Discordクライアント（ボイスチャンネル埋め込み） / 通常ブラウザ（開発用フォールバック）
  React + Vite
    ├─ @discord/embedded-app-sdk: authorize → (Edge Functionでcode交換) → authenticate
    ├─ patchUrlMappings: "/supabase" → <project-ref>.supabase.co
    ├─ Supabase JSクライアント（自前JWTをAuthorizationヘッダ + realtime.setAuthへ手動適用）
    └─ @tanstack/react-query（キャッシュ・楽観的更新・Realtime通知でのキャッシュ無効化）
Supabase
  ├─ Postgres + RLS（supabase/migrations/001_init.sql + 002_redesign.sql）
  ├─ Edge Functions
  │    ├─ discord-token-exchange: Discordのcode→access_token交換（client_secret保持）、
  │    │     profiles upsert、自前HS256 JWT発行
  │    └─ discord-interactions: Discordスラッシュコマンド(/task add)のHTTP
  │          Interactions Endpoint、Ed25519署名検証
  ├─ pg_cron + pg_net: 期限が近い/超過したタスクと開始間近の予定をDiscord Incoming
  │     Webhookへ直接POST（Botプロセス不要）
  └─ Storage（task-filesバケット）
```

### 認証フロー

Discord Activity内では、Supabase自体の`signInWithOAuth`ポップアップは使えません（サンドボックスされたiframe内でのポップアップ/トップレベルリダイレクトが許可されないため）。代わりに次のフローを使います。

1. `discordSdk.commands.authorize({ scope: ["identify"] })` で認可コードを取得。
2. コードを`discord-token-exchange` Edge Function（`/supabase/functions/v1/...`、URL Mappings経由）へ送信。FunctionはDiscordのclient_secretを使ってアクセストークンへ交換し、`/users/@me`で本人確認、`profiles`テーブルをupsertし、プロフィールUUIDを`sub`に持つ自前のHS256 JWTを発行して返す。
3. 受け取ったDiscordアクセストークンで`discordSdk.commands.authenticate()`を呼び、Discord Activity SDK自体のセッションも確立。
4. 自前JWTをSupabaseクライアントの`Authorization`ヘッダーと`realtime.setAuth()`に適用し、以降のPostgREST/RealtimeでRLSの`auth.uid()`が解決される。

Discord Activity外（`npm run dev`でのローカル確認など）では、通常のSupabase Discord OAuthポップアップにフォールバックします。

### 同期方式

- タスク・予定・リンク・添付メタ情報はPostgres Changes（Realtime）で反映（`useRealtimeInvalidate`がReact Queryのキャッシュを無効化）。
- 閲覧中/入力中の状態はPresenceで共有。
- タスク本文は最後の入力から3秒後に自動保存。
- `task_pages.version`を条件付き更新することで同時保存の競合を検知し、UI上で解決方法を選択させる。

## ロールと権限

| ロール | 権限 |
| --- | --- |
| `owner` | グループ作成者。全操作可能 |
| `admin` | 招待、メンバー管理、編集、グループ設定の変更が可能 |
| `member` | タスク・予定・リンク・添付の作成/更新/削除など通常編集が可能 |
| `viewer` | 読み取り専用（`is_group_editor()`を書き込み系RLSポリシーで使うことで強制） |

`profiles`テーブルは自分自身、または同じグループに所属する相手のみ閲覧できます。

## ローカル開発

```cmd
npm install
copy .env.example .env
npm run dev
```

`.env`に以下を設定してください（`.env.example`参照。値の取得場所は[デプロイ手順](#デプロイ手順)内の付録を参照）。

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_DISCORD_CLIENT_ID=YOUR_DISCORD_APPLICATION_ID
```

`npm run dev`はDiscord Activity外のブラウザとして起動するため、Supabase Discord OAuthのフォールバック経路でログインします。

その他のコマンド:

```cmd
npm run build       # 型チェック + 本番ビルド
npm run typecheck   # 型チェックのみ
npm run preview     # ビルド成果物のプレビュー
```

## デプロイ手順

すべて無料枠で完結します（Discord Developer Portal / Supabase Free / Vercel Hobby）。

### 1. Discord Developer Portal

1. https://discord.com/developers/applications で新規Applicationを作成。
2. 左メニュー「Activities」を有効化。
3. 「OAuth2」→ **Client ID**を控える（`VITE_DISCORD_CLIENT_ID` / `DISCORD_CLIENT_ID`）。「Reset Secret」で**Client Secret**を発行し控える（`DISCORD_CLIENT_SECRET`、フロントエンドには絶対に置かない。表示はリセット直後の一瞬だけ）。
4. 「General Information」下部の**Public Key**を控える（`DISCORD_PUBLIC_KEY`、スラッシュコマンド検証用）。
5. 「Activities」→「URL Mappings」を設定する。
   - 最初から`/`（ルート）のマッピングが1行あり、Prefixは編集不可。**Target**に後述のVercelドメインを入れる（空だとActivityが起動できない。「ルートURLマッピングのターゲットが必要です」というエラーで保存がブロックされる）。
   - 「Add Mapping」で行を追加し、Prefix=`/supabase`、Target=`<project-ref>.supabase.co`を設定。
   - Discordはprefixを上から順にマッチさせるため、`/supabase`の行は`/`の行より**上**に置く。

     | Prefix | Target |
     | --- | --- |
     | `/supabase` | `<project-ref>.supabase.co` |
     | `/` | Vercelのデプロイドメイン |

6. 「Interactions Endpoint URL」に、後述のEdge Function `discord-interactions` のURLを設定（Discordが即PINGを送るため、**先にEdge Functionをデプロイしてから**設定する）。
7. スラッシュコマンドが必要なら、Discord REST APIか`discord.js`等で `/task add`（`title`必須文字列、`due`任意文字列）をアプリケーションコマンドとして一度だけローカルから登録（常駐プロセス不要）。

### 2. Supabase

無料プロジェクトを1つ作成し、プロジェクトルートで実行します（`supabase`はdevDependencies済みなので`npx supabase`で使えます）。

```cmd
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

- `supabase/migrations/001_init.sql`・`002_redesign.sql`・`003_reminders_and_details.sql`・`004_calendar_fix_and_item_reminders.sql`が適用されます。
- `002_redesign.sql`はpg_cron/pg_netの有効化とcron登録も含みますが、失敗する場合はDashboardの`Database > Extensions`で先に手動ONにし、SQL Editorで以下を再実行してください。

```sql
select cron.unschedule(jobid) from cron.job where jobname = 'notify-due-tasks';
select cron.schedule('notify-due-tasks', '*/30 * * * *', $$select public.notify_due_tasks()$$);
```

Edge Functionsをデプロイします。

```cmd
npx supabase functions deploy discord-token-exchange
npx supabase functions deploy discord-interactions
```

シークレットを設定します（`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`は自動注入されるので不要）。

```cmd
npx supabase secrets set DISCORD_CLIENT_ID=xxxx
npx supabase secrets set DISCORD_CLIENT_SECRET=xxxx
npx supabase secrets set DISCORD_PUBLIC_KEY=xxxx
npx supabase secrets set APP_JWT_SECRET=xxxx
```

> `SUPABASE_`で始まる名前はSupabase Edge Runtimeの予約プレフィックス（`SUPABASE_URL`等の自動注入用）のため、`npx supabase secrets set`では設定できません（`Env name cannot start with SUPABASE_, skipping`というエラーになります）。そのため上記のとおり`APP_JWT_SECRET`という名前でシークレットを設定します。値自体はDashboard → Project Settings → API →「JWT Secret」（レガシー、非対称鍵に切り替え済みの場合は表示名が異なることがあります）からコピーします。

> **既知の制約**: このアプリはSupabaseのレガシーJWTシークレット(HS256)で自前JWTを署名し、`auth.uid()`を成立させています。Supabaseは将来的に非対称鍵ベースの「Third-Party Auth」への移行を推奨していますが、現時点ではレガシーシークレットが有効な限りこの方式は動作します。

StorageバケットとRLSは`001_init.sql`/`002_redesign.sql`の適用で自動的に作成されます。

### 3. Vercel

1. https://vercel.com/signup で「Continue with GitHub」からサインアップ。
2. 「Add New...」→「Project」→ このリポジトリをImport（一覧に無ければ「Adjust GitHub App Permissions」でアクセス許可）。
3. Configure Project画面（ほぼ自動検出）:

   | 項目 | 値 |
   | --- | --- |
   | Framework Preset | `Vite` |
   | Root Directory | `./` |
   | Build Command | `npm run build` |
   | Output Directory | `dist` |
   | Install Command | `npm install` |

4. 「Environment Variables」に以下を追加（**忘れるとビルドは通っても起動時にエラーになる**）。

   | Key | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | Supabase Dashboardの anon/public key |
   | `VITE_DISCORD_CLIENT_ID` | DiscordのClient ID |

5. 「Deploy」（Hobbyプラン、無料）。1〜2分で発行ドメイン（例: `discord-task-activity.vercel.app`）が表示される。
6. 発行ドメイン（`https://`抜きのホスト名）を、手順1の「URL Mappings」の`/`ターゲットに設定。
7. 以後、`main`へのpushで自動再デプロイ。環境変数を後から変えた場合は自動反映されないため、Settings → Environment Variables編集後、Deploymentsタブから「Redeploy」を手動実行。

### 4. 動作確認

- ブラウザで直接VercelのURLを開くと、通常のSupabase Discord OAuthログイン画面が出ます（Activity外のフォールバック）。この場合、Supabase Dashboard の Authentication → Providers → Discord にClient ID/Secretを別途設定する必要があります。
- Discordデスクトップアプリでボイスチャンネルに入り、Activity一覧からアプリを起動 → 自動ログイン → ボード表示を確認。
- 複数アカウントで同じタスクを同時に開き、プレゼンス表示・自動保存・競合検知を確認。
- グループ設定にDiscord Webhook URLを登録し、期限を今日にしたタスクを作成 → 最大30分待つ（またはSQL Editorで`select public.notify_due_tasks();`を手動実行）→ 通知が届くか確認。
- Discordの任意チャンネルで `/task add title:テスト` を実行 → 該当グループにタスクが追加されるか確認。

### 付録: 各値の取得場所

**Discord Developer Portal** (https://discord.com/developers/applications)

| 値 | 取得場所 |
| --- | --- |
| Client ID | 「General Information」の APPLICATION ID、または「OAuth2」→General の CLIENT ID |
| Client Secret | 「OAuth2」→General、「Reset Secret」で発行（その瞬間しか表示されない） |
| Public Key | 「General Information」下部（常時表示） |
| Guild ID | Discord本体で開発者モードON→対象サーバーを右クリック→「サーバーIDをコピー」 |
| Webhook URL | チャンネルの歯車→「連携サービス」→「ウェブフック」→新規作成 |
| User ID | 開発者モードON後、ユーザー右クリック→「ユーザーIDをコピー」 |

**Supabase** (https://supabase.com/dashboard)

| 値 | 取得場所 |
| --- | --- |
| `<project-ref>` | ダッシュボードURLの一部、またはProject Settings→General→Reference ID |
| `VITE_SUPABASE_URL` | Project Settings→API→Project URL |
| `VITE_SUPABASE_ANON_KEY` | 同ページ、`anon`/`public`（`publishable key`表記の場合あり） |
| `APP_JWT_SECRET`の値 | Project Settings→API→JWT Settings→JWT Secret |
| `SUPABASE_SERVICE_ROLE_KEY` | 同ページ、`service_role`/`secret`（Edge Functionsには自動注入） |
| Discord OAuthプロバイダー | Authentication→Providers→Discord にClient ID/Secret設定、表示されるCallback URLをDiscord側「OAuth2」→「Redirects」に追加登録 |
| Redirect URLs（**忘れるとDiscord認証後にアプリへ戻れない**） | Authentication→URL Configuration の「Site URL」「Redirect URLs」にVercelの本番ドメイン（例: `https://xxx.vercel.app/**`）を登録。未登録のURLへは`signInWithOAuth`の`redirectTo`が機能せず、認証後にデフォルトのSite URLへ飛ばされてしまう |

**Vercel** (https://vercel.com/dashboard)

| 値 | 取得場所 |
| --- | --- |
| デプロイドメイン | Deploy後の画面上部、または「Domains」タブ |

## 実装状況

### 実装済み

- Discord Activity（埋め込み）起動、Discordアカウントのみでのログイン
- Trello風カンバンボード（ドラッグ&ドロップでステータス変更、インライン追加、優先度・期限・担当者）
- タスク詳細（本文の共同編集、プレゼンス、自動保存、競合検知、リンク/添付ファイル、それぞれの削除、期限時刻、カレンダー連携）
- 月間カレンダーでの予定表示、作成/編集/削除
- グループ作成、メンバー招待/ロール変更/削除、招待取消、グループ脱退
- グループ設定（名前変更、Discord Webhook URL、連携サーバーID、タスク/予定それぞれのリマインドタイミング）
- 設定したタイミングでタスクの期限・予定の開始をDiscord Webhookへ自動通知（pg_cron + pg_net、Botプロセス不要）
- `/task add`スラッシュコマンドからのタスク作成（Discord HTTP Interactions Endpoint）
- viewerロールの読み取り専用化、`profiles`の閲覧範囲を同一グループ内に限定

### 未実装（今後の候補）

- Discordメッセージからのタスク化、タスクごとのDiscordスレッド自動作成
- 全文検索、活動ログ（誰が何をいつ変更したか）
- カンバン列内でのカード並び替え（現状は列間のステータス変更のみ永続化）
- Google Calendar / Tasks / Docs連携

## ドキュメント

各トピックの詳細版は`docs/`配下にも個別に置いています。

- `docs/USAGE.md` — 使用方法（画面構成、タスク/予定/メンバー管理、スラッシュコマンドなど）
- `docs/ARCHITECTURE.md` — 全体構成と同期方式
- `docs/ROADMAP.md` — 実装済み/未実装機能
- `docs/DEPLOY.md` — デプロイ手順
