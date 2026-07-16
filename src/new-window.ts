import { closeMainWindow, showHUD } from "@raycast/api";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
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
      await log("HUD shown");
      return;
    }

    if (process.platform === "win32") {
      await openNewWindowsWindow();
      await log("Windows command dispatched");
      await showHUD("Opening Codex window...");
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
  await log("exec started", { file, args: summarizeArgs(args) });

  const result = await execFileAsync(file, args, { windowsHide: true });
  await log("exec completed", {
    file,
    stdout: result.stdout,
    stderr: result.stderr,
  });

  return result;
}

function summarizeArgs(args: string[]) {
  return args.map((arg) => {
    if (arg.length <= 500) {
      return arg;
    }

    return `${arg.slice(0, 500)}... [truncated ${arg.length - 500} chars]`;
  });
}

function powershellEncodedCommand(value: string) {
  return Buffer.from(value, "utf16le").toString("base64");
}

const macOSAppBundleIdentifier = "com.openai.codex";
const macOSProcessNames = ["ChatGPT", "Codex"] as const;

async function launchMacOSCodex() {
  await log("Codex is not running; dispatching app launch", {
    bundleIdentifier: macOSAppBundleIdentifier,
  });

  // The Codex app is now distributed as ChatGPT.app, but it retains the
  // com.openai.codex bundle identifier. Launching by bundle identifier keeps
  // this working across the old and new display names.
  await execFileLogged("open", ["-b", macOSAppBundleIdentifier]);

  await closeMainWindow({ clearRootSearch: true });
  await log("Codex app launch completed");
}

