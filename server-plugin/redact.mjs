const URL_CREDENTIALS = /(https?:\/\/)[^\s/@]+@/gi;

export function redact(text, secrets = []) {
    let output = String(text ?? '');
    for (const secret of secrets) {
        if (!secret) {
            continue;
        }
        output = output.split(secret).join('***');
        const encoded = encodeURIComponent(secret);
        if (encoded !== secret) {
            output = output.split(encoded).join('***');
        }
    }
    return output.replace(URL_CREDENTIALS, '$1***@');
}
