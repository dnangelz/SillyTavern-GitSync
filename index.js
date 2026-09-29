import { getRequestHeaders } from '../../../../script.js';
import { showActionLoader } from '../../../action-loader.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import { escapeHtml } from '../../../utils.js';

const API = '/api/plugins/git-sync';
const PLUGIN_MISSING = '找不到 git-sync 伺服器外掛：請確認已放入 plugins/git-sync，且 config.yaml 設定 enableServerPlugins: true 後重新啟動。';

async function call(route, body = {}) {
    const response = await fetch(`${API}/${route}`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(body),
    });
    if (response.status === 404) {
        throw new Error(PLUGIN_MISSING);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
}

function fileList(title, files) {
    return `<p>${escapeHtml(title)}</p><ul>${files.map(file => `<li>${escapeHtml(file)}</li>`).join('')}</ul>`;
}

function renderStatus(s) {
    $('#git_sync_repo_url').val(s.repoUrl);
    $('#git_sync_branch').val(s.branch);
    $('#git_sync_device').val(s.deviceName);
    $('#git_sync_token_state').text(s.hasToken ? '（已設定）' : '（未設定）');
    $('#git_sync_init').toggle(!s.initialized);
    $('#git_sync_pull, #git_sync_push').toggle(Boolean(s.initialized));
    const last = s.lastSync ? new Date(s.lastSync).toLocaleString() : '從未';
    $('#git_sync_status').text(`上次同步：${last}｜未推送的變更：${s.pendingChanges ?? 0}`);
}

async function refresh() {
    try {
        renderStatus(await call('status'));
    } catch (error) {
        $('#git_sync_status').text(error.message);
    }
}

async function runSync(route) {
    const loader = showActionLoader({ message: 'Git 同步中…' });
    let result;
    try {
        result = await call(route);
    } catch (error) {
        toastr.error(error.message, 'Git 同步失敗');
        return;
    } finally {
        await loader.hide();
    }

    if (result.largeFiles.length > 0 || result.caseCollisions.length > 0) {
        let html = '';
        if (result.largeFiles.length > 0) {
            html += fileList('以下檔案超過 50MB，已中止同步。請刪除或加入 .gitignore：', result.largeFiles);
        }
        if (result.caseCollisions.length > 0) {
            html += fileList('以下檔案只差在大小寫，Windows 無法同時保存，已中止同步。請重新命名：', result.caseCollisions);
        }
        await callGenericPopup(html, POPUP_TYPE.TEXT);
        await refresh();
        return;
    }

    if (result.conflicts.length > 0) {
        await callGenericPopup(fileList('以下檔案發生衝突：已採用雲端版本，本機版本另存為「(衝突 …)」副本。', result.conflicts), POPUP_TYPE.TEXT);
    }

    toastr.success('同步完成');
    if (result.updated) {
        location.reload();
        return;
    }
    await refresh();
}

jQuery(async () => {
    const html = await (await fetch(new URL('settings.html', import.meta.url))).text();
    $('#extensions_settings2').append(html);

    $('#git_sync_save').on('click', async () => {
        try {
            await call('config', {
                repoUrl: $('#git_sync_repo_url').val(),
                branch: $('#git_sync_branch').val(),
                deviceName: $('#git_sync_device').val(),
                token: $('#git_sync_token').val(),
            });
            $('#git_sync_token').val('');
            toastr.success('設定已儲存');
        } catch (error) {
            toastr.error(error.message);
        }
        await refresh();
    });
    $('#git_sync_init').on('click', () => runSync('init'));
    $('#git_sync_pull').on('click', () => runSync('pull'));
    $('#git_sync_push').on('click', () => runSync('push'));

    await refresh();
});