async function openNewMacOSWindow() {
  const processNames = macOSProcessNames
    .map((processName) => JSON.stringify(processName))
    .join(", ");
  const script = String.raw`
tell application "System Events"
  repeat with processName in {${processNames}}
    if exists process processName then
      tell process processName
        if exists menu item "New Window" of menu "File" of menu bar 1 then
          click menu item "New Window" of menu "File" of menu bar 1
          return "CODEX_STATUS:opened:" & processName
        end if
      end tell
      return "CODEX_STATUS:missing-new-window-item:" & processName
    end if
  end repeat
end tell

return "CODEX_STATUS:not-running"
`;

  const result = await execFileLogged("osascript", ["-e", script]);
  const status = result.stdout.trim();

  if (status === "CODEX_STATUS:not-running") {
    await launchMacOSCodex();
    return;
  }

  if (!status.startsWith("CODEX_STATUS:opened:")) {
    throw new Error(`Unable to invoke Codex New Window menu item: ${status}`);
  }

  await log("macOS New Window menu item invoked", {
    processName: status.slice("CODEX_STATUS:opened:".length),
  });
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

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern uint MapVirtualKey(uint uCode, uint uMapType);

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
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
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

  private static IntPtr KeyboardMessageLParam(ushort virtualKey, bool keyUp) {
    uint scanCode = MapVirtualKey(virtualKey, 0);
    uint lParam = 1 | (scanCode << 16);

    if (keyUp) {
      lParam |= 1u << 30;
      lParam |= 1u << 31;
    }

    return unchecked((IntPtr) (int) lParam);
  }

  private static void PostKey(IntPtr windowHandle, ushort virtualKey, bool keyUp) {
    uint message = keyUp ? WM_KEYUP : WM_KEYDOWN;
    bool posted = PostMessage(
      windowHandle,
      message,
      (IntPtr) virtualKey,
      KeyboardMessageLParam(virtualKey, keyUp)
    );

    if (!posted) {
      throw new InvalidOperationException("PostMessage failed. LastError=" + Marshal.GetLastWin32Error() + ".");
    }
  }

  public static void PostCtrlShiftN(IntPtr windowHandle) {
    PostKey(windowHandle, VK_CONTROL, false);
    PostKey(windowHandle, VK_SHIFT, false);
    PostKey(windowHandle, VK_N, false);
    PostKey(windowHandle, VK_N, true);
    PostKey(windowHandle, VK_SHIFT, true);
    PostKey(windowHandle, VK_CONTROL, true);
  }

  private static T QueryShellService<T>(Guid service, Guid iid) {
    IServiceProvider10 shell = (IServiceProvider10) Activator.CreateInstance(Type.GetTypeFromCLSID(Guids.CLSID_ImmersiveShell));
    return (T) shell.QueryService(ref service, ref iid);
  }

  private static IApplicationView GetApplicationView(IntPtr windowHandle) {
    Guid appViewCollectionGuid = typeof(IApplicationViewCollection).GUID;
    IApplicationViewCollection collection = QueryShellService<IApplicationViewCollection>(appViewCollectionGuid, appViewCollectionGuid);
    IApplicationView view;
    int result = collection.GetViewForHwnd(windowHandle, out view);

    if (result != 0) {
      Marshal.ThrowExceptionForHR(result);
    }

    if (view == null) {
      throw new InvalidOperationException("No application view found for window handle " + windowHandle + ".");
    }

    return view;
  }

  private static IVirtualDesktopManagerInternal22621 GetInternalVirtualDesktopManager22621() {
    return QueryShellService<IVirtualDesktopManagerInternal22621>(
      Guids.CLSID_VirtualDesktopManagerInternal,
      typeof(IVirtualDesktopManagerInternal22621).GUID
    );
  }

  private static IVirtualDesktopManagerInternal26100 GetInternalVirtualDesktopManager26100() {
    return QueryShellService<IVirtualDesktopManagerInternal26100>(
      Guids.CLSID_VirtualDesktopManagerInternal,
      typeof(IVirtualDesktopManagerInternal26100).GUID
    );
  }

  public static Guid GetCurrentDesktopIdInternal(int osBuild) {
    if (osBuild >= 26100) {
      return GetInternalVirtualDesktopManager26100().GetCurrentDesktop().GetId();
    }

    if (osBuild >= 22621) {
      return GetInternalVirtualDesktopManager22621().GetCurrentDesktop().GetId();
    }

    throw new NotSupportedException("Internal virtual desktop operations are only enabled for Windows 11 22H2 and newer.");
  }

  public static void MoveWindowToDesktopInternal(IntPtr windowHandle, Guid desktopId, int osBuild) {
    IApplicationView view = GetApplicationView(windowHandle);

    if (osBuild >= 26100) {
      IVirtualDesktopManagerInternal26100 manager = GetInternalVirtualDesktopManager26100();
      if (!manager.CanViewMoveDesktops(view)) {
        throw new InvalidOperationException("Application view cannot move virtual desktops.");
      }

      manager.MoveViewToDesktop(view, manager.FindDesktop(ref desktopId));
      return;
    }

    if (osBuild >= 22621) {
      IVirtualDesktopManagerInternal22621 manager = GetInternalVirtualDesktopManager22621();
      if (!manager.CanViewMoveDesktops(view)) {
        throw new InvalidOperationException("Application view cannot move virtual desktops.");
      }

      manager.MoveViewToDesktop(view, manager.FindDesktop(ref desktopId));
      return;
    }

    throw new NotSupportedException("Internal virtual desktop operations are only enabled for Windows 11 22H2 and newer.");
  }

  public static void SwitchToDesktopInternal(Guid desktopId, int osBuild) {
    if (osBuild >= 26100) {
      IVirtualDesktopManagerInternal26100 manager = GetInternalVirtualDesktopManager26100();
      manager.SwitchDesktop(manager.FindDesktop(ref desktopId));
      return;
    }

    if (osBuild >= 22621) {
      IVirtualDesktopManagerInternal22621 manager = GetInternalVirtualDesktopManager22621();
      manager.SwitchDesktop(manager.FindDesktop(ref desktopId));
      return;
    }

    throw new NotSupportedException("Internal virtual desktop operations are only enabled for Windows 11 22H2 and newer.");
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

  public static Guid GetWindowDesktopId(IntPtr windowHandle) {
    IVirtualDesktopManager manager = (IVirtualDesktopManager) new CVirtualDesktopManager();
    Guid desktopId;
    int result = manager.GetWindowDesktopId(windowHandle, out desktopId);

    if (result != 0) {
      Marshal.ThrowExceptionForHR(result);
    }

    return desktopId;
  }

  public static void MoveWindowToDesktop(IntPtr windowHandle, Guid desktopId) {
    IVirtualDesktopManager manager = (IVirtualDesktopManager) new CVirtualDesktopManager();
    int result = manager.MoveWindowToDesktop(windowHandle, ref desktopId);

    if (result != 0) {
      Marshal.ThrowExceptionForHR(result);
    }
  }
}

[ComImport, Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a")]
public class CVirtualDesktopManager {}

public static class Guids {
  public static readonly Guid CLSID_ImmersiveShell = new Guid("C2F03A33-21F5-47FA-B4BB-156362A2F239");
  public static readonly Guid CLSID_VirtualDesktopManagerInternal = new Guid("C5E0CDCA-7B6E-41B2-9FC4-D93975CC467B");
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("6D5140C1-7436-11CE-8034-00AA006009FA")]
public interface IServiceProvider10 {
  [return: MarshalAs(UnmanagedType.IUnknown)]
  object QueryService(ref Guid service, ref Guid riid);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIInspectable), Guid("372E1D3B-38D3-42E4-A15B-8AB2B178F513")]
public interface IApplicationView {}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("1841C6D7-4F9D-42C0-AF41-8747538F10E5")]
public interface IApplicationViewCollection {
  int GetViews(out IObjectArray array);
  int GetViewsByZOrder(out IObjectArray array);
  int GetViewsByAppUserModelId([MarshalAs(UnmanagedType.LPWStr)] string id, out IObjectArray array);
  int GetViewForHwnd(IntPtr hwnd, out IApplicationView view);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("92CA9DCD-5622-4BBA-A805-5E9F541BD8C9")]
