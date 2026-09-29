import path from 'node:path';

const ILLEGAL_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;

export function sanitizeDeviceName(name) {
    const cleaned = String(name ?? '').replace(ILLEGAL_CHARS, '').trim().replace(/[. ]+$/, '');
    return cleaned || 'device';
}

export function defaultDeviceName(hostname) {
    if (!hostname || hostname === 'localhost') {
        return 'android';
    }
    return sanitizeDeviceName(hostname);
}

function pad(value) {
    return String(value).padStart(2, '0');
}

export function formatStamp(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
}

// Git paths always use forward slashes, so use posix helpers.
export function conflictCopyPath(filePath, deviceName, date, n = 1) {
    const dir = path.posix.dirname(filePath);
    const ext = path.posix.extname(filePath);
    const base = path.posix.basename(filePath, ext);
    const counter = n > 1 ? ` ${n}` : '';
    const name = `${base} (衝突 ${deviceName} ${formatStamp(date)}${counter})${ext}`;
    return dir === '.' ? name : `${dir}/${name}`;
}

export function findCaseCollisions(paths) {
    const groups = new Map();
    for (const p of paths) {
        const key = p.toLowerCase();
        if (!groups.has(key)) {
            groups.set(key, new Set());
        }
        groups.get(key).add(p);
    }
    return [...groups.values()].filter(group => group.size > 1).flatMap(group => [...group]).sort();
}
