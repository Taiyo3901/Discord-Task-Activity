.# デプロイ手順

すべて無料枠で完結します（Discord Developer Portal / Supabase Free / Vercel Hobby）。持続稼働するBotプロセスは使いません。

## 0. 全体構成

```
Discordクライアント(ボイスチャンネル埋め込み)
  → Vercel(React SPA, 無料)
      → "/supabase" 経由でSupabase(無料プロジェクト)を呼ぶ
          - Postgres + RLS
          - Edge Functions (discord-token-exchange, discord-interactions)
          - pg_cron + pg_net (期限リマインドをDiscord Webhookへ直接POST)
```

## 1. Discord Developer Portal

1. https://discord.com/developers/applications で新規Application作成。
2. 左メニュー「Activities」を有効化。
3. 「OAuth2」→ Client IDを控える（`VITE_DISCORD_CLIENT_ID` / `DISCORD_CLIENT_ID`）。「Reset Secret」でClient Secretを発行し控える（`DISCORD_CLIENT_SECRET`、フロントエンドには絶対に置かない）。
4. 「General Information」の下部にある「Public Key」を控える（`DISCORD_PUBLIC_KEY`、スラッシュコマンド検証用）。
5. 「Activities」→「URL Mappings」で以下を設定する。
   - 最初から1行（Prefix=`/`のルートマッピング)がある。**この行のPrefixは`/`固定で編集できない**。Targetだけを埋める（後述のVercelのデプロイドメイン）。ここが空だとDiscordクライアントはActivity本体をどこから読み込むか分からず起動できない。
   - `/supabase`用の行は自動では出てこないので、「Add Mapping」ボタンを押して新しい行を追加してから、その行のPrefixに`/supabase`、Targetに`<project-ref>.supabase.co`を入力する。
   - Discordはprefixを上から順にマッチさせるため、`/supabase`の行は`/`の行より**上**に来るようにする（`/`が上にあると他の行が効かなくなる）。
   - 最終的に以下の並びになる。

   | Prefix | Target |
   | --- | --- |
   | `/supabase` | `<project-ref>.supabase.co` |
   | `/` | Vercelのデプロイドメイン |

   なお、DiscordのURL Mappings UIは変更されることがあるため、上記と画面表示が異なる場合はスクリーンショットを共有してもらえれば個別に確認します。
6. 「Interactions Endpoint URL」に、後述のEdge Function `discord-interactions` のURLを設定（Discordが即座にPINGを送るので、先にEdge Functionをデプロイしてから設定する）。
7. スラッシュコマンドを登録する場合は、Discord公式のREST APIか`discord.js`等で `/task add` コマンド（`title`必須文字列オプション、`due`任意文字列オプション、`project`任意文字列オプション＝チームに複数プロジェクトがある場合の追加先指定）をアプリケーションコマンドとして一度登録してください（登録はローカルから一度実行すればよく、常駐プロセスは不要です）。チーム構造への移行に伴い`project`オプションを追加した場合は、既存のコマンド定義をこの内容で再登録（PATCH/PUT）してください。

## 2. Supabase

無料プロジェクトを1つ作成し、プロジェクトルートで以下を実行します（`supabase`はdevDependenciesに追加済みなので`npx supabase`で使えます）。