public interface IObjectArray {}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("3F07F4BE-B107-441A-AF0F-39D82529072C")]
public interface IVirtualDesktop {
  bool IsViewVisible(IApplicationView view);
  Guid GetId();
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("53F5CA0B-158F-4124-900C-057158060B27")]
public interface IVirtualDesktopManagerInternal22621 {
  int GetCount();
  void MoveViewToDesktop(IApplicationView view, IVirtualDesktop desktop);
  bool CanViewMoveDesktops(IApplicationView view);
  IVirtualDesktop GetCurrentDesktop();
  void GetDesktops(out IObjectArray desktops);
  [PreserveSig]
  int GetAdjacentDesktop(IVirtualDesktop from, int direction, out IVirtualDesktop desktop);
  void SwitchDesktop(IVirtualDesktop desktop);
  IVirtualDesktop CreateDesktop();
  void MoveDesktop(IVirtualDesktop desktop, int nIndex);
  void RemoveDesktop(IVirtualDesktop desktop, IVirtualDesktop fallback);
  IVirtualDesktop FindDesktop(ref Guid desktopId);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("53F5CA0B-158F-4124-900C-057158060B27")]
public interface IVirtualDesktopManagerInternal26100 {
  int GetCount();
  void MoveViewToDesktop(IApplicationView view, IVirtualDesktop desktop);
  bool CanViewMoveDesktops(IApplicationView view);
  IVirtualDesktop GetCurrentDesktop();
  void GetDesktops(out IObjectArray desktops);
  [PreserveSig]
  int GetAdjacentDesktop(IVirtualDesktop from, int direction, out IVirtualDesktop desktop);
  void SwitchDesktop(IVirtualDesktop desktop);
  void SwitchDesktopAndMoveForegroundView(IVirtualDesktop desktop);
  IVirtualDesktop CreateDesktop();
  void MoveDesktop(IVirtualDesktop desktop, int nIndex);
  void RemoveDesktop(IVirtualDesktop desktop, IVirtualDesktop fallback);
  IVirtualDesktop FindDesktop(ref Guid desktopId);
}

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

