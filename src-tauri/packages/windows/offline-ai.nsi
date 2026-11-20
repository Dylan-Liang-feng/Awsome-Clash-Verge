Unicode true
!include MUI2.nsh
!include LogicLib.nsh
!include x64.nsh
Name "Clash Verge AI"
OutFile "${OUTPUT}"
InstallDir "$PROGRAMFILES64\Clash Verge AI"
RequestExecutionLevel admin
SetCompressor /FINAL lzma
ShowInstDetails show
ShowUninstDetails show
!define KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClashVergeAI"
!define WEBVIEW "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
VIProductVersion "0.1.1.0"
VIAddVersionKey "ProductName" "Clash Verge AI"
VIAddVersionKey "FileDescription" "Clash Verge AI offline setup"
VIAddVersionKey "FileVersion" "0.1.1"
VIAddVersionKey "LegalCopyright" "Clash Verge AI contributors and upstream authors"
!define MUI_ICON "..\..\icons\icon.ico"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchClient
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Function LaunchClient
  Exec '"$WINDIR\explorer.exe" "$SMPROGRAMS\Clash Verge AI.lnk"'
FunctionEnd

!macro Preflight
  ${IfNot} ${RunningX64}
    Abort "Windows x64 required."
  ${EndIf}
  SetRegView 64
  SetShellVarContext all
  ; Never let /D redirect an elevated installation into a portable or upstream directory.
  StrCpy $INSTDIR "$PROGRAMFILES64\Clash Verge AI"
  InitPluginsDir
  File /oname=$PLUGINSDIR\check-install.ps1 "check-ai-install.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\check-install.ps1"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "请先从托盘退出 Clash Verge。若系统服务仍指向 AI 安装目录，请先在客户端设置中卸载该服务，再重试。$\r$\n$1" /SD IDOK
    Abort
  ${EndIf}
!macroend

Function .onInit
  !insertmacro Preflight
FunctionEnd
Function un.onInit
  !insertmacro Preflight
FunctionEnd

Function HasWebView
  SetRegView 32
  ReadRegStr $0 HKLM "${WEBVIEW}" "pv"
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ReadRegStr $0 HKCU "${WEBVIEW}" "pv"
  ${EndIf}
  SetRegView 64
  ${If} $0 == "0.0.0.0"
    StrCpy $0 ""
  ${EndIf}
FunctionEnd

Section "Clash Verge AI"
  Call HasWebView
  ${If} $0 == ""
    DetailPrint "Installing Microsoft Edge WebView2 Runtime (offline)..."
    SetCompress off
    File /oname=$PLUGINSDIR\MicrosoftEdgeWebView2RuntimeInstallerX64.exe "${PAYLOAD}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
    SetCompress auto
    ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" /silent /install' $1
    Call HasWebView
    ${If} $0 == ""
      MessageBox MB_ICONSTOP|MB_OK "WebView2 安装失败，请重新运行安装程序。Exit code: $1" /SD IDOK
      Abort
    ${EndIf}
  ${EndIf}
  !include "${FILELIST}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Clash Verge AI.lnk" "$INSTDIR\clash-verge.exe"
  CreateShortcut "$DESKTOP\Clash Verge AI.lnk" "$INSTDIR\clash-verge.exe"
  WriteRegStr HKLM "${KEY}" "DisplayName" "Clash Verge AI"
  WriteRegStr HKLM "${KEY}" "DisplayVersion" "0.1.1"
  WriteRegStr HKLM "${KEY}" "Publisher" "Dylan-Liang-feng"
  WriteRegStr HKLM "${KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${KEY}" "DisplayIcon" "$INSTDIR\clash-verge.exe"
  WriteRegStr HKLM "${KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd

Section "Uninstall"
  !include "${DELETELIST}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR\resources"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\Clash Verge AI.lnk"
  Delete "$SMPROGRAMS\Clash Verge AI.lnk"
  DeleteRegKey HKLM "${KEY}"
SectionEnd