```cmd
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

`supabase/migrations/001_init.sql`・`002_redesign.sql`・`003_reminders_and_details.sql`・`004_calendar_fix_and_item_reminders.sql`が適用されます。`002_redesign.sql`はpg_cron/pg_netの有効化とcronジョブ登録も含みますが、プロジェクトによっては先にDashboardの `Database > Extensions` でpg_cron / pg_netを手動でONにする必要がある場合があります。失敗した場合はDashboardでONにしてから、SQL Editorで次の2行だけ再実行してください。

```sql
select cron.unschedule(jobid) from cron.job where jobname = 'notify-due-tasks';
select cron.schedule('notify-due-tasks', '*/30 * * * *', $$select public.notify_due_tasks()$$);
```

Edge Functionsをデプロイします。

```cmd
npx supabase functions deploy discord-token-exchange
npx supabase functions deploy discord-interactions
```

Functionのシークレットを設定します（`SUPABASE_URL`と`SUPABASE_SERVICE_ROLE_KEY`はSupabaseが自動注入するため設定不要です）。

```cmd
npx supabase secrets set DISCORD_CLIENT_ID=xxxx
npx supabase secrets set DISCORD_CLIENT_SECRET=xxxx
npx supabase secrets set DISCORD_PUBLIC_KEY=xxxx
npx supabase secrets set APP_JWT_SECRET=xxxx
```

`SUPABASE_`で始まる名前はSupabase Edge Runtimeの予約プレフィックス（`SUPABASE_URL`等の自動注入用）のため、`npx supabase secrets set`では設定できません（`Env name cannot start with SUPABASE_, skipping`というエラーになります）。そのため上記のとおり`APP_JWT_SECRET`という名前でシークレットを設定してください。値自体はDashboard → Project Settings → API → 「JWT Secret」（レガシー、非対称鍵に切り替え済みの場合は表示名が異なることがあります）からコピーします。

> **既知の制約**: このアプリはSupabaseのレガシーJWTシークレット(HS256)で自前JWTを署名し、`auth.uid()`を成立させています。Supabaseは将来的に非対称鍵ベースの「Third-Party Auth」への移行を推奨していますが、現時点ではレガシーシークレットが有効な限りこの方式は動作します。Dashboardでレガシーシークレットが見当たらない場合はSupabaseサポート/ドキュメントで最新の移行状況を確認してください。

StorageバケットとRLSは`001_init.sql`/`002_redesign.sql`の適用で自動的に作成されます。

## 3. Vercel

1. https://vercel.com/signup を開き、「Continue with GitHub」でサインアップ（GitHubアカウントで連携するとリポジトリ選択がスムーズ）。
2. ダッシュボード右上「Add New...」→「Project」→「Import Git Repository」の一覧からこのリポジトリを選び「Import」（一覧に出ない場合は「Adjust GitHub App Permissions」でVercelにアクセスを許可する）。
3. Configure Project画面はほとんど自動検出されるので基本そのままでよい。念のため確認する項目:

   | 項目 | 値 |
   | --- | --- |
   | Framework Preset | `Vite`（自動検出） |
   | Root Directory | `./`（変更不要） |
   | Build Command | `npm run build`（自動検出） |
   | Output Directory | `dist`（自動検出） |
   | Install Command | `npm install`（自動検出） |

4. 同じ画面の「Environment Variables」で以下を1つずつKey/Valueで追加する（対象環境はProduction/Preview/Development全部チェックのままでよい）。**ここを忘れるとビルドは通っても起動時にエラーになるので注意。**

   | Key | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | Supabase Dashboardの anon/public key |
   | `VITE_DISCORD_CLIENT_ID` | DiscordのClient ID |

5. 「Deploy」を押す（Hobbyプラン、無料）。ビルドログが表示され、1〜2分で完了すると発行されたドメイン（例: `discord-task-activity.vercel.app`）が表示される。
6. 発行されたドメイン（`https://`を除いたホスト名部分だけ）を、手順1-5の「URL Mappings」の `/` ターゲットに設定する。
7. 以後の更新: GitHubの`main`にpushすると自動で再デプロイされる。環境変数を後から変更した場合は自動反映されないため、Settings → Environment Variables で編集後、Deploymentsタブから「Redeploy」を手動実行する。

## 4. 動作確認

- ブラウザで直接VercelのURLを開くと、通常のSupabase Discord OAuthログイン画面が出ます（Discord Activity外でのフォールバック、開発確認用）。この場合、Supabase Dashboard の Authentication → Providers → Discord で Client ID/Secret を別途設定しておく必要があります。
- Discordデスクトップアプリでボイスチャンネルに入り、Activity一覧からこのアプリを起動すると、自動的にDiscordアカウントでログインされ、ボードが表示されます。
- 複数アカウントで同じタスクを同時に開き、プレゼンス表示・自動保存・競合検知が動くことを確認してください。
- チーム設定でDiscord Webhook URLを登録し、期限を今日の日付にしたタスクを作成後、最大30分待つ（またはSQL Editorで`select public.notify_due_tasks();`を手動実行）とDiscordチャンネルに通知が届きます。
- Discordサーバーの任意チャンネルで `/task add title:テスト` を実行し、該当チームのプロジェクトにタスクが追加されることを確認してください（チーム設定でサーバーIDを連携し、実行者がTask Activityでログイン済みである必要があります。チームに複数プロジェクトがある場合は `project:` オプションで対象を指定します）。

## 付録: 各値の取得方法まとめ

デプロイ手順中に出てくる値を、どこで取得/発行するかまとめます。

### Discord Developer Portal (https://discord.com/developers/applications)

対象のApplicationを開いた状態が前提です。