function Get-WindowDesktopIdOrNull([IntPtr] $WindowHandle) {
  try {
    return [NativeMethods]::GetWindowDesktopId($WindowHandle)
  } catch {
    Write-CodexLog ("desktop id lookup failed for handle " + $WindowHandle + ": " + $_.Exception.Message)
    return $null
  }
}

function Get-CurrentDesktopId([IntPtr] $PreferredWindowHandle) {
  $preferredDesktopId = Get-WindowDesktopIdOrNull $PreferredWindowHandle
  if ($null -ne $preferredDesktopId) {
    return $preferredDesktopId
  }

  $script:CurrentDesktopIdCandidate = $null
  [void] [NativeMethods]::EnumWindows({
    param([IntPtr] $windowHandle, [IntPtr] $lParam)

    if ($null -ne $script:CurrentDesktopIdCandidate) {
      return $false
    }

    if (-not [NativeMethods]::IsWindowVisible($windowHandle)) {
      return $true
    }

    if (Test-IsOnCurrentDesktop $windowHandle) {
      $script:CurrentDesktopIdCandidate = Get-WindowDesktopIdOrNull $windowHandle
      if ($null -ne $script:CurrentDesktopIdCandidate) {
        return $false
      }
    }

    return $true
  }, [IntPtr]::Zero)

  if ($null -eq $script:CurrentDesktopIdCandidate) {
    throw 'Unable to determine the current virtual desktop id.'
  }

  return $script:CurrentDesktopIdCandidate
}

function Get-CodexWindows {
  $windows = New-Object System.Collections.ArrayList

  [void] [NativeMethods]::EnumWindows({
    param([IntPtr] $windowHandle, [IntPtr] $lParam)

    if (-not [NativeMethods]::IsWindowVisible($windowHandle)) {
      return $true
    }

    $processId = [uint32] 0
    [void] [NativeMethods]::GetWindowThreadProcessId($windowHandle, [ref] $processId)

    if (-not ($codexProcessIds -contains $processId)) {
      return $true
    }

    $titleBuilder = New-Object System.Text.StringBuilder 512
    $classBuilder = New-Object System.Text.StringBuilder 256
    [void] [NativeMethods]::GetWindowText($windowHandle, $titleBuilder, $titleBuilder.Capacity)
    [void] [NativeMethods]::GetClassName($windowHandle, $classBuilder, $classBuilder.Capacity)

    $title = $titleBuilder.ToString()
    $className = $classBuilder.ToString()
    $looksLikeCodex = $className -eq 'Chrome_WidgetWin_1'

    if ($looksLikeCodex) {
      [void] $windows.Add([pscustomobject] @{
        Handle = $windowHandle
        Title = $title
        ClassName = $className
        ProcessId = $processId
      })
    }

    return $true
  }, [IntPtr]::Zero)

  return @($windows)
}

function Wait-ForNewCodexWindow($BeforeHandles, [int] $Attempts = 80) {
  for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
    Start-Sleep -Milliseconds 50
    $windows = Get-CodexWindows

    foreach ($window in $windows) {
      if (-not $BeforeHandles.ContainsKey($window.Handle.ToInt64())) {
        return $window
      }
    }
  }

  return $null
}

function Move-WindowToDesktopId([IntPtr] $WindowHandle, [Guid] $DesktopId, [string] $Reason) {
  try {
    [NativeMethods]::MoveWindowToDesktopInternal($WindowHandle, $DesktopId, $osBuild)
    Write-CodexLog "$Reason moved with internal virtual desktop API"
    return $true
  } catch {
    Write-CodexLog ("$Reason internal virtual desktop move failed for handle " + $WindowHandle + ": " + $_.Exception.Message)
  }

  try {
    [NativeMethods]::MoveWindowToDesktop($WindowHandle, $DesktopId)
    Write-CodexLog "$Reason moved with public virtual desktop API"
    return $true
  } catch {
    Write-CodexLog ("$Reason public virtual desktop move failed for handle " + $WindowHandle + ": " + $_.Exception.Message)
    return $false
  }
}

