; Sentire PMS installer hooks: install the hub Windows service and lock down its data folder.
; The service runs on every install but only starts the database and app on the PC that an
; Admin turns into the property hub (marker file in the control folder).

!macro NSIS_HOOK_PREINSTALL
  ; Updates: stop the running service so its files can be replaced.
  nsExec::ExecToLog '"$INSTDIR\hub\sentire-pms-hub.exe" stop'
  nsExec::ExecToLog '"$INSTDIR\hub\sentire-pms-hub.exe" uninstall'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$COMMONAPPDATA\SentirePMS"
  CreateDirectory "$COMMONAPPDATA\SentirePMS\control"
  ; Data folder: SYSTEM and Administrators only (database files and hub secrets).
  nsExec::ExecToLog 'icacls "$COMMONAPPDATA\SentirePMS" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F'
  ; Control folder: staff accounts may turn this PC into the hub from the app.
  nsExec::ExecToLog 'icacls "$COMMONAPPDATA\SentirePMS\control" /grant *S-1-5-32-545:(OI)(CI)M'
  nsExec::ExecToLog '"$INSTDIR\hub\sentire-pms-hub.exe" install'
  nsExec::ExecToLog '"$INSTDIR\hub\sentire-pms-hub.exe" start'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sentire PMS hub"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Sentire PMS hub" dir=in action=allow protocol=TCP localport=3000 profile=private,domain'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog '"$INSTDIR\hub\sentire-pms-hub.exe" stop'
  nsExec::ExecToLog '"$INSTDIR\hub\sentire-pms-hub.exe" uninstall'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sentire PMS hub"'
  ; The data folder in ProgramData is kept on purpose: uninstalling must never delete the hotel's data.
!macroend
