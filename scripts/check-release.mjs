import { execFileSync } from "node:child_process";

const checks = [
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "test"]],
  ["npm", ["run", "build"]],
  ["npm", ["run", "audit:prod"]]
];

for (const [command, args] of checks) {
  console.log(`\n[check] ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit" });
}

console.log("\n[ok] GateLite release checks passed.");