$codexProcessIds = @(
  Get-Process -Name Codex -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -ceq 'Codex' } |
    ForEach-Object { [uint32] $_.Id }
)
Write-CodexLog "Codex process ids: $($codexProcessIds -join ', ')"

$osBuild = [int] [System.Environment]::OSVersion.Version.Build
Write-CodexLog "OS build: $osBuild"
$originalForegroundWindow = [NativeMethods]::GetForegroundWindow()
Write-CodexLog "original foreground handle: $originalForegroundWindow"
try {
  $currentDesktopId = [NativeMethods]::GetCurrentDesktopIdInternal($osBuild)
  Write-CodexLog "current desktop id resolved with internal API: $currentDesktopId"
} catch {
  Write-CodexLog ("internal current desktop lookup failed: " + $_.Exception.Message)
  $currentDesktopId = Get-CurrentDesktopId $originalForegroundWindow
}
Write-CodexLog "current desktop id: $currentDesktopId"

$allCodexWindows = Get-CodexWindows
$candidateWindows = @()
foreach ($window in $allCodexWindows) {
  $onCurrentDesktop = Test-IsOnCurrentDesktop $window.Handle
  Write-CodexLog "candidate handle=$($window.Handle) pid=$($window.ProcessId) class=$($window.ClassName) title=$($window.Title) currentDesktop=$onCurrentDesktop"

  if ($onCurrentDesktop) {
    $candidateWindows += $window
  }
}

