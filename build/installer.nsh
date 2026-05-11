!macro customInstall
  WriteRegStr HKCU "Software\Classes\*\shell\AgentDesk" "" "Open with AgentDesk"
  WriteRegStr HKCU "Software\Classes\*\shell\AgentDesk" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\*\shell\AgentDesk\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegStr HKCU "Software\Classes\Directory\shell\AgentDesk" "" "Open folder with AgentDesk"
  WriteRegStr HKCU "Software\Classes\Directory\shell\AgentDesk" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\AgentDesk\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\AgentDesk" "" "Open folder with AgentDesk"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\AgentDesk" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\AgentDesk\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%V"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\AgentDesk"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\AgentDesk"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\AgentDesk"
!macroend
