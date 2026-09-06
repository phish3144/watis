; Custom NSIS fragments for WatIs? (PLAN.md Phase 9, "Deinstallation per-user sauber").
;
; NOTHING HERE MAY ELEVATE. The installer is per-user by three independent mechanisms
; (perMachine:false, oneClick:true, packElevateHelper:false) and this file must not become the
; fourth way around them: no RequestExecutionLevel, no UAC plugin, no ExecShell "runas",
; no HKLM. scripts/verify-no-elevate.mjs checks that.

!macro customUnInstall
  ; The program folder goes; the archive is the user's own history and can be twenty gigabytes of
  ; it. deleteAppDataOnUninstall is false, so nothing under %LOCALAPPDATA%\watis is touched unless
  ; the answer below is yes.
  ;
  ; Asked, not assumed, and defaulting to "keep": somebody uninstalling to reinstall would
  ; otherwise lose years of messages to a question they clicked past.
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "Sollen auch das Archiv, die Mediendateien und die Anmeldung gelöscht werden?$\r$\n$\r$\n\
Nein behält alles unter:$\r$\n$LOCALAPPDATA\watis$\r$\n$\r$\n\
Nein ist die richtige Antwort, wenn WatIs? neu installiert werden soll." \
      /SD IDNO IDNO keepUserData

    RMDir /r "$LOCALAPPDATA\watis"
    DetailPrint "Nutzdaten entfernt."

    keepUserData:
  ${endIf}
!macroend