Write-CodexLog "Codex window count: $($allCodexWindows.Count); current desktop candidate count: $($candidateWindows.Count)"
if ($candidateWindows.Count -gt 0) {
  $target = $candidateWindows[0]
  Write-CodexLog "targeting handle=$($target.Handle) title=$($target.Title)"
  [void] [NativeMethods]::ShowWindow($target.Handle, 9)
  [void] [NativeMethods]::SetForegroundWindow($target.Handle)
  Start-Sleep -Milliseconds 75
  [NativeMethods]::SendCtrlShiftN()
  Write-CodexLog 'sent Ctrl+Shift+N with SendInput'
  Write-Output 'CODEX_RAYCAST_STATUS:opened'
} elseif ($allCodexWindows.Count -gt 0) {
  $beforeHandles = @{}
  foreach ($window in $allCodexWindows) {
    $beforeHandles[$window.Handle.ToInt64()] = $true
  }

  $source = $allCodexWindows[0]
  $sourceDesktopId = Get-WindowDesktopIdOrNull $source.Handle
  $sourceMoved = $false
  $newWindow = $null

  Write-CodexLog "no local Codex window; moving source handle=$($source.Handle) title=$($source.Title) from desktop=$sourceDesktopId to current desktop=$currentDesktopId"
  try {
    if (-not (Move-WindowToDesktopId $source.Handle $currentDesktopId 'source Codex window to current desktop')) {
      throw 'Unable to move an existing Codex window to the current virtual desktop.'
    }

    $sourceMoved = $true
    Start-Sleep -Milliseconds 75
    [void] [NativeMethods]::ShowWindow($source.Handle, 9)
    [void] [NativeMethods]::SetForegroundWindow($source.Handle)
    Start-Sleep -Milliseconds 75
    [NativeMethods]::SendCtrlShiftN()
    Write-CodexLog 'sent Ctrl+Shift+N with SendInput after moving source to current desktop'
    $newWindow = Wait-ForNewCodexWindow $beforeHandles 80

    if ($null -eq $newWindow) {
      Write-CodexLog "SendInput did not create a detectable window; posting Ctrl+Shift+N to moved source handle=$($source.Handle)"
      [NativeMethods]::PostCtrlShiftN($source.Handle)
      $newWindow = Wait-ForNewCodexWindow $beforeHandles 40
    }
  } finally {
    if ($sourceMoved -and $null -ne $sourceDesktopId -and $sourceDesktopId -ne $currentDesktopId) {
      [void] (Move-WindowToDesktopId $source.Handle $sourceDesktopId 'source Codex window back to original desktop')
    }
  }

  if ($null -eq $newWindow) {
    throw 'Codex did not create a detectable new window after moving a source window to the current virtual desktop.'
  }

  $newWindowDesktopId = Get-WindowDesktopIdOrNull $newWindow.Handle
  Write-CodexLog "new Codex window detected handle=$($newWindow.Handle) title=$($newWindow.Title) desktop=$newWindowDesktopId"
  if ($null -eq $newWindowDesktopId -or $newWindowDesktopId -ne $currentDesktopId) {
    Write-CodexLog "new Codex window is not on original desktop; moving handle=$($newWindow.Handle) to desktop=$currentDesktopId"
    if (-not (Move-WindowToDesktopId $newWindow.Handle $currentDesktopId 'new Codex window to original desktop')) {
      throw 'Codex created the new window, but it could not be moved to the original virtual desktop.'
    }
  }

  Start-Sleep -Milliseconds 75

  [void] [NativeMethods]::ShowWindow($newWindow.Handle, 9)
  [void] [NativeMethods]::SetForegroundWindow($newWindow.Handle)
  Write-CodexLog 'activated new Codex window on current desktop'
  Write-Output 'CODEX_RAYCAST_STATUS:opened'
} else {
  if ($codexProcessIds.Count -eq 0) {
    Write-CodexLog 'Codex is not running; launching app'
    Start-Process 'shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App'
    Write-Output 'CODEX_RAYCAST_STATUS:opened'
  } else {
    Write-CodexLog 'Codex is running, but no Codex top-level window was found; launching app'
    Start-Process 'shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App'
    Write-Output 'CODEX_RAYCAST_STATUS:opened'
  }
}
Write-CodexLog 'script completed'
} catch {
  Write-CodexLog "script failed: $($_.Exception.ToString())"
  throw
} finally {
  try {
    Write-CodexLog 'removing helper script'
  } catch {
  }

  if ($PSCommandPath) {
    Remove-Item -LiteralPath $PSCommandPath -ErrorAction SilentlyContinue
  }
}
`;

  const helperScriptFile = join(
    logDirectory,
    `new-window-helper-${process.pid}-${Date.now()}-${randomUUID()}.ps1`,
  );
  await writeFile(helperScriptFile, script, "utf8");
  await log("helper script written", { helperScriptFile });

  const launchScript = String.raw`
$ErrorActionPreference = 'Stop'
try {
  & ${powershellString(helperScriptFile)}
} catch {
  $timestamp = (Get-Date).ToUniversalTime().ToString('o')
  Add-Content -LiteralPath ${powershellLogFile} -Value "[$timestamp] powershell wrapper failed: $($_.Exception.ToString())"
  throw
}
`;

  const launcherScript = String.raw`
$ErrorActionPreference = 'Stop'
$timestamp = (Get-Date).ToUniversalTime().ToString('o')
Add-Content -LiteralPath ${powershellLogFile} -Value "[$timestamp] powershell launcher starting helper: ${helperScriptFile}"
$process = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-EncodedCommand',
  ${powershellString(powershellEncodedCommand(launchScript))}
) -WindowStyle Hidden -PassThru
$timestamp = (Get-Date).ToUniversalTime().ToString('o')
Add-Content -LiteralPath ${powershellLogFile} -Value "[$timestamp] powershell launcher dispatched helper pid=$($process.Id)"
`;

  await execFileLogged("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    powershellEncodedCommand(launcherScript),
  ]);
}
