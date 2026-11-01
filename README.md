# UNO Online — Juega en familia

Juego web multijugador de UNO para dos personas, con salas privadas, servidor autoritativo y sincronización en tiempo real mediante Socket.IO.

## Requisitos

- Node.js 18 o superior.
- npm.
- Para jugar desde dos redes distintas, publicar el proyecto en un hosting Node.js (por ejemplo Render).

## Instalar y ejecutar

```bash
cd uno-online
npm install
npm start
```

Abre `http://localhost:3000` en tu navegador.

## Probar con dos dispositivos

1. En el computador que ejecuta el servidor, crea una sala e ingresa tu nombre.
2. Copia el código de cinco caracteres.
3. Si ambos dispositivos están en la misma red local, el segundo puede abrir `http://IP_LOCAL_DEL_COMPUTADOR:3000`. Autoriza el puerto 3000 en el firewall si es necesario.
4. En el segundo dispositivo, escribe un nombre, ingresa el código y pulsa **Unirme a la partida**.
5. Al conectarse el segundo jugador, la partida comienza automáticamente.

`localhost` solo funciona en el mismo dispositivo. Para jugar desde lugares distintos, despliega el proyecto en Internet.

## Publicar en Render

1. Sube la carpeta del proyecto a un repositorio Git (GitHub, por ejemplo).
2. En Render, crea un servicio **Web Service** conectado al repositorio.
3. Usa:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Render asignará el puerto mediante `process.env.PORT`.
5. Abre la URL HTTPS del servicio en ambos dispositivos y comparte el código de sala.

No necesitas configurar una base de datos para partidas en memoria. Las salas desaparecen cuando ambos jugadores se desconectan. Para producción con escalado horizontal, persistencia o reconexión prolongada, se recomienda añadir Redis y almacenamiento persistente.

## Controles

- Selecciona una carta resaltada para jugarla.
- Si no tienes una jugada, roba una carta.
- Si la carta robada es jugable, puedes colocarla inmediatamente; si no, pulsa **Pasar turno**.
- Al quedarte con una carta, pulsa **¡UNO!**.
- Si el rival olvida decir UNO, pulsa **¡PILLÉ EL UNO!** antes de que termine la ventana de 7 segundos.
- Frente a un +4 puedes desafiar o aceptar.

## Reglas y alcance de esta versión

- Baraja clásica de 108 cartas, 7 cartas por jugador.
- Partida para dos jugadores.
- Salto y reversa hacen que quien jugó vuelva a jugar (equivalen a saltar al rival).
- +2 y +4 hacen robar y perder el turno; no se acumulan.
- El +4 permite desafío: si el jugador tenía una carta del color activo, el desafío es correcto; si no, quien desafía roba seis.
- La penalización por no decir UNO se puede reclamar durante 7 segundos desde que el jugador queda con una carta.
- El servidor mantiene las manos privadas y valida turno, propiedad de carta y legalidad de jugada.
- Las partidas viven en memoria del proceso. Un reinicio del servidor termina las salas.

## Limitaciones conocidas que conviene resolver antes de uso público

- La reconexión automática está prevista para hasta 2 minutos, pero el reingreso manual requiere el mismo nombre y el código de sala.
- No hay autenticación de cuenta: el código de sala y el nombre son la identidad temporal de cada jugador.
- No incluye chat, publicidad ni recopilación de datos personales.
- Esta implementación es una base funcional para partidas privadas familiares; requiere pruebas de carga y auditoría de seguridad antes de abrirla a público masivo.
