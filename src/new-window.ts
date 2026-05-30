import { showHUD } from "@raycast/api";
import { execFile } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const logDirectory = join(tmpdir(), "raycast-codex-extras");
const logFile = join(logDirectory, "new-window.log");

export default async function main() {
  await log("command started", { platform: process.platform });

  try {
    if (process.platform === "darwin") {
      await openNewMacOSWindow();
      await log("macOS command completed");
      await showHUD("Opened new Codex window");
      return;
    }

    if (process.platform === "win32") {
      const status = await openNewWindowsWindow();
      if (status === "no-local-window") {
        await log("Windows command skipped; no local Codex window");
        await showHUD("No Codex window on this virtual desktop");
        return;
      }

      await log("Windows command completed");
      await showHUD("Opened new Codex window");
      return;
    }

    await log("unsupported platform");
    await showHUD("Codex new window is only supported on macOS and Windows");
  } catch (error) {
    await log("command failed", serializeError(error));
    await showHUD(`Codex command failed. Log: ${logFile}`);
    throw error;
  }
}

async function log(message: string, details?: unknown) {
  await mkdir(logDirectory, { recursive: true });

  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  await appendFile(
    logFile,
    `[${new Date().toISOString()}] ${message}${suffix}\n`,
    "utf8",
  );
}

function serializeError(error: unknown) {
  if (!(error instanceof Error)) {
    return { error };
  }

  const execError = error as Error & {
    code?: unknown;
    signal?: unknown;
    stdout?: unknown;
    stderr?: unknown;
  };

  return {
    name: execError.name,
    message: execError.message,
    stack: execError.stack,
    code: execError.code,
    signal: execError.signal,
    stdout: execError.stdout,
    stderr: execError.stderr,
  };
}

function powershellString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function execFileLogged(file: string, args: string[]) {
  await log("exec started", { file, args });

  const result = await execFileAsync(file, args);
  await log("exec completed", {
    file,
    stdout: result.stdout,
    stderr: result.stderr,
  });

  return result;
}

async function openNewMacOSWindow() {
  const script = String.raw`
tell application "System Events"
  if not (exists process "Codex") then
    return "CODEX_STATUS:not-running"
  end if

  tell process "Codex"
    if exists menu item "New Window" of menu "File" of menu bar 1 then
      click menu item "New Window" of menu "File" of menu bar 1
      return "CODEX_STATUS:opened"
    end if
  end tell
end tell

return "CODEX_STATUS:missing-new-window-item"
`;

  const result = await execFileLogged("osascript", ["-e", script]);
  const status = result.stdout.trim();

  if (status === "CODEX_STATUS:not-running") {
    await execFileLogged("open", ["-a", "Codex"]);
    return;
  }

  if (status !== "CODEX_STATUS:opened") {
    throw new Error(`Unable to invoke Codex New Window menu item: ${status}`);
  }
}

