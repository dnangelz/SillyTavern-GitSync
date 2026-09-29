# Git Sync 交接：最終審查後的修正

分支：`feat/git-sync`。Task 1–8 已完成，每個 Task 都通過審查（共 47 個測試）。整個分支的最終審查結論是「修正後可合併」。本文件列出剩下要修的項目。

測試方式：`npm install && npm test`，需要 Node ≥ 20 與系統的 `git`。

## 必須修正

1. **合併中斷後，下一次同步會把衝突標記推到所有裝置**（`server-plugin/sync.mjs` 的 `prepare` / `commitAll`）
   - 若 process 在 `git merge` 產生衝突之後、`resolveConflicts` 與 commit 完成之前被終止，`.git/MERGE_HEAD` 會殘留。可能原因：Android 砍掉背景程序、SillyTavern 重啟、120 秒 timeout、`merge --abort` 失敗但錯誤被吞掉。
   - 下一次同步時，`git add -A` 會把含有 `<<<<<<<` 標記的檔案 commit 並推送出去，而且回報 `conflicts: []`。
   - 修正：在 `prepare` 的開頭（或 `requireInitialized` 裡）檢查。若 `.git/MERGE_HEAD` 存在，先執行 `git merge --abort`；之後仍然存在的話，拋出清楚的錯誤。
   - 測試：先故意留下一個有衝突、尚未完成的 merge，再呼叫 `push`。確認對話檔不含衝突標記，且衝突會被正確處理（產生副本，或是 abort 後重新同步）。
2. **120 秒的 block timeout 會讓手機第一次同步失敗**（`sync.mjs` 的 `gitFor` 設定，以及 fetch/push 呼叫）
   - simple-git 的 block timeout 只有在 git 有輸出時才會重新計時。stderr 不是 TTY 時，push 和 fetch 不會輸出進度，所以傳輸超過 120 秒就會被中斷。
   - 修正：fetch 和 push 的參數加上 `--progress`。視情況把網路指令的 timeout 調長。遇到 `block timeout reached` 時，轉成友善的中文訊息（在 `index.mjs` 的 `friendlyMessage` 處理）。
3. **同步遮罩可以被使用者關掉**（`index.js` 呼叫 `showActionLoader` 的地方）
   - 預設的 `toastMode: 'stoppable'` 會提供 Stop 按鈕，按下後遮罩消失，但伺服器端的同步還在繼續。
   - 修正：改成 `showActionLoader({ message: 'Git 同步中…', toastMode: 'static' })`。
4. **README 的 Termux 安裝步驟無法執行**
   - Termux 裡沒有 `/tmp`。改用 `~/gitsync`（或 `$TMPDIR/gitsync`）。
5. **README 與 spec 對群組對話的說明有誤**
   - 群組對話是從 `groups/<id>.json` 的 `chats` 陣列列出的，所以衝突副本**不會**出現在群組的對話清單中，需要使用者手動處理。
   - 另外，`groups/<id>.json` 的衝突副本會以重複群組的形式出現。
   - 修正：更新文件說明。角色對話的衝突副本會出現在清單中；群組對話的副本放在 `group chats/`，需要手動處理。

## 建議一併修正（不阻擋合併）

- `server-plugin/config.mjs` 的 `readJson`：檔案內容若是合法 JSON 但不是物件（例如 `null`），會導致 500。非物件時改為回傳 `{}`。
- 新增 add/add 衝突測試：兩台裝置在初始化前都有同名但內容不同的檔案，例如各自的 `settings.json`。
- `syncRoute` 在同步時重新檢查 `git-sync.json` 中的 `repoUrl`：必須是 https、不可含帳號密碼；`branch` 必須符合 `BRANCH_PATTERN`。因為這個檔案會被同步，可能由其他裝置寫入。
- `applyRepoConfig` 加上 `commit.gpgsign=false`；Windows 另外加上 `core.longpaths=true`。
- README 補充說明：
  - 兩台裝置都修改過設定時，`settings.json` 會產生衝突副本。
  - 兩台裝置都用同一張角色卡開新對話時，角色卡 PNG 會產生衝突副本。
  - SillyTavern 的使用者資料備份 zip 會包含 `.git`。

## 待使用者決定

- ~~是否把 `stats.json` 加進 `.gitignore`？~~ **已完成**：使用者同意，已加入 `GITIGNORE_ENTRIES`，並同步更新 spec 與 README。此項不需再處理。

## 需要使用者在本機完成

- 計畫 Task 8 Step 5：在瀏覽器中實際操作驗收，需要一個資料用的私有倉庫與 Token。
- 計畫 Task 8 Step 7：Android（Termux）驗收。
- 本機已經完成的設定：SillyTavern 已執行 `npm install`，`config.yaml` 設為 `enableServerPlugins: true`，並建好兩個 junction（`plugins/git-sync`、`public/scripts/extensions/third-party/SillyTavern-GitSync`）。外掛可以正常載入。

## 已知的小問題（刻意延後）

各 Task 的延後項目：Windows 保留檔名、redact 的替換順序、設定檔不是原子寫入、未使用的 import、`freeCopyPath` 只檢查工作目錄、前端在儲存失敗後會覆蓋使用者輸入的欄位、`BRANCH_PATTERN` 會接受不合法的 ref、`/status` 沒有鎖、`secrets.json` 會累積舊 Token，以及 commit `bdc9c5b` 的 trailer 寫成 Haiku。
