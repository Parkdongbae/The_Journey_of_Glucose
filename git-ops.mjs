// git 커밋/푸시 일괄 처리 (1회성)
import { execSync } from "node:child_process";
import fs from "node:fs";

const outer = "C:/Users/dongbae/Desktop/The_Journey_of_Glucose";
const inner = outer + "/3d";
const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" };
const run = (cmd, cwd) => execSync(cmd, { cwd, encoding: "utf8", env }).trim();
const out = [];

out.push("=== OUTER status ===");
out.push(run("git status --short --branch", outer));
out.push("=== OUTER remotes ===");
out.push(run("git remote -v", outer) || "(no remote)");

out.push("=== OUTER commit ===");
out.push(run(`git add WORKLOG.md .gitignore redeploy-pages.ps1 git-status.ps1`, outer));
out.push(run(`git commit -F commit-msg.txt`, outer));

out.push("=== OUTER push ===");
const remotes = run("git remote", outer);
if (remotes) {
  const first = remotes.split(/\r?\n/)[0].trim();
  out.push(run(`git push ${first} main`, outer));
} else {
  out.push("(remote 없음 - 푸시 불가)");
}

out.push("=== INNER status ===");
const innerStatus = run("git status --short --branch", inner);
out.push(innerStatus || "(clean)");
if (innerStatus && !innerStatus.split(/\r?\n/)[0].includes("clean") === false) {
  // dirty면 source 브랜치로 백업 푸시
}
const dirty = innerStatus.replace(/^## [^\n]*/, "").trim().length > 0;
if (dirty) {
  out.push(run(`git add -A`, inner));
  out.push(run(`git commit -m "chore: sync"`, inner));
  out.push(run(`git push origin main:source`, inner));
} else {
  out.push("(inner 변경 없음 - 커밋/푸시 불필요)");
}

fs.writeFileSync(outer + "/git-ops-result.txt", out.join("\n"), "utf8");
console.log(out.join("\n"));
