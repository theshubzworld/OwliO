!macro customUnInstall
  ; Upgrades keep the existing preference. A full uninstall removes our entry.
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.owlio.desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.owlio.desktop"
  ${endIf}
!macroend
