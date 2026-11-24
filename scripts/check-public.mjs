import { readdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];
const excluded = new Set([".git", "node_modules", "dist", ".env", ".env.local", "test-results", "playwright-report", "coverage"]);
const privateParts = ["azure" + "websites.net", "blob.core." + "windows.net", "bodaedith" + "ygus.com", "Account" + "Key=", "DefaultEndpoints" + "Protocol="];
const secrets = [/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /(?:AKIA|ASIA)[A-Z0-9]{16}/, /[?&]sig=[A-Za-z0-9%+/=]{20,}/];
let files = 0;
async function walk(dir) {
  for (const name of await readdir(dir)) {
    if (excluded.has(name)) continue;
    const file = path.join(dir, name);
    const relative = path.relative(root, file);
    const info = await lstat(file);
    if (info.isSymbolicLink()) { errors.push(`Symlink: ${relative}`); continue; }
    if (info.isDirectory()) { await walk(file); continue; }
    files++;
    if (/\.(?:csv|xlsx|pem|key|zip|sql)$/i.test(name) || (/^\.env/.test(name) && name !== ".env.example")) errors.push(`Private or unexpected file: ${relative}`);
    if (/Boda(?:Upload|Game|Admin|Menu)Page|(?:^|\/)src\/imports\/|(?:^|\/)api\/boda\//.test(relative)) errors.push(`Out-of-scope source: ${relative}`);
    if (name.endsWith(".png")) continue;
    const body = await readFile(file, "utf8");
    if (privateParts.some((value) => body.includes(value)) || secrets.some((pattern) => pattern.test(body))) errors.push(`Private endpoint or possible credential: ${relative}`);
  }
}
await walk(root);
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log(`Public export check passed: ${files} files, no private endpoints or detected credentials.`);
