# Git 同步（角色卡與對話紀錄）設計

日期：2026-09-29
對象：SillyTavern 1.19.0

## 目標

讓使用者把自己的 `data/<user>/` 資料夾（角色卡、對話紀錄、群組、世界書、設定等）以**手動**方式同步到一個 Git 私有倉庫，以便在多台裝置之間共用，且衝突時不遺失任何資料。

主要情境：電腦（Windows）與 Android 手機（在 Termux 中執行 SillyTavern）之間同步。

## 支援平台

| 平台 | 需求 |
|---|---|
| Windows | Git for Windows |
| Linux / macOS | 系統的 `git` |
| Android（Termux） | `pkg install git` |

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
  - `initRepo(dir, opts)`、`status(dir, branch)`、`pull(dir, opts)`、`push(dir, opts)`
- `conflicts.mjs`：衝突解決（採用雲端版本、本機版本另存為副本）。
- `names.mjs`：純函式，包含裝置名稱淨化、衝突副本檔名、大小寫衝突偵測。
- `config.mjs`：讀寫 `git-sync.json` 與 `git-sync.local.json`。
- `redact.mjs`：將字串中的 Token 遮蔽。

## 資料位置

- Git 工作目錄：`data/<user>/`（即 `request.user.directories.root`），每位使用者一個倉庫。
- 外掛設定：`data/<user>/git-sync.json`，內容為 `{ repoUrl, branch }`，會一併同步。
- 各裝置自己的狀態：`data/<user>/git-sync.local.json`，內容為 `{ deviceName, lastSync }`。已列入 `.gitignore`，不會被同步。
- Token：用 `src/endpoints/secrets.js` 匯出的 `writeSecret` / `readSecret` 存取，key 為 `git_sync_token`，存於 `secrets.json`。

### `.gitignore`（初始化時寫入，若已存在則只補上缺少的項目）

```
secrets.json
git-sync.local.json
stats.json
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
| `/init`、`/pull`、`/push` | — | `{ ok, pushed: boolean, updated: boolean, conflicts: string[], largeFiles: string[], caseCollisions: string[] }` |

`updated` 表示這次同步有沒有從雲端拉到新的變更，前端據此決定要不要重新整理頁面。只要 `largeFiles` 或 `caseCollisions` 不是空的，同步就會在任何 commit 之前中止，且 `pushed=false`。

## 資料流程

驗證方式：執行 fetch/push 時，把 Token 暫時嵌入 URL（`https://x-access-token:<token>@host/...`），直接當作指令參數傳入，**不**寫入 `.git/config`。remote `origin` 只存放不含 Token 的 URL。

所有 git 指令都以 `-c credential.helper=` 和環境變數 `GIT_TERMINAL_PROMPT=0` 執行。這樣系統的 credential helper（例如 Windows 的 Git Credential Manager）就不會跳出登入視窗，也不會把 Token 存進系統的認證管理員。

### 初始化 `/init`

1. 若 `.git` 不存在，執行 `git init -b <branch>`，寫入 `.gitignore`，設定 `origin`。接著寫入以下跨平台設定（倉庫層級，每次同步前也會重新套用一次）：
   - `core.autocrlf=false`：各平台保存完全相同的位元組，避免 Windows 把 `.jsonl` 轉成 CRLF，造成每次同步都出現差異。
   - `core.fileMode=false`：忽略 Android 與 Windows 之間的權限位元差異。
   - `core.quotePath=false`：讓 `git status` 等指令的輸出直接顯示中文檔名，方便解析衝突檔案。
   - `user.name=<deviceName>`、`user.email=git-sync@sillytavern.local`：確保在沒有設定 git 身分的全新裝置上也能 commit。
   - `core.ignoreCase` 不修改（Git 官方不建議手動調整）。已知限制：若在 Android 上建立了只有大小寫不同的兩個檔案，Windows 無法同時保存。推送時會偵測這種情況，並列入 `caseCollisions` 警告。
