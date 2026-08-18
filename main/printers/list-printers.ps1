Get-CimInstance Win32_Printer |
  Select-Object Name, Default, WorkOffline, PrinterStatus |
  ConvertTo-Json -Compress
