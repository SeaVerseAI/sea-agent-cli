export async function withRegisterErrorHint(resource, examplePath, action) {
    try {
        return await action();
    }
    catch (err) {
        if (!(err instanceof Error) || !err.message.startsWith("400:")) {
            throw err;
        }
        if (!isGenericBadRequest(err.message)) {
            throw err;
        }
        throw new Error(`${err.message}\n[hint] Check required fields and value types against ${examplePath}; run seaagent ${resource} register --help for payload notes.`);
    }
}
export function warnProviderNormalized(resource, payload, response) {
    const requestedProvider = stringField(payload, "provider");
    const returnedProvider = findStringField(response, "provider");
    if (!requestedProvider || !returnedProvider || requestedProvider === returnedProvider) {
        return;
    }
    process.stderr.write(`[info] ${resource} provider "${requestedProvider}" normalized to "${returnedProvider}"; use the returned provider value for --provider filters\n`);
}
function findStringField(value, field) {
    if (!value || typeof value !== "object") {
        return "";
    }
    const direct = stringField(value, field);
    if (direct) {
        return direct;
    }
    return findStringField(value.data, field)
        || findStringField(value.response, field);
}
function stringField(value, field) {
    if (!value || typeof value !== "object") {
        return "";
    }
    const fieldValue = value[field];
    return typeof fieldValue === "string" ? fieldValue : "";
}
function isGenericBadRequest(message) {
    const detail = message.replace(/^400:\s*/i, "").trim().toLowerCase();
    return detail === "bad request" || detail === "invalid request" || detail === "invalid argument" || detail === "validation failed";
}