2. `git fetch`。
   - 遠端分支不存在（空倉庫）：`add -A` → commit → push。
   - 遠端分支已存在：本機先 commit，再依「拉取」流程合併（使用 `--allow-unrelated-histories`）。

### 事前檢查（拉取與推送都會執行）

檢查即將 commit 的檔案，發現以下情況時中止：
- 有檔案超過 50MB：列在 `largeFiles`。
- 有路徑只差在大小寫（Windows 無法同時保存）：列在 `caseCollisions`。

### 推送 `/push`

1. 事前檢查。
2. 執行「拉取」流程（先 commit 本機變更，再合併遠端變更）。
3. `git push origin <branch>`。

### 拉取 `/pull`

1. 事前檢查。本機若有變更就 commit，訊息為 `sync: <deviceName> <ISO 時間>`。
2. `git fetch origin <branch>`。
3. `git merge origin/<branch> --no-edit`。
4. 若發生衝突，交由 `conflicts.mjs` 處理，對每個衝突檔案：
   - 把本機版本（`git show :2:<path>`）另存為 `<檔名> (衝突 <deviceName> <YYYY-MM-DD HHmm>).<副檔名>`，與原檔放在同一個資料夾。
   - 原路徑改用雲端版本（`git checkout --theirs <path>`）。若雲端已刪除該檔，則保留本機版本，不另存副本。
   - `git add` 上述檔案。
5. 完成合併 commit，把衝突檔案清單記錄在回應的 `conflicts`。
6. 同步成功後，在 `git-sync.local.json` 寫入 `lastSync` 時間。
7. 若本機已刪除、雲端卻有修改，採用雲端版本（檔案會回來，不會遺失資料）。

`.jsonl` 對話的衝突副本會出現在該角色的對話清單中，成為另一段對話，因此不會遺失任何資料。

### 並行控制

- 每個使用者目錄配一把記憶體內的鎖。同一使用者的同步正在進行時，新的請求回應 `409`。
- 同步期間 SillyTavern 仍可能寫檔。風險可以接受，因為使用者是手動觸發；前端在同步期間會顯示遮罩，阻止繼續操作。

## 前端 UI

在擴充功能設定面板新增「Git 同步」抽屜：

- 欄位：倉庫 URL（HTTPS）、分支（預設 `main`）、裝置名稱（預設取 `os.hostname()`，由伺服器提供；若結果是 `localhost`（Android 上常見），則預設為 `android`。儲存前會移除 `\ / : * ? " < > |` 等字元，確保衝突副本的檔名在 Windows 上也合法）、Token（密碼欄位，只能寫入；已設定時顯示「已設定」）
- 按鈕：「儲存設定」、「初始化」（尚未初始化時顯示）、「拉取」、「推送」
- 狀態列：上次同步時間、本機未推送的變更數量
- 同步完成後：若 `conflicts` 不是空的，先用彈出視窗列出這些檔案，等使用者按下確定；接著若 `updated` 為 true，執行 `location.reload()`。
- 回傳 `largeFiles` 或 `caseCollisions` 時：顯示警告並列出這些檔案，建議加入 `.gitignore` 或重新命名。

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
6. 只差在大小寫的路徑會列入 `caseCollisions`（以純函式測試偵測邏輯，不依賴檔案系統）。
7. 初始化後，倉庫的 `core.autocrlf` 為 `false`。內容為 LF 的 `.jsonl` 在推送、拉取之後位元組不變。
8. 裝置名稱淨化：`a:b/c?` 會轉成不含非法字元的名稱。

手動驗收（使用 GitHub 私有倉庫）：
- Windows 電腦與 Android 手機（Termux）各自初始化，接著雙方都修改，再分別拉取、推送。確認衝突副本會出現在兩邊的對話清單中。
- 在手機上建立檔名含中文的角色卡與對話，同步到 Windows 後確認都能正常開啟。
