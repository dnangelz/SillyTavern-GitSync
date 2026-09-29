# Git 同步（角色卡與對話紀錄）設計

日期：2026-09-29
對象：SillyTavern 1.19.0

## 目標

讓使用者把自己的 `data/<user>/` 資料夾（角色卡、對話紀錄、群組、世界書、設定等）以**手動**方式同步到一個 Git 私有倉庫，以便在多台裝置之間共用，且衝突時不遺失任何資料。

## 非目標

- 自動 / 定時同步
- Git LFS
- UI 內瀏覽歷史或回滾
- SSH 驗證

## 架構

採「伺服器外掛 + 前端擴充」，不修改 SillyTavern 核心程式碼。

原始碼集中在獨立倉庫 `https://github.com/dnangelz/SillyTavern-GitSync`：

```
SillyTavern-GitSync/
├─ manifest.json, index.js, settings.html, style.css   ← 前端擴充（倉庫根目錄）
├─ server-plugin/                                      ← 伺服器外掛
├─ tests/
├─ docs/specs/
├─ package.json                                        ← 開發與測試用（simple-git、jest）
└─ README.md
```

| 元件 | 倉庫內位置 | 安裝到 SillyTavern 的位置 | 職責 |
|---|---|---|---|
| 前端擴充 | 根目錄 | `public/scripts/extensions/third-party/SillyTavern-GitSync/`（可用 SillyTavern 內建的「安裝擴充」貼上倉庫網址安裝） | 設定面板 UI、呼叫 API、顯示結果 |
| 伺服器外掛 | `server-plugin/` | `plugins/git-sync/`（手動複製） | 執行 Git 操作，提供 REST API |

前置需求：`config.yaml` 中設定 `enableServerPlugins: true`；系統已安裝 `git`。

開發時以目錄連結（Windows junction）把上述兩個位置接到本機的 SillyTavern，修改即時生效。

相依解析規則（安裝方式可以是複製，也可以是 junction，兩者都要能運作）：
- `simple-git`：以一般的 `import` 取得。複製安裝時，Node 會向上找到 SillyTavern 的 `node_modules`；使用 junction 時，Node 會解析到真實路徑，因而使用倉庫自己的 `node_modules`。
- SillyTavern 內部模組（`readSecret` / `writeSecret`）：**不可**用相對路徑 import，因為 junction 會讓相對路徑失效。改用 `process.cwd()` 動態 import：SillyTavern 啟動時會執行 `process.chdir(serverDirectory)`，所以 `process.cwd()` 就是它的根目錄。寫法為 `import(pathToFileURL(path.join(process.cwd(), 'src/endpoints/secrets.js')))`。

### 外掛內部單元（`server-plugin/`）

- `index.mjs`：外掛進入點（`info`、`init(router)`、`exit`），只負責註冊路由。
- `sync.mjs`：純 Git 邏輯，輸入為工作目錄路徑與設定，不依賴 Express，可單獨測試。
  - `init(dir, opts)`、`status(dir)`、`pull(dir, opts)`、`push(dir, opts)`
- `conflicts.mjs`：衝突解決（採用雲端版本、本機版本另存為副本）。
- `redact.mjs`：將字串中的 Token 遮蔽。

## 資料位置

- Git 工作目錄：`data/<user>/`（即 `request.user.directories.root`），每位使用者一個倉庫。
- 外掛設定：`data/<user>/git-sync.json`，內容為 `{ repoUrl, branch }`，會一併同步。
- 裝置名稱：因各裝置不同，存在 `data/<user>/.git/git-sync-device`（不會被同步）。
- Token：用 `src/endpoints/secrets.js` 匯出的 `writeSecret` / `readSecret` 存取，key 為 `git_sync_token`，存於 `secrets.json`。

### `.gitignore`（初始化時寫入，若已存在則只補上缺少的項目）

```
secrets.json
extensions/
thumbnails/
backups/
vectors/
```

## API

所有路由皆位於 `/api/plugins/git-sync/`，方法為 POST，並使用 `request.user.directories`。

| 路由 | 請求內容 | 回應 |
|---|---|---|
| `/config` | `{ repoUrl?, branch?, deviceName?, token? }` | `{ ok }`；`token` 只寫入不回傳 |
| `/status` | — | `{ initialized, repoUrl, branch, deviceName, hasToken, lastSync, pendingChanges }` |
| `/init` | — | `{ ok, conflicts: string[] }` |
| `/pull` | — | `{ ok, conflicts: string[] }` |
| `/push` | — | `{ ok, pushed: boolean, largeFiles: string[] }` |

## 資料流程

驗證方式：執行 fetch/push 時，把 Token 暫時嵌入 URL（`https://x-access-token:<token>@host/...`），直接當作指令參數傳入，**不**寫入 `.git/config`。remote `origin` 只存放不含 Token 的 URL。

