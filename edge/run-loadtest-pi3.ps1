# Limita o loadtest ao envelope aproximado de um Raspberry Pi 3 B+:
#   - Job memory: 700 MB (apps; OS do host fica de fora)
#   - CPU hard-cap: equivalente a 4 cores do HOST (nao emula IPC do A53)
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File edge/run-loadtest-pi3.ps1
#   powershell -File edge/run-loadtest-pi3.ps1 -Duration 50 -TriggerAfter 25

param(
  [int]$RamMb = 700,
  [int]$CpuCores = 4,
  [int]$Duration = 90,
  [int]$TriggerAfter = 35,
  [ValidateSet("copy", "encode")]
  [string]$Mode = "copy",
  [int]$Cams = 6
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $repo "package.json"))) {
  $repo = Join-Path $PSScriptRoot ".."
}
Set-Location $repo

$hostCores = [Environment]::ProcessorCount
if ($hostCores -lt 1) { $hostCores = 1 }
$cpuRate = [int][Math]::Max(1, [Math]::Min(10000, ($CpuCores / $hostCores) * 10000))
$ramBytes = [long]$RamMb * 1MB

Write-Host "Pi3-constrain: RAM=${RamMb}MB CPU_cores=$CpuCores host_cores=$hostCores cpuRate=$cpuRate/10000 duration=${Duration}s"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class JobLimit {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass,
    IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr hObject);

  [StructLayout(LayoutKind.Sequential)]
  struct IO_COUNTERS {
    public ulong ReadOperationCount;
    public ulong WriteOperationCount;
    public ulong OtherOperationCount;
    public ulong ReadTransferCount;
    public ulong WriteTransferCount;
    public ulong OtherTransferCount;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_CPU_RATE_CONTROL_INFORMATION {
    public uint ControlFlags;
    public uint CpuRate;
  }

  const int JobObjectExtendedLimitInformation = 9;
  const int JobObjectCpuRateControlInformation = 15;
  const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
  const uint JOB_OBJECT_CPU_RATE_CONTROL_ENABLE = 0x1;
  const uint JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP = 0x4;

  public static IntPtr Create(ulong jobMemoryBytes, uint cpuRate) {
    IntPtr hJob = CreateJobObject(IntPtr.Zero, null);
    if (hJob == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());

    var ext = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
    ext.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    ext.JobMemoryLimit = (UIntPtr)jobMemoryBytes;

    int len = Marshal.SizeOf(ext);
    IntPtr pExt = Marshal.AllocHGlobal(len);
    try {
      Marshal.StructureToPtr(ext, pExt, false);
      if (!SetInformationJobObject(hJob, JobObjectExtendedLimitInformation, pExt, (uint)len))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(pExt); }

    var cpu = new JOBOBJECT_CPU_RATE_CONTROL_INFORMATION();
    cpu.ControlFlags = JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP;
    cpu.CpuRate = cpuRate;
    int clen = Marshal.SizeOf(cpu);
    IntPtr pCpu = Marshal.AllocHGlobal(clen);
    try {
      Marshal.StructureToPtr(cpu, pCpu, false);
      if (!SetInformationJobObject(hJob, JobObjectCpuRateControlInformation, pCpu, (uint)clen))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(pCpu); }

    return hJob;
  }

  public static void Assign(IntPtr hJob, IntPtr hProcess) {
    if (!AssignProcessToJobObject(hJob, hProcess))
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }

  public static void Close(IntPtr hJob) { CloseHandle(hJob); }
}
"@

$hJob = [JobLimit]::Create([UInt64]$ramBytes, [UInt32]$cpuRate)

$argList = @(
  "edge/loadtest-6cam.mjs",
  "--pi3",
  "--limit-ram-mb=$RamMb",
  "--limit-cpu-cores=$CpuCores",
  "--duration=$Duration",
  "--trigger-after=$TriggerAfter",
  "--mode=$Mode",
  "--cams=$Cams"
)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "node"
$psi.Arguments = ($argList -join " ")
$psi.WorkingDirectory = $repo
$psi.UseShellExecute = $false
$psi.Environment["LOADTEST_CONSTRAINED"] = "1"

$p = New-Object System.Diagnostics.Process
$p.StartInfo = $psi
[void]$p.Start()
[JobLimit]::Assign($hJob, $p.Handle)

Write-Host "PID=$($p.Id) sob Job Object - aguardando..."
$p.WaitForExit()
$code = $p.ExitCode
[JobLimit]::Close($hJob)
exit $code