| 値 | 取得場所 |
| --- | --- |
| `VITE_DISCORD_CLIENT_ID` / `DISCORD_CLIENT_ID` | トップ「General Information」ページの「APPLICATION ID」、または左メニュー「OAuth2」→ Generalの「CLIENT ID」（同じ値） |
| `DISCORD_CLIENT_SECRET` | 左メニュー「OAuth2」→ Generalの「CLIENT SECRET」欄。初回は隠れているので「Reset Secret」を押すと表示される。**表示されるのはこの瞬間だけ**なのですぐコピーして控える（再表示するには再度Resetが必要で、古いSecretは無効になる） |
| `DISCORD_PUBLIC_KEY` | トップ「General Information」ページ下部の「Public Key」欄（Resetボタン不要、常時表示） |
| Guild ID（チーム設定の「連携するサーバーID」） | Discordアプリ本体で 設定 → 詳細設定 →「開発者モード」をON → 対象サーバーのアイコンを右クリック →「サーバーIDをコピー」 |
| Discord Webhook URL（チーム設定の通知先） | Discordアプリで対象チャンネルの歯車アイコン →「連携サービス」→「ウェブフック」→「新しいウェブフックを作成」→「ウェブフックURLをコピー」 |
| 招待相手のDiscord User ID | 開発者モードON後、相手のユーザー名を右クリック →「ユーザーIDをコピー」（自分のIDはアプリの「アカウント」画面にも表示されます） |

### Supabase (https://supabase.com/dashboard)

まだプロジェクトが無ければ「New Project」→ Organization選択 → プロジェクト名/データベースパスワード/リージョンを入力 → Create（Freeプランでよい）。作成後、対象プロジェクトを開いて以下を集めます。

| 値 | 取得場所 |
| --- | --- |
| `<project-ref>` | プロジェクトを開いているときのブラウザURL `https://supabase.com/dashboard/project/xxxxxxxxxxxxx` の `xxxxxxxxxxxxx` 部分。または Project Settings(左下の歯車) → General →「Reference ID」 |
| `VITE_SUPABASE_URL` | Project Settings →「API」(または「Data API」)セクションの「Project URL」（`https://<project-ref>.supabase.co`の形。project-refと同じ情報） |
| `VITE_SUPABASE_ANON_KEY` | 同じAPIページの「Project API keys」欄、`anon` `public` ラベルの値（プロジェクトによっては「publishable key」という名称のことがあります。どちらもフロントエンドに公開してよい鍵です） |
| `APP_JWT_SECRET`（Supabase側の値の出所は「JWT Secret」） | Project Settings → API →「JWT Settings」セクションの「JWT Secret」（Reveal/Copyボタンあり）。この項目が無く「JWT Signing Keys」（非対称鍵）の画面しか無い場合は既知の制約の節を参照してください |
| `SUPABASE_SERVICE_ROLE_KEY` | 同じ「Project API keys」欄の `service_role` `secret` ラベルの値。Edge Functionsには自動で渡されるため通常は自分でコピーする必要はありません |
| Discord OAuthプロバイダー設定（ブラウザフォールバックのログインに必要） | 左メニュー「Authentication」→「Providers」→ 一覧から「Discord」→ Enableをオン → Client ID/Client Secretに、Discord Developer Portalで取得した同じ値を入力 → Save。この画面に出る「Callback URL (for OAuth)」（`https://<project-ref>.supabase.co/auth/v1/callback`）を、Discord Developer Portal側の「OAuth2」→「Redirects」に追加登録しておく |
| Redirect URLs設定（**これを忘れるとDiscord認証後にアプリ画面へ戻れない**） | 左メニュー「Authentication」→「URL Configuration」を開き、「Site URL」にVercelの本番ドメイン（例: `https://discord-task-activity-starter.vercel.app`）を設定。「Redirect URLs」にも同じURL（末尾`/**`推奨、例: `https://discord-task-activity-starter.vercel.app/**`）を追加登録する。ここに登録の無いURLへは`signInWithOAuth`の`redirectTo`が機能せず、認証後にデフォルトのSite URLへ飛ばされて画面に入れなくなる。VercelのプレビューデプロイURL（ハッシュ付きの一時URL）でテストする場合は、そのURLも個別に追加するか、開発中のみ`https://*.vercel.app/**`のようなワイルドカードを追加する |

### Vercel (https://vercel.com/dashboard)

| 値 | 取得場所 |
| --- | --- |
| デプロイドメイン | プロジェクトをDeployした後、プロジェクト画面上部に表示される（例: `discord-task-activity.vercel.app`）。後から確認する場合はプロジェクトの「Domains」タブ |

## ローカル開発

```cmd
npm install
npm run dev
```

`.env`に`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_DISCORD_CLIENT_ID`を設定してください（`.env.example`参照）。`npm run dev`はDiscord Activity外のブラウザとして起動するため、上記「ブラウザで直接開く」フォールバック経路が使われます。