### 初始化 `/init`

1. 若 `.git` 不存在，執行 `git init -b <branch>`，寫入 `.gitignore`，設定 `origin`。
2. `git fetch`。
   - 遠端分支不存在（空倉庫）：`add -A` → commit → push。
   - 遠端分支已存在：本機先 commit，再依「拉取」流程合併（使用 `--allow-unrelated-histories`）。

### 推送 `/push`

1. 檢查即將 commit 的檔案中是否有超過 50MB 者。若有，中止並在 `largeFiles` 列出。
2. `git add -A`；若有變更，commit，訊息為 `sync: <deviceName> <ISO 時間>`。
3. 執行「拉取」流程（合併遠端變更）。
4. `git push origin <branch>`。

### 拉取 `/pull`

1. 本機若有變更，先 commit（同上）。
2. `git fetch origin <branch>`。
3. `git merge origin/<branch> --no-edit`。
4. 若發生衝突，交由 `conflicts.mjs` 處理，對每個衝突檔案：
   - 把本機版本（`git show :2:<path>`）另存為 `<檔名> (衝突 <deviceName> <YYYY-MM-DD HHmm>).<副檔名>`，與原檔放在同一個資料夾。
   - 原路徑改用雲端版本（`git checkout --theirs <path>`）。若雲端已刪除該檔，則保留本機版本，不另存副本。
   - `git add` 上述檔案。
5. 完成合併 commit，把衝突檔案清單記錄在回應的 `conflicts`。
6. 在 `.git/git-sync-last` 寫入 `lastSync` 時間。

`.jsonl` 對話的衝突副本會出現在該角色的對話清單中，成為另一段對話，因此不會遺失任何資料。

### 並行控制

- 每個使用者目錄配一把記憶體內的鎖。同一使用者的同步正在進行時，新的請求回應 `409`。
- 同步期間 SillyTavern 仍可能寫檔。風險可以接受，因為使用者是手動觸發；前端在同步期間會顯示遮罩，阻止繼續操作。

## 前端 UI

在擴充功能設定面板新增「Git 同步」抽屜：

- 欄位：倉庫 URL（HTTPS）、分支（預設 `main`）、裝置名稱（預設取主機名稱，由伺服器提供）、Token（密碼欄位，只能寫入；已設定時顯示「已設定」）
- 按鈕：「儲存設定」、「初始化」（尚未初始化時顯示）、「拉取」、「推送」
- 狀態列：上次同步時間、本機未推送的變更數量
- 拉取或初始化完成後：若 `conflicts` 不是空的，用 toastr 列出這些檔案；然後執行 `location.reload()`。
- 推送回傳 `largeFiles` 時：顯示警告並列出這些檔案，建議加入 `.gitignore`。

## 錯誤處理

| 情況 | 處理方式 |
|---|---|
| 尚未設定 Token 或 URL | 回應 400，訊息說明缺少哪一項 |
| 驗證失敗（401/403） | 回應「驗證失敗」，不改動本機任何檔案 |
| 網路錯誤 | 已完成的本機 commit 會保留，回應錯誤；下次推送時一併送出 |
| 合併在衝突處理之外失敗 | 執行 `git merge --abort`，回應錯誤 |
| 推送被拒（遠端又有新的變更） | 自動重做一次「拉取 → 推送」；若仍失敗，回應錯誤 |
| 所有錯誤訊息 | 回傳前端與寫入 console 之前，都先經過 `redact.mjs` 遮蔽 Token |

## 測試

放在本倉庫的 `tests/`，使用本倉庫 `package.json` 安裝的 Jest（`npm test`），直接測試 `sync.mjs` 與 `conflicts.mjs`：

- 在暫存資料夾建立一個 `git init --bare` 作為遠端，另建兩個工作目錄 A、B 模擬兩台裝置（測試時使用本機檔案路徑作為遠端，不需要 Token）。
1. A 初始化並推送，B 初始化後內容與 A 一致。
2. A、B 都修改 `chats/X/c.jsonl`；A 推送，B 推送時自動拉取：B 的原檔變成 A 的版本，另外多出一個衝突副本，內容為 B 原本的版本。
3. `secrets.json`、`extensions/foo/` 不會被 commit。
4. `redact()` 會把 Token 從錯誤字串中移除。
5. 超過 50MB 的檔案會被 `/push` 擋下並列在 `largeFiles` 中（測試時把門檻調小來模擬）。

手動驗收：啟動 SillyTavern，搭配 GitHub 私有倉庫，走完「初始化 → 另一個使用者目錄初始化 → 雙方修改 → 拉取與推送」整個流程，確認衝突副本會出現在對話清單中。
