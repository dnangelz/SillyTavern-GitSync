# SillyTavern-GitSync

把 SillyTavern 使用者資料夾（角色卡、對話紀錄、群組、世界書、設定等）手動同步到 Git 私有倉庫，讓電腦與 Android 手機（Termux）共用同一份資料。衝突時會保留雙方版本，不會遺失資料。

不會同步：`secrets.json`（API 金鑰）、`extensions/`、`thumbnails/`、`backups/`、`vectors/`。

## 準備

1. 在 GitHub 建立一個**私有**倉庫，用來存放資料（不是本倉庫）。
2. 建立 Fine-grained Personal Access Token，只授權該倉庫，權限設為 **Contents: Read and write**。

## 安裝

需要系統已安裝 `git`。

1. **前端擴充**：SillyTavern → 擴充功能 → 安裝擴充，貼上 `https://github.com/dnangelz/SillyTavern-GitSync`。
2. **伺服器外掛**：把本倉庫的 `server-plugin/` 資料夾複製到 SillyTavern 的 `plugins/git-sync/`。
3. 編輯 SillyTavern 的 `config.yaml`，設定 `enableServerPlugins: true`，然後重新啟動。

### Android（Termux）

```sh
pkg install git
cd ~/SillyTavern
git clone https://github.com/dnangelz/SillyTavern-GitSync /tmp/gitsync
cp -r /tmp/gitsync/server-plugin plugins/git-sync
sed -i 's/^enableServerPlugins: false/enableServerPlugins: true/' config.yaml
```
前端擴充一樣從 SillyTavern 介面安裝。

## 使用

擴充功能面板 → 「Git 同步」：

1. 填入倉庫 URL、Token（裝置名稱可以自訂），按「儲存設定」。
2. 按「初始化」。第一台裝置會上傳資料；之後的裝置會下載並合併。
3. 換裝置前按「推送」，換過去之後按「拉取」。

第一次同步前，請確認資料倉庫是私有的。Token 只存放在各裝置自己的 `secrets.json`，不會被同步。

兩台裝置都修改了同一個檔案時，會採用雲端版本，本機版本另存為 `檔名 (衝突 裝置名 日期 時間).副檔名`。對話的衝突副本會出現在角色的對話清單中。

## 開發

```sh
npm install
npm test
```
