# README 
## Deployment

The application is distributed as a pre-built bundle.

Only the `/dist` directory needs to be deployed to the web server.

Steps:

1. Build the project locally.
2. Upload the contents of the `/dist` folder to the web server.
3. Serve the files from a standard static web server.

No server-side runtime is required.  
Any static hosting (NGINX, Apache, CDN, or cloud storage hosting) will work.

## Cosa fa ogni file

### terrain-tap-place.ts
Il componente centrale.  
È un ECS component per 8th Wall che orchestra tutta l’esperienza.

Gestisce tre stati:

- loading → attende che il modello 3D sia pronto in memoria  
- scanning → tenta di posizionare il modello sul piano del suolo rilevato dall’AR  
- placed → modello posizionato; attiva gesture, billboard e UI

Questo componente crea e coordina tutte le altre classi.  
Qui risiede la logica per:

- posizionare il terreno
- resettare la scena
- aprire/chiudere il viewer 360
- mostrare suggerimenti all’utente

---

### gesture-handler.ts
Gestisce le gesture touch sul terreno in AR:

- pinch → scalare  
- drag → muovere (pan)

Utilizza la camera del dispositivo per convertire i movimenti dello schermo in traslazioni corrette nello spazio AR relative all’orientamento del dispositivo.

Il bug storico più importante di questo file era che `_getCamera()` restituiva una camera statica invece della camera live del renderer.

---

### billboard-manager.ts
Gestisce gli sprite 3D (pin/icone) che fluttuano sopra il modello.

Legge il modello del terreno da Blender cercando nodi con prefissi:

- hotspot_
- mountain_
- pin_

Per ogni nodo:

1. Carica il PNG corrispondente
2. Lo converte in un THREE.Sprite
3. Lo posiziona nello spazio AR

Rileva anche i tap sugli sprite tramite un sistema di hitbox NDC personalizzato, perché il raycast standard di Three.js non funziona bene con gli sprite.

Il pivot si trova alla punta del pin (center = 0.5, 0).  
Questo ha richiesto un fix in questa sessione affinché l’hitbox copra l’intero sprite visivo, non solo la punta.

---

### ar-ui-overlay.ts
Contiene tutto l’HTML/CSS della UI in AR.

Include:

- pulsante fullscreen (solo entrata, mai uscita)
- pulsante X per chiudere la scheda
- barra di altezza
- barra di rotazione
- suggerimento gesture  
  "pinch to scale / drag to move"
- suggerimento hotspot  
  "tap a pin to explore 360°"
- loader di scansione

I timing dei suggerimenti sono coordinati per evitare sovrapposizioni.

---

### viewer-360.ts
Il visore panoramico.

Crea un overlay fullscreen con una THREE.SphereGeometry invertita, carica texture JPG equirettangolari e permette di navigare tra immagini dello stesso hotspot.

Caratteristiche:

- navigazione con giroscopio + touch
- handoff seamless tramite quaternion di correzione
- sistema di cache sliding-window
  - ±1 immagine
  - massimo 3 texture in GPU

Tutte le risorse vengono liberate completamente alla chiusura del viewer.

---

### device-check.ts
Rileva:

- supporto AR
- accesso alla camera
- se l’app gira dentro un iframe

Mostra schede di errore bilingue EN/IT con istruzioni specifiche a seconda del caso:

- permesso camera negato
- camera già usata da un’altra app
- dispositivo non supportato
- iframe senza permessi necessari

---

### manifest.json
Il database degli hotspot 360.

Per ogni hotspot definisce:

- folder → cartella degli asset
- images → lista dei file JPG (senza estensione)
- labels → nomi di visualizzazione mostrati all’utente nel viewer

---

### experience-registry.ts
Registro centrale degli hotspot attivi.

Permette la navigazione tra hotspot  
(non tra immagini dello stesso hotspot — quello è gestito dal viewer).

Attualmente registrato ma non ancora completamente integrato nella navigazione tra hotspot.
