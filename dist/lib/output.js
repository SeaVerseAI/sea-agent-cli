export function printJSON(value) {
    console.log(JSON.stringify(value, null, 2));
}
export function printTable(items) {
    if (!Array.isArray(items)) {
        printJSON(items);
        return;
    }
    console.table(items);
}
