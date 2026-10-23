import { execFile } from "node:child_process";
import { homedir } from "node:os";

// The system's own folder dialog (Finder's on macOS), opened by the runtime:
// it runs on the owner's machine, the only one that can reach the dashboard
// (S1), while a browser page can never learn a folder's path. Every command
// below has fixed arguments; nothing from the request reaches them.

export type Chosen = { path: string } | { cancelled: true } | { unavailable: string };

type Run = (
  command: string,
  args: string[],
) => Promise<{ code: number; stdout: string; missing?: boolean }>;

// The owner may browse for a while, but a dialog left open is given up on.
const waitMs = 10 * 60_000;

const prompt = "Choose the project folder for AMORA";

const runCommand: Run = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: waitMs, windowsHide: false }, (error, stdout) => {
      const code = error ? Number((error as { code?: unknown }).code) || 1 : 0;
      const missing = (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
      resolve({ code, stdout: String(stdout), ...(missing ? { missing } : {}) });
    });
  });

const macOs: [string, string[]] = [
  "osascript",
  [
    "-e",
    "activate",
    "-e",
    `POSIX path of (choose folder with prompt "${prompt}" default location (path to home folder))`,
  ],
];

const windows: [string, string[]] = [
  "powershell",
  [
    "-NoProfile",
    "-STA",
    "-Command",
    `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '${prompt}'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }`,
  ],
];

const linux: [string, string[]][] = [
  ["zenity", ["--file-selection", "--directory", `--title=${prompt}`, `--filename=${homedir()}/`]],
  ["kdialog", ["--getexistingdirectory", homedir(), "--title", prompt]],
];

function commandsFor(platform: NodeJS.Platform): [string, string[]][] {
  if (platform === "darwin") return [macOs];
  if (platform === "win32") return [windows];
  return linux;
}

// A trailing separator is dropped, except the root's own.
const tidy = (path: string) => (path.length > 1 ? path.replace(/[\\/]+$/, "") : path);

let open = false;

export async function chooseFolder(
  platform: NodeJS.Platform = process.platform,
  run: Run = runCommand,
): Promise<Chosen> {
  if (open) return { unavailable: "A folder dialog is already open on this computer." };
  open = true;
  try {
    for (const [command, args] of commandsFor(platform)) {
      const { code, stdout, missing } = await run(command, args);
      if (missing) continue;
      const path = tidy(stdout.trim());
      return code === 0 && path ? { path } : { cancelled: true };
    }
    return { unavailable: "This computer has no folder dialog AMORA can open." };
  } finally {
    open = false;
  }
}
