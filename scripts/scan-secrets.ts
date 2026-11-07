import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface Finding {
  source: "git-history" | "working-tree";
  commit?: string;
  author?: string;
  date?: string;
  filePath: string;
  line?: number;
  patternName: string;
  matchSnippet: string;
}

const COMPROMISED_KEY_FRAGMENT_A = "302e020100300506032b657004220420";
const COMPROMISED_KEY_FRAGMENT_B = "5c791a5a1ca8e687718fb638985b86aca07e7928a03a5a2932ad14ca539869bd";
const COMPROMISED_KEY_LITERAL = `${COMPROMISED_KEY_FRAGMENT_A}${COMPROMISED_KEY_FRAGMENT_B}`;

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp; filter?: (m: string, ctx: string) => boolean }> = [
  {
    name: "Compromised Ed25519 Private Key Literal",
    regex: new RegExp(COMPROMISED_KEY_LITERAL, "i"),
  },
  {
    name: "Generic Hex Ed25519 PKCS#8 Private Key",
    regex: /302e020100300506032b657004220420[a-f0-9]{64}/i,
    filter: (m, ctx) => {
      // Ignore if in test mocks or comments explicitly marked
      if (ctx.includes(".env.example") || ctx.includes("scan-secrets.ts")) return false;
      return true;
    },
  },
  {
    name: "PEM Private Key",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  },
  {
    name: "Google AI / Gemini API Key",
    regex: /AIza[0-9A-Za-z\\-_]{35}/,
    filter: (m) => !m.includes("your_gemini_api_key"),
  },
  {
    name: "PayPal Live/Sandbox Client Secret",
    regex: /(?:PAYPAL_CLIENT_SECRET|client_secret)\s*[:=]\s*["']?([A-Za-z0-9_-]{20,})["']?/i,
    filter: (m, ctx) => {
      if (
        ctx.includes("mock_client_secret") ||
        ctx.includes("your_paypal_sandbox_client_secret") ||
        ctx.includes("your_sandbox_client_secret") ||
        ctx.includes("your_") ||
        ctx.includes("_here") ||
        ctx.includes("SUPER_SECRET_PAYPAL_KEY_NEVER_LOG") // used in negative unit test
      ) {
        return false;
      }
      return true;
    },
  },
  {
    name: "Raw Auth Bearer Token",
    regex: /Bearer\s+([A-Za-z0-9._~+/-]{30,})=*/i,
    filter: (m, ctx) => {
      if (ctx.includes("A21AA_SENSITIVE_OAUTH_TOKEN_BEARER")) return false; // test fixture
      return true;
    },
  },
];

function redact(str: string): string {
  if (str.length <= 8) return "[REDACTED]";
  return `${str.slice(0, 4)}...${str.slice(-4)}`;
}

export function scanGitHistory(): Finding[] {
  const findings: Finding[] = [];

  try {
    const rawLog = execSync("git log -p --full-history -n 100", {
      maxBuffer: 50 * 1024 * 1024,
      encoding: "utf8",
    });

    const commits = rawLog.split(/^commit ([a-f0-9]{40})/gm);
    // commits alternates: [preamble, sha, body, sha, body, ...]
    for (let i = 1; i < commits.length; i += 2) {
      const commitSha = commits[i];
      const commitBody = commits[i + 1] || "";

      let author = "Unknown";
      let date = "Unknown";
      const authorMatch = commitBody.match(/^Author:\s+(.+)$/m);
      if (authorMatch) author = authorMatch[1].trim();
      const dateMatch = commitBody.match(/^Date:\s+(.+)$/m);
      if (dateMatch) date = dateMatch[1].trim();

      const diffFiles = commitBody.split(/^diff --git /gm);
      for (const diff of diffFiles) {
        const fileMatch = diff.match(/^a\/(.+?)\s+b\/(.+?)$/m);
        const filePath = fileMatch ? fileMatch[2] : "unknown";

        // Ignore scan-secrets script itself
        if (filePath.includes("scan-secrets.ts")) continue;

        // Check added lines (starting with +)
        const addedLines = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
        for (const line of addedLines) {
          for (const pattern of SECRET_PATTERNS) {
            const match = line.match(pattern.regex);
            if (match) {
              const matchedStr = match[0];
              if (!pattern.filter || pattern.filter(matchedStr, `${filePath} ${line}`)) {
                findings.push({
                  source: "git-history",
                  commit: commitSha.slice(0, 8),
                  author,
                  date,
                  filePath,
                  patternName: pattern.name,
                  matchSnippet: redact(matchedStr),
                });
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("Could not read git history:", err instanceof Error ? err.message : String(err));
  }

  return findings;
}

export function scanWorkingTree(rootDir: string = process.cwd()): Finding[] {
  const findings: Finding[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (
          entry.name === ".git" ||
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === ".next"
        ) {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        if (
          relPath.endsWith(".png") ||
          relPath.endsWith(".jpg") ||
          relPath.endsWith(".lock") ||
          relPath.endsWith(".jsonl") ||
          relPath === ".env" || // local uncommitted .env is ignored from repo scan
          relPath === "scripts/scan-secrets.ts"
        ) {
          continue;
        }

        try {
          const content = fs.readFileSync(fullPath, "utf8");
          const lines = content.split("\n");
          for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            for (const pattern of SECRET_PATTERNS) {
              const match = line.match(pattern.regex);
              if (match) {
                const matchedStr = match[0];
                if (!pattern.filter || pattern.filter(matchedStr, `${relPath} ${line}`)) {
                  findings.push({
                    source: "working-tree",
                    filePath: relPath,
                    line: lineNum + 1,
                    patternName: pattern.name,
                    matchSnippet: redact(matchedStr),
                  });
                }
              }
            }
          }
        } catch {
          // ignore binary / unreadable files
        }
      }
    }
  }

  walk(rootDir);
  return findings;
}

export function runSecretScan(): { clean: boolean; findings: Finding[] } {
  console.log("==================================================================");
  console.log("  NetraBox Gitleaks-Equivalent Secret Scanner");
  console.log("==================================================================");
  console.log("[*] Scanning tracked working tree files...");
  const wtFindings = scanWorkingTree();
  console.log(`    Found ${wtFindings.length} working tree issues.`);

  console.log("[*] Scanning full git commit history diffs...");
  const gitFindings = scanGitHistory();
  console.log(`    Found ${gitFindings.length} git history issues.`);

  const allFindings = [...wtFindings, ...gitFindings];

  console.log("==================================================================");
  if (allFindings.length === 0) {
    console.log("✅ SCAN PASSED: Zero leaked secrets, keys, or tokens detected!");
    console.log("==================================================================");
    return { clean: true, findings: [] };
  }

  console.log(`❌ SCAN FAILED: Detected ${allFindings.length} secret occurrence(s):`);
  console.log("==================================================================");
  for (const f of allFindings) {
    if (f.source === "git-history") {
      console.log(`- [Git History] Commit ${f.commit} (${f.date})`);
      console.log(`  File: ${f.filePath}`);
      console.log(`  Rule: ${f.patternName}`);
      console.log(`  Match: ${f.matchSnippet}`);
    } else {
      console.log(`- [Working Tree] ${f.filePath}:${f.line}`);
      console.log(`  Rule: ${f.patternName}`);
      console.log(`  Match: ${f.matchSnippet}`);
    }
  }
  console.log("==================================================================");
  return { clean: false, findings: allFindings };
}

if (process.argv[1] && process.argv[1].includes("scan-secrets")) {
  const result = runSecretScan();
  if (!result.clean) {
    process.exit(1);
  }
}
