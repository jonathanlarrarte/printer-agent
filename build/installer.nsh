; Instala/quita el certificado local de PrintBridge Agent (assets/tls/) del
; almacen de confianza de Windows -- sin esto, un navegador muestra "no
; seguro" en https://localhost:<puerto>. perMachine=true en package.json ya
; hace que este instalador pida elevacion (UAC), asi que certutil aca corre
; con los permisos necesarios para escribir en el almacen ROOT de la
; maquina (no solo del usuario actual).
;
; El certificado es el MISMO en cada instalacion (bundleado como asset, no
; generado por maquina) -- ver main/tls.js para el detalle de por que ese
; alcance de confianza (solo localhost/127.0.0.1) es aceptable.

!macro customInstall
  DetailPrint "Instalando certificado local (localhost) de PrintBridge Agent..."
  nsExec::ExecToLog 'certutil -addstore -f "ROOT" "$INSTDIR\resources\app.asar.unpacked\assets\tls\localhost-cert.pem"'
!macroend

!macro customUnInstall
  DetailPrint "Quitando certificado local de PrintBridge Agent..."
  nsExec::ExecToLog 'certutil -delstore "ROOT" "PrintBridge Agent Local"'
!macroend
