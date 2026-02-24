import * as vscode from "vscode";

export class DependencyViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "dependencySelected") {
        const files = await this.getFilesUsingDependency(message.dependency);

        if (files.length === 0) {
          vscode.window.showInformationMessage("No files found");
          return;
        }

        const picked = await vscode.window.showQuickPick(files, {
          placeHolder: `Files using ${message.dependency}`,
        });

        if (picked) {
          const doc = await vscode.workspace.openTextDocument(picked);
          vscode.window.showTextDocument(doc);
        }
      }
    });

    // Loading state
    webviewView.webview.html = this.wrapHtml("<p>Loading dependencies...</p>");

    const deps = await this.getDependencies();

    let html = `<h2>Dependency Risk Analyzer</h2>`;

    if (Object.keys(deps).length === 0) {
      html += `<p>No dependencies found</p>`;
      webviewView.webview.html = this.wrapHtml(html);
      return;
    }

    const entries = Object.entries(deps);

    let highCount = 0;
    let mediumCount = 0;
    let lowCount = 0;
    let upToDateCount = 0;

    // fetch usage counts in parallel
    const usageCounts = await Promise.all(
      entries.map(([name]) => this.countDependencyUsage(name)),
    );

    // fetch latest versions in parallel
    const latestVersions = await Promise.all(
      entries.map(([name]) => this.getLatestVersion(name)),
    );
    const processed = entries.map(([name, version], index) => {
      const latest = latestVersions[index];
      const usage = usageCounts[index];

      let riskLabel = "UNKNOWN";
      let riskClass = "neutral";

      if (latest) {
        const risk = this.getRisk(version, latest);

        riskLabel = risk.label;

        if (risk.label === "HIGH RISK") highCount++;
        else if (risk.label === "MEDIUM RISK") mediumCount++;
        else if (risk.label === "LOW RISK") lowCount++;
        else upToDateCount++;

        riskClass =
          risk.label === "HIGH RISK"
            ? "high"
            : risk.label === "MEDIUM RISK"
              ? "medium"
              : risk.label === "LOW RISK"
                ? "low"
                : "neutral";
      }

      return {
        name,
        version,
        latest,
        usage,
        riskLabel,
        riskClass,
      };
    });

    // ---------- HEALTH SCORE CALCULATION ----------

    let penalty = 0;
    let maxPenalty = 0;

    processed.forEach((dep) => {
      const usageWeight = Math.max(dep.usage, 1); // avoid zero

      if (dep.riskLabel === "HIGH RISK") penalty += 3 * usageWeight;
      else if (dep.riskLabel === "MEDIUM RISK") penalty += 2 * usageWeight;
      else if (dep.riskLabel === "LOW RISK") penalty += 1 * usageWeight;

      maxPenalty += 3 * usageWeight;
    });

    const healthScore = Math.round(100 - (penalty / (maxPenalty || 1)) * 100);

    let healthColor = "green";
    if (healthScore < 50) healthColor = "red";
    else if (healthScore < 75) healthColor = "orange";

    // card container
    html += `<div class="grid">`;

    html += `
  <div class="summary">

    <div class="summary-title">Project Health</div>

    <div class="health-container">
    <div class="health-header">
      Score: ${healthScore}/100
    </div>

    <div class="health-bar">
      <div class="health-fill ${healthColor}"
           style="width:${healthScore}%">
      </div>
    </div>
  </div>

    <div class="summary-row">
      <span class="summary-pill total"  onclick="filterRisk('ALL')" >
        ${entries.length} total
      </span>

      <span class="summary-pill high" onclick="filterRisk('HIGH RISK')">
        ${highCount} high
      </span>

      <span class="summary-pill medium" onclick="filterRisk('MEDIUM RISK')">
        ${mediumCount} medium
      </span>

      <span class="summary-pill low" onclick="filterRisk('LOW RISK')">
        ${lowCount} low
      </span>

      <span class="summary-pill neutral" onclick="filterRisk('UP TO DATE')">
        ${upToDateCount} up to date
      </span>
    </div>

  </div>
`;

    entries.forEach(([name, version], index) => {
      const latest = latestVersions[index];
      const usage = usageCounts[index];

      let riskLabel = "UNKNOWN";
      let riskClass = "neutral";

      if (latest) {
        const risk = this.getRisk(version, latest);

        riskLabel = risk.label;
        if (risk.label === "HIGH RISK") highCount++;
        else if (risk.label === "MEDIUM RISK") mediumCount++;
        else if (risk.label === "LOW RISK") lowCount++;
        else upToDateCount++;

        riskClass =
          risk.label === "HIGH RISK"
            ? "high"
            : risk.label === "MEDIUM RISK"
              ? "medium"
              : risk.label === "LOW RISK"
                ? "low"
                : "neutral";
      }

      html += `
      <div class="card" data-risk="${riskLabel}" onclick="selectDependency('${name}')">

        <div class="name">${name}</div>
        <div class="meta">version ${version}</div>

        <div class="row">
          <span class="badge ${riskClass}">
            ${riskLabel}
          </span>

          <span class="meta">
            latest ${latest ?? "unknown"}
          </span>
        </div>

        <div class="usage">
          used in ${usage} file(s)
        </div>

      </div>
    `;
    });

    html += `</div>`;

    webviewView.webview.html = this.wrapHtml(html);
  }

  private wrapHtml(content: string) {
    return `
  <html>
  <head>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;
        background: #0d1117;
        color: #e6edf3;
        margin: 0;
        padding: 16px;
      }

      h2 {
        margin-top: 0;
        margin-bottom: 16px;
        font-size: 20px;
        font-weight: 600;
      }

      .grid {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .card {
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 8px;
        padding: 12px 14px;
      }

      .name {
        font-size: 15px;
        font-weight: 600;
        margin-bottom: 4px;
      }

      .meta {
        font-size: 12px;
        color: #8b949e;
        margin-bottom: 6px;
      }

      .row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .badge {
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
      }
        .summary {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 14px;
}

.summary-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}

.summary-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.summary-pill {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: 0.2s;
}
  .summary-pill:hover {
  transform: translateY(-1px);
  opacity: 0.9;
}

.health-container {
  margin-bottom: 12px;
}

.health-header {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}

.health-bar {
  width: 100%;
  height: 10px;
  background: #30363d;
  border-radius: 999px;
  overflow: hidden;
}

.health-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.4s ease;
}

.health-fill.green { background: #22c55e; }
.health-fill.orange { background: #f59e0b; }
.health-fill.red { background: #ef4444; }

.total { background:#6b728022; color:#9ca3af; }

      .high { background:#ff4d4f22; color:#ff6b6b; }
      .medium { background:#ffa50022; color:#ffb347; }
      .low { background:#00c85322; color:#4ade80; }
      .neutral { background:#6b728022; color:#9ca3af; }

      .usage {
        font-size: 12px;
        color: #9ca3af;
      }

    </style>
  </head>

  <body>
    ${content}
    <script>
    const vscode = acquireVsCodeApi();

    function selectDependency(name) {
      vscode.postMessage({
        type: "dependencySelected",
        dependency: name
      });
    }
      function filterRisk(level) {

  const cards = document.querySelectorAll(".card");

  cards.forEach(card => {

    if (level === "ALL") {
      card.style.display = "block";
      return;
    }

    const risk = card.dataset.risk;

    if (risk === level) {
      card.style.display = "block";
    } else {
      card.style.display = "none";
    }

  });
}
  </script>
  </body>
  </html>
  `;
  }

  private async getDependencies(): Promise<Record<string, string>> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return {};

    const packageUri = vscode.Uri.joinPath(folders[0].uri, "package.json");

    try {
      const data = await vscode.workspace.fs.readFile(packageUri);
      const json = JSON.parse(data.toString());

      return {
        ...json.dependencies,
        ...json.devDependencies,
      };
    } catch {
      return {};
    }
  }
  private async getLatestVersion(pkg: string): Promise<string | null> {
    try {
      const res = await fetch(`https://registry.npmjs.org/${pkg}`);
      const data = await res.json();
      return data["dist-tags"].latest;
    } catch {
      return null;
    }
  }
  private parseVersion(v: string): number[] {
    return v
      .replace(/[^0-9.]/g, "") // remove ^ ~ etc
      .split(".")
      .map((n) => parseInt(n || "0"));
  }
  private getRisk(current: string, latest: string) {
    const [cMajor, cMinor, cPatch] = this.parseVersion(current);
    const [lMajor, lMinor, lPatch] = this.parseVersion(latest);

    if (lMajor > cMajor) {
      return { label: "HIGH RISK", color: "red" };
    }

    if (lMinor > cMinor) {
      return { label: "MEDIUM RISK", color: "orange" };
    }

    if (lPatch > cPatch) {
      return { label: "LOW RISK", color: "green" };
    }

    return { label: "UP TO DATE", color: "gray" };
  }
  private async countDependencyUsage(pkg: string): Promise<number> {
    const files = await vscode.workspace.findFiles(
      "**/*.{js,ts,jsx,tsx}",
      "**/node_modules/**",
    );

    let count = 0;

    const importRegex = new RegExp(
      `(from\\s+['"]${pkg}['"]|require\\(['"]${pkg}['"]\\))`,
    );

    for (const file of files) {
      const doc = await vscode.workspace.openTextDocument(file);
      const text = doc.getText();

      if (importRegex.test(text)) {
        count++;
      }
    }

    return count;
  }
  private async getFilesUsingDependency(pkg: string): Promise<string[]> {
    const files = await vscode.workspace.findFiles(
      "**/*.{js,ts,jsx,tsx}",
      "**/node_modules/**",
    );

    const result: string[] = [];

    const importRegex = new RegExp(
      `(from\\s+['"]${pkg}['"]|require\\(['"]${pkg}['"]\\))`,
    );

    for (const file of files) {
      const doc = await vscode.workspace.openTextDocument(file);
      const text = doc.getText();

      if (importRegex.test(text)) {
        result.push(file.fsPath);
      }
    }

    return result;
  }
}