async function openNewWindowsWindow() {
  const powershellLogFile = powershellString(logFile);
  const script = String.raw`
$LogFile = ${powershellLogFile}
function Write-CodexLog([string] $Message) {
  $timestamp = (Get-Date).ToUniversalTime().ToString('o')
  Add-Content -LiteralPath $LogFile -Value "[$timestamp] powershell: $Message"
}

Write-CodexLog 'script started'
$ErrorActionPreference = 'Stop'
try {
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class NativeMethods {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  [DllImport("kernel32.dll")]
  public static extern uint GetLastError();

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)]
    public MOUSEINPUT mi;

    [FieldOffset(0)]
    public KEYBDINPUT ki;

    [FieldOffset(0)]
    public HARDWAREINPUT hi;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct HARDWAREINPUT {
    public uint uMsg;
    public ushort wParamL;
    public ushort wParamH;
  }

  public const uint INPUT_KEYBOARD = 1;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const ushort VK_CONTROL = 0x11;
  public const ushort VK_SHIFT = 0x10;
  public const ushort VK_N = 0x4E;

  private static INPUT KeyDown(ushort virtualKey) {
    return new INPUT {
      type = INPUT_KEYBOARD,
      U = new InputUnion {
        ki = new KEYBDINPUT {
          wVk = virtualKey
        }
      }
    };
  }

  private static INPUT KeyUp(ushort virtualKey) {
    return new INPUT {
      type = INPUT_KEYBOARD,
      U = new InputUnion {
        ki = new KEYBDINPUT {
          wVk = virtualKey,
          dwFlags = KEYEVENTF_KEYUP
        }
      }
    };
  }

  public static void SendCtrlShiftN() {
    INPUT[] inputs = new INPUT[] {
      KeyDown(VK_CONTROL),
      KeyDown(VK_SHIFT),
      KeyDown(VK_N),
      KeyUp(VK_N),
      KeyUp(VK_SHIFT),
      KeyUp(VK_CONTROL)
    };

    uint sent = SendInput((uint) inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != inputs.Length) {
      throw new InvalidOperationException("SendInput failed. Sent " + sent + " of " + inputs.Length + " inputs. LastError=" + Marshal.GetLastWin32Error() + ". InputSize=" + Marshal.SizeOf(typeof(INPUT)) + ".");
    }
  }

  public static bool IsWindowOnCurrentVirtualDesktop(IntPtr windowHandle) {
    IVirtualDesktopManager manager = (IVirtualDesktopManager) new CVirtualDesktopManager();
    bool isCurrent;
    int result = manager.IsWindowOnCurrentVirtualDesktop(windowHandle, out isCurrent);

    if (result != 0) {
      Marshal.ThrowExceptionForHR(result);
    }

    return isCurrent;
  }
}

[ComImport, Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a")]
public class CVirtualDesktopManager {}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b")]
public interface IVirtualDesktopManager {
  int IsWindowOnCurrentVirtualDesktop(IntPtr topLevelWindow, out bool onCurrentDesktop);
  int GetWindowDesktopId(IntPtr topLevelWindow, out Guid desktopId);
  int MoveWindowToDesktop(IntPtr topLevelWindow, ref Guid desktopId);
}
'@
Write-CodexLog 'native methods loaded'

function Test-IsOnCurrentDesktop([IntPtr] $WindowHandle) {
  try {
    return [NativeMethods]::IsWindowOnCurrentVirtualDesktop($WindowHandle)
  } catch {
    Write-CodexLog ("virtual desktop check failed for handle " + $WindowHandle + ": " + $_.Exception.Message)
    return $false
  }
}

$codexProcessIds = @(Get-Process -Name Codex -ErrorAction SilentlyContinue | ForEach-Object { [uint32] $_.Id })
Write-CodexLog "Codex process ids: $($codexProcessIds -join ', ')"
$candidateWindows = New-Object System.Collections.ArrayList

[void] [NativeMethods]::EnumWindows({
  param([IntPtr] $windowHandle, [IntPtr] $lParam)

  if (-not [NativeMethods]::IsWindowVisible($windowHandle)) {
    return $true
  }

  $processId = [uint32] 0
  [void] [NativeMethods]::GetWindowThreadProcessId($windowHandle, [ref] $processId)

  $titleBuilder = New-Object System.Text.StringBuilder 512
  $classBuilder = New-Object System.Text.StringBuilder 256
  [void] [NativeMethods]::GetWindowText($windowHandle, $titleBuilder, $titleBuilder.Capacity)
  [void] [NativeMethods]::GetClassName($windowHandle, $classBuilder, $classBuilder.Capacity)

  $title = $titleBuilder.ToString()
  $className = $classBuilder.ToString()
  $processName = (Get-Process -Id $processId -ErrorAction SilentlyContinue).ProcessName
  $looksLikeCodex = $codexProcessIds -contains $processId -and $processName -eq 'Codex' -and $className -eq 'Chrome_WidgetWin_1'

  if ($looksLikeCodex) {
    $onCurrentDesktop = Test-IsOnCurrentDesktop $windowHandle
    Write-CodexLog "candidate handle=$windowHandle pid=$processId process=$processName class=$className title=$title currentDesktop=$onCurrentDesktop"

    if ($onCurrentDesktop) {
      [void] $candidateWindows.Add([pscustomobject] @{
        Handle = $windowHandle
        Title = $title
        ClassName = $className
        ProcessId = $processId
      })
    }
  }

  return $true
}, [IntPtr]::Zero)

Write-CodexLog "current desktop candidate count: $($candidateWindows.Count)"
if ($candidateWindows.Count -gt 0) {
  $target = $candidateWindows[0]
  Write-CodexLog "targeting handle=$($target.Handle) title=$($target.Title)"
  [void] [NativeMethods]::ShowWindow($target.Handle, 9)
  [void] [NativeMethods]::SetForegroundWindow($target.Handle)
  Start-Sleep -Milliseconds 150
  [NativeMethods]::SendCtrlShiftN()
  Write-CodexLog 'sent Ctrl+Shift+N with SendInput'
  Write-Output 'CODEX_RAYCAST_STATUS:opened'
} else {
  if ($codexProcessIds.Count -eq 0) {
    Write-CodexLog 'Codex is not running; launching app'
    Start-Process 'shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App'
    Write-Output 'CODEX_RAYCAST_STATUS:opened'
  } else {
    Write-CodexLog 'Codex is running, but no Codex window was found on the current virtual desktop; refusing to focus another desktop'
    Write-Output 'CODEX_RAYCAST_STATUS:no-local-window'
  }
}
Write-CodexLog 'script completed'
} catch {
  Write-CodexLog "script failed: $($_.Exception.ToString())"
  throw
}
`;

  const result = await execFileLogged("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);

  return result.stdout.includes("CODEX_RAYCAST_STATUS:no-local-window")
    ? "no-local-window"
    : "opened";
}
